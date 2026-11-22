// The Shadow runner: every tick it averages the live data, asks the Shadow
// engine what Automatic control would do, records the decision and hands it
// to the live state. Shadow decisions are never sent to the charger: the
// runner has no Zaptec client to send them with.
import type { AveragedInputs, Settings } from "@charge-on-solar/shared";
import type { Cancel, Clock } from "../clock.ts";
import type { ChargerReading } from "../domain/charger-reading.ts";
import { fuseHeadroomA, surplusW } from "../domain/energy.ts";
import type { LiveState } from "../domain/live-state.ts";
import {
  type CarState,
  decideShadow,
  noCar,
  type ShadowSnapshot,
  type SimulatedCharger,
  stampShadowSettings,
} from "../domain/shadow/engine.ts";
import type { RecordedShadowDecision } from "../domain/shadow/recorded-decision.ts";
import { StepSeries } from "../domain/shadow/step-series.ts";
import type { Storage } from "../storage/index.ts";
import { messageOf } from "../supervision.ts";

export interface ShadowRunnerOptions {
  clock: Clock;
  live: LiveState;
  storage: Storage;
  log: (line: string) => void;
  /** Read afresh at every tick, so a change takes effect at the next one. */
  settings: () => Settings;
}

export interface ShadowRunner {
  stop(): void;
}

const second = 1000;
const minute = 60_000;

/**
 * Starts ticking. The simulated charger carries on from the last recorded
 * Shadow decision, so a restart does not forget a simulated charge session;
 * see docs/adr/0002-simulated-charger-from-the-last-shadow-decision.md.
 */
export async function startShadowRunner({
  clock,
  live,
  storage,
  log,
  settings,
}: ShadowRunnerOptions): Promise<ShadowRunner> {
  let simulated: SimulatedCharger =
    (await storage.latestShadowDecision())?.simulated ?? noCar;
  const series = {
    surplusW: new StepSeries(),
    netPowerW: new StepSeries(),
    chargerPowerW: new StepSeries(),
    fuseHeadroomA: new StepSeries(),
  };
  let lastSkipReason: string | undefined;

  function sample() {
    const now = clock.now();
    const p1 = live.p1();
    const charger = live.charger();
    series.surplusW.add(now, surplusW(p1, charger));
    series.netPowerW.add(now, p1?.netPowerW ?? null);
    series.chargerPowerW.add(now, charger?.chargerPowerW ?? null);
    series.fuseHeadroomA.add(
      now,
      fuseHeadroomA(p1, charger, settings().mainFuseAmps)
    );
  }

  async function decide(now: Date, current: Settings) {
    const charger = live.charger();
    const inputs = averagedInputs(now, current);
    if (!charger) return skip("no Reading from Zaptec yet");
    const snapshot = toSnapshot(now, charger, inputs);
    if (typeof snapshot === "string") return skip(snapshot);
    lastSkipReason = undefined;
    const { decision, next } = decideShadow(snapshot, simulated, current);
    simulated = next;
    const recorded: RecordedShadowDecision = {
      at: now,
      decision,
      simulated: next,
      inputs,
      zaptec: {
        availableCurrentMode: charger.availableCurrentMode,
        enabledFeatures: charger.enabledFeatures,
        surplusModeActive: charger.surplusModeActive,
        chargeCurrentSetA: charger.chargingCurrentSetA,
      },
      stamp: stampShadowSettings(current),
    };
    await storage.recordShadowDecision(recorded);
    live.recordShadowDecision(recorded);
  }

  function skip(reason: string) {
    if (reason !== lastSkipReason) log(`No Shadow decision: ${reason}`);
    lastSkipReason = reason;
  }

  function averagedInputs(now: Date, current: Settings): AveragedInputs {
    const ago = (milliseconds: number) =>
      new Date(now.getTime() - milliseconds);
    const overTick = (values: StepSeries) =>
      values.average(ago(current.tickIntervalSeconds * second), now);
    const ageOf = (reading: { receivedAt: Date } | undefined) =>
      reading ? now.getTime() - reading.receivedAt.getTime() : null;
    return {
      surplusW: overTick(series.surplusW),
      netPowerW: overTick(series.netPowerW),
      // No solar system is read yet.
      solarProductionW: null,
      chargerPowerW: overTick(series.chargerPowerW),
      fuseHeadroomA: overTick(series.fuseHeadroomA),
      startWindowSurplusW: series.surplusW.average(
        ago(current.startWindowMinutes * minute),
        now
      ),
      stopWindowSurplusW: series.surplusW.average(
        ago(current.stopWindowMinutes * minute),
        now
      ),
      dataAgeMs: {
        p1: ageOf(live.p1()),
        charger: ageOf(live.charger()),
        solar: null,
      },
    };
  }

  const scheduleTick = () =>
    clock.after(settings().tickIntervalSeconds * second, tick);
  let cancelNext: Cancel = scheduleTick();
  function tick() {
    cancelNext = scheduleTick();
    const now = clock.now();
    const current = settings();
    decide(now, current).catch((error: unknown) =>
      log(`Shadow decision not recorded: ${messageOf(error)}`)
    );
    const longestKeptMs =
      Math.max(current.startWindowMinutes, current.stopWindowMinutes) * minute +
      current.tickIntervalSeconds * second;
    for (const values of Object.values(series)) {
      values.forgetBefore(new Date(now.getTime() - longestKeptMs));
    }
  }

  sample();
  const stopListening = live.onChange(sample);

  return {
    stop() {
      cancelNext();
      stopListening();
    },
  };
}

/** What the engine needs, or why the live data cannot give it yet. */
function toSnapshot(
  at: Date,
  charger: ChargerReading,
  inputs: AveragedInputs
): ShadowSnapshot | string {
  const car = carStateOf(charger);
  if (!car) return "Zaptec's charger state is unknown";
  if (charger.phaseSetting === null) return "the Phase setting is unknown";
  if (charger.maxCurrentA === null)
    return "the charger's maximum current is unknown";
  if (inputs.fuseHeadroomA === null) return "the Fuse headroom is unknown";
  if (inputs.startWindowSurplusW === null || inputs.stopWindowSurplusW === null)
    return "the Surplus is unknown";
  return {
    at,
    ...car,
    phases: charger.phaseSetting,
    chargerMaximumAmps: charger.maxCurrentA,
    startWindowSurplusWatts: inputs.startWindowSurplusW,
    stopWindowSurplusWatts: inputs.stopWindowSurplusW,
    fuseHeadroomAmps: inputs.fuseHeadroomA,
  };
}

// Zaptec's ChargerOperationMode (state 710) and FinalStopActive (state 718).
function carStateOf({
  operationMode,
  finalStopActive,
}: ChargerReading): { car: CarState; finalStopPause: boolean } | undefined {
  switch (operationMode) {
    case 1:
      return { car: "none", finalStopPause: false };
    case 2:
    case 3:
      return { car: "accepting", finalStopPause: false };
    case 5:
      return finalStopActive
        ? { car: "accepting", finalStopPause: true }
        : { car: "not-accepting", finalStopPause: false };
    default:
      return undefined;
  }
}

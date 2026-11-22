import type { SolarMode } from "@charge-on-solar/shared";
import { fuseHeadroom, surplus } from "../energy.ts";

export const phaseSettings = [1, 3] as const;
export type PhaseSetting = (typeof phaseSettings)[number];

export const carStates = ["no-car", "connected", "not-accepting"] as const;
export type CarState = (typeof carStates)[number];

export type PhaseCurrents = readonly [number, number, number];

/** Net power and Charger power at one moment, in watts. */
export interface PowerReading {
  at: Date;
  netPowerW: number;
  chargerPowerW: number;
}

/** Everything the Shadow engine knows about the real world at one tick. */
export interface ShadowSnapshot {
  at: Date;
  car: CarState;
  finalStopActive: boolean;
  phases: PhaseSetting;
  chargerMaximumA: number;
  /** The Readings of at least the last stop window, oldest first. */
  readings: readonly PowerReading[];
  phaseCurrents: { p1A: PhaseCurrents; chargerA: PhaseCurrents };
}

export interface ShadowSettings {
  startWindowMin: number;
  stopWindowMin: number;
  minimumOnTimeMin: number;
  minimumOffTimeMin: number;
  currentHoldMin: number;
  deadBandA: number;
  voltageV: number;
  mainFuseA: number;
  minimumSolarW: number;
  solarMode: SolarMode;
  tickMin: number;
}

/** Raised whenever a rule changes, so recorded decisions say which rules made them. */
export const shadowRulesVersion = 1;

export const defaultShadowSettings: ShadowSettings = {
  startWindowMin: 5,
  stopWindowMin: 10,
  minimumOnTimeMin: 15,
  minimumOffTimeMin: 15,
  currentHoldMin: 15,
  deadBandA: 1,
  voltageV: 230,
  mainFuseA: 25,
  minimumSolarW: 0,
  solarMode: "solar-only",
  tickMin: 1,
};

/** The charger as the Shadow engine would have driven it. */
export interface SimulatedCharger {
  carConnected: boolean;
  /** Null while not charging. */
  currentA: number | null;
  currentChangedAt: Date | null;
  startedAt: Date | null;
  /** Null until the first stop of this charge session. */
  stoppedAt: Date | null;
  /** Simulated starts and stops in this charge session; never the real Switch budget. */
  simulatedSwitches: number;
}

export function isCharging(charger: SimulatedCharger): boolean {
  return charger.currentA !== null;
}

export const initialSimulatedCharger: SimulatedCharger = {
  carConnected: false,
  currentA: null,
  currentChangedAt: null,
  startedAt: null,
  stoppedAt: null,
  simulatedSwitches: 0,
};

/** The lowest Charging current the charger can deliver. */
export const minimumChargingCurrentA = 6;

/** The charger allows this many interruptions per charge session. */
export const switchesPerSession = 20;
/** Starting needs this many simulated simulatedSwitches left, so a stop stays possible. */
export const switchReserve = 2;

export const currentLimits = [
  "surplus",
  "fuse-headroom",
  "charger-maximum",
] as const;
export type CurrentLimit = (typeof currentLimits)[number];

export const holdReasons = [
  "fuse-headroom",
  "minimum-on-time",
  "current-hold",
  "dead-band",
  "minimum-off-time",
  "switch-budget",
  "no-readings",
] as const;
export type HoldReason = (typeof holdReasons)[number];

export const stopReasons = ["surplus", "fuse-headroom"] as const;
export type StopReason = (typeof stopReasons)[number];

export type ChargingDecision =
  | {
      kind: "start";
      currentA: number;
      limitedBy: CurrentLimit;
      startAverageW: number;
    }
  | {
      kind: "change-current";
      currentA: number;
      limitedBy: CurrentLimit;
      startAverageW: number;
    }
  | { kind: "stop"; reason: StopReason; stopAverageW: number }
  | {
      kind: "hold";
      /** Null while not charging. */
      currentA: number | null;
      heldBy: HoldReason | null;
      /** Null when there were no Readings in the start window. */
      startAverageW: number | null;
    };

export type ShadowDecision =
  | ChargingDecision
  | { kind: "no-car" }
  | { kind: "car-not-accepting" }
  /** A final-stop pause, with the decision the engine would make without it. */
  | {
      kind: "paused-by-you";
      underlying: ChargingDecision | { kind: "car-not-accepting" };
    };

interface Outcome<Decision> {
  decision: Decision;
  next: SimulatedCharger;
}

/** The figures a decision was based on, worked out from the snapshot. */
export interface ShadowInputs {
  /** Null when there were no Readings in the window. */
  startAverageW: number | null;
  stopAverageW: number | null;
  fuseHeadroomA: number;
}

export interface ShadowOutcome extends Outcome<ShadowDecision> {
  inputs: ShadowInputs;
  settings: ShadowSettings;
  rulesVersion: number;
}

function averageSurplus(
  readings: readonly PowerReading[],
  at: Date,
  windowMin: number
): number | null {
  const from = at.getTime() - windowMin * 60_000;
  const inWindow = readings.filter((r) => r.at.getTime() > from);
  if (inWindow.length === 0) return null;
  const total = inWindow.reduce((sum, r) => sum + surplus(r), 0);
  return total / inWindow.length;
}

function chargingCurrent({
  startAverageW,
  wattsPerAmp,
  snapshot: { chargerMaximumA },
  headroomA,
}: Tick): { currentA: number; limitedBy: CurrentLimit } {
  const coveredA = Math.max(
    minimumChargingCurrentA,
    Math.floor(startAverageW / wattsPerAmp)
  );
  const headroomCapA = Math.floor(headroomA);
  if (headroomCapA < chargerMaximumA && coveredA > headroomCapA) {
    return { currentA: headroomCapA, limitedBy: "fuse-headroom" };
  }
  if (coveredA > chargerMaximumA) {
    return { currentA: chargerMaximumA, limitedBy: "charger-maximum" };
  }
  return { currentA: coveredA, limitedBy: "surplus" };
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

export function decideShadow(
  snapshot: ShadowSnapshot,
  previous: SimulatedCharger,
  settings: ShadowSettings
): ShadowOutcome {
  const inputs: ShadowInputs = {
    startAverageW: averageSurplus(
      snapshot.readings,
      snapshot.at,
      settings.startWindowMin
    ),
    stopAverageW: averageSurplus(
      snapshot.readings,
      snapshot.at,
      settings.stopWindowMin
    ),
    fuseHeadroomA: fuseHeadroom(settings.mainFuseA, snapshot.phaseCurrents),
  };
  const stamp = { inputs, settings, rulesVersion: shadowRulesVersion };
  return { ...decide(snapshot, inputs, previous, settings), ...stamp };
}

function decide(
  snapshot: ShadowSnapshot,
  inputs: ShadowInputs,
  previous: SimulatedCharger,
  settings: ShadowSettings
): Outcome<ShadowDecision> {
  if (snapshot.car === "no-car") {
    return { decision: { kind: "no-car" }, next: initialSimulatedCharger };
  }
  const session = previous.carConnected
    ? previous
    : { ...initialSimulatedCharger, carConnected: true };
  const underlying =
    snapshot.car === "not-accepting"
      ? carNotAccepting(session)
      : decideCharging(snapshot, inputs, session, settings);
  if (!snapshot.finalStopActive) return underlying;
  return {
    decision: { kind: "paused-by-you", underlying: underlying.decision },
    next: underlying.next,
  };
}

function carNotAccepting(
  session: SimulatedCharger
): Outcome<{ kind: "car-not-accepting" }> {
  return {
    decision: { kind: "car-not-accepting" },
    next: { ...session, currentA: null },
  };
}

function decideCharging(
  snapshot: ShadowSnapshot,
  { startAverageW, stopAverageW, fuseHeadroomA }: ShadowInputs,
  session: SimulatedCharger,
  settings: ShadowSettings
): Outcome<ChargingDecision> {
  if (startAverageW === null || stopAverageW === null) {
    return hold(session, "no-readings", null);
  }
  const tick: Tick = {
    snapshot,
    settings,
    wattsPerAmp: settings.voltageV * snapshot.phases,
    startAverageW,
    stopAverageW,
    headroomA: fuseHeadroomA,
  };
  return isCharging(session)
    ? whileCharging(tick, session)
    : whileStopped(tick, session);
}

/** One tick's snapshot and settings, with the figures worked out from them. */
interface Tick {
  snapshot: ShadowSnapshot;
  settings: ShadowSettings;
  wattsPerAmp: number;
  startAverageW: number;
  stopAverageW: number;
  headroomA: number;
}

function hold(
  session: SimulatedCharger,
  heldBy: HoldReason | null,
  startAverageW: number | null
): Outcome<ChargingDecision> {
  return {
    decision: {
      kind: "hold",
      currentA: session.currentA,
      heldBy,
      startAverageW,
    },
    next: session,
  };
}

function surplusAllowsStart(tick: Tick): boolean {
  const { settings, startAverageW, wattsPerAmp } = tick;
  return settings.solarMode === "solar-only"
    ? startAverageW >= minimumChargingCurrentA * wattsPerAmp
    : startAverageW > settings.minimumSolarW;
}

function surplusCallsForStop(tick: Tick): boolean {
  const { settings, stopAverageW, wattsPerAmp } = tick;
  return settings.solarMode === "solar-only"
    ? stopAverageW < minimumChargingCurrentA * wattsPerAmp
    : stopAverageW <= settings.minimumSolarW;
}

function whileStopped(
  tick: Tick,
  session: SimulatedCharger
): Outcome<ChargingDecision> {
  const { snapshot, startAverageW, headroomA } = tick;
  const holdBy = (heldBy: HoldReason | null) =>
    hold(session, heldBy, startAverageW);
  if (!surplusAllowsStart(tick)) return holdBy(null);
  if (headroomA < minimumChargingCurrentA) return holdBy("fuse-headroom");
  if (
    session.stoppedAt &&
    minutesBetween(session.stoppedAt, snapshot.at) <
      tick.settings.minimumOffTimeMin
  ) {
    return holdBy("minimum-off-time");
  }
  if (switchesPerSession - session.simulatedSwitches < switchReserve) {
    return holdBy("switch-budget");
  }
  const { currentA, limitedBy } = chargingCurrent(tick);
  return {
    decision: { kind: "start", currentA, limitedBy, startAverageW },
    next: {
      ...session,
      currentA,
      currentChangedAt: snapshot.at,
      startedAt: snapshot.at,
      simulatedSwitches: session.simulatedSwitches + 1,
    },
  };
}

function whileCharging(
  tick: Tick,
  session: SimulatedCharger
): Outcome<ChargingDecision> {
  const { snapshot, settings, startAverageW, stopAverageW } = tick;
  const stop = (reason: StopReason): Outcome<ChargingDecision> => ({
    decision: { kind: "stop", reason, stopAverageW },
    next: {
      ...session,
      currentA: null,
      stoppedAt: snapshot.at,
      simulatedSwitches: session.simulatedSwitches + 1,
    },
  });
  const holdBy = (heldBy: HoldReason | null) =>
    hold(session, heldBy, startAverageW);
  if (tick.headroomA < minimumChargingCurrentA) return stop("fuse-headroom");
  if (surplusCallsForStop(tick)) {
    const onForMin = minutesBetween(
      session.startedAt ?? snapshot.at,
      snapshot.at
    );
    if (onForMin < settings.minimumOnTimeMin) return holdBy("minimum-on-time");
    return stop("surplus");
  }
  const { currentA, limitedBy } = chargingCurrent(tick);
  const differenceA = Math.abs(currentA - (session.currentA ?? 0));
  if (differenceA === 0) return holdBy(null);
  if (differenceA < settings.deadBandA) return holdBy("dead-band");
  const heldForMin = minutesBetween(
    session.currentChangedAt ?? snapshot.at,
    snapshot.at
  );
  if (heldForMin < settings.currentHoldMin) return holdBy("current-hold");
  return {
    decision: { kind: "change-current", currentA, limitedBy, startAverageW },
    next: { ...session, currentA, currentChangedAt: snapshot.at },
  };
}

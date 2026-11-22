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
  charging: boolean;
  currentA: number | null;
  currentChangedAt: Date | null;
  startedAt: Date | null;
  /** Null until the first stop of this charge session. */
  stoppedAt: Date | null;
  /** Simulated starts and stops in this charge session. */
  switches: number;
}

export const initialSimulatedCharger: SimulatedCharger = {
  carConnected: false,
  charging: false,
  currentA: null,
  currentChangedAt: null,
  startedAt: null,
  stoppedAt: null,
  switches: 0,
};

/** The lowest Charging current the charger can deliver. */
export const minimumChargingCurrentA = 6;

/** The charger allows this many interruptions per charge session. */
export const switchesPerSession = 20;
/** Starting needs this many simulated switches left, so a stop stays possible. */
export const switchReserve = 2;

export type CurrentLimit = "surplus" | "fuse-headroom" | "charger-maximum";

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

export type StopReason = "surplus" | "fuse-headroom";

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
      charging: boolean;
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
export type ShadowOutcome = Outcome<ShadowDecision>;

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

function chargingCurrent(
  startAverageW: number,
  wattsPerAmp: number,
  chargerMaximumA: number,
  headroomA: number
): { currentA: number; limitedBy: CurrentLimit } {
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
  if (snapshot.car === "no-car") {
    return { decision: { kind: "no-car" }, next: initialSimulatedCharger };
  }
  const session = previous.carConnected
    ? previous
    : { ...initialSimulatedCharger, carConnected: true };
  const underlying =
    snapshot.car === "not-accepting"
      ? carNotAccepting(session)
      : decideCharging(snapshot, session, settings);
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
    next: { ...session, charging: false, currentA: null },
  };
}

function decideCharging(
  snapshot: ShadowSnapshot,
  session: SimulatedCharger,
  settings: ShadowSettings
): Outcome<ChargingDecision> {
  const startAverageW = averageSurplus(
    snapshot.readings,
    snapshot.at,
    settings.startWindowMin
  );
  const stopAverageW = averageSurplus(
    snapshot.readings,
    snapshot.at,
    settings.stopWindowMin
  );
  if (startAverageW === null || stopAverageW === null) {
    return {
      decision: {
        kind: "hold",
        charging: session.charging,
        currentA: session.currentA,
        heldBy: "no-readings",
        startAverageW: null,
      },
      next: session,
    };
  }
  const inputs: Inputs = {
    snapshot,
    settings,
    wattsPerAmp: settings.voltageV * snapshot.phases,
    startAverageW,
    stopAverageW,
    headroomA: fuseHeadroom(settings.mainFuseA, snapshot.phaseCurrents),
  };
  return session.charging
    ? whileCharging(inputs, session)
    : whileStopped(inputs, session);
}

interface Inputs {
  snapshot: ShadowSnapshot;
  settings: ShadowSettings;
  wattsPerAmp: number;
  startAverageW: number;
  stopAverageW: number;
  headroomA: number;
}

function surplusAllowsStart(inputs: Inputs): boolean {
  const { settings, startAverageW, wattsPerAmp } = inputs;
  return settings.solarMode === "solar-only"
    ? startAverageW >= minimumChargingCurrentA * wattsPerAmp
    : startAverageW > settings.minimumSolarW;
}

function surplusCallsForStop(inputs: Inputs): boolean {
  const { settings, stopAverageW, wattsPerAmp } = inputs;
  return settings.solarMode === "solar-only"
    ? stopAverageW < minimumChargingCurrentA * wattsPerAmp
    : stopAverageW <= settings.minimumSolarW;
}

function whileStopped(
  inputs: Inputs,
  previous: SimulatedCharger
): Outcome<ChargingDecision> {
  const { snapshot, wattsPerAmp, startAverageW, headroomA } = inputs;
  const hold = (heldBy: HoldReason | null): Outcome<ChargingDecision> => ({
    decision: {
      kind: "hold",
      charging: false,
      currentA: null,
      heldBy,
      startAverageW,
    },
    next: previous,
  });
  if (!surplusAllowsStart(inputs)) return hold(null);
  if (headroomA < minimumChargingCurrentA) return hold("fuse-headroom");
  if (
    previous.stoppedAt &&
    minutesBetween(previous.stoppedAt, snapshot.at) <
      inputs.settings.minimumOffTimeMin
  ) {
    return hold("minimum-off-time");
  }
  if (switchesPerSession - previous.switches < switchReserve) {
    return hold("switch-budget");
  }
  const { currentA, limitedBy } = chargingCurrent(
    startAverageW,
    wattsPerAmp,
    snapshot.chargerMaximumA,
    headroomA
  );
  return {
    decision: { kind: "start", currentA, limitedBy, startAverageW },
    next: {
      ...previous,
      charging: true,
      currentA,
      currentChangedAt: snapshot.at,
      startedAt: snapshot.at,
      switches: previous.switches + 1,
    },
  };
}

function whileCharging(
  inputs: Inputs,
  previous: SimulatedCharger
): Outcome<ChargingDecision> {
  const { snapshot, settings, wattsPerAmp, startAverageW, stopAverageW } =
    inputs;
  const stop = (reason: StopReason): Outcome<ChargingDecision> => ({
    decision: { kind: "stop", reason, stopAverageW },
    next: {
      ...previous,
      charging: false,
      currentA: null,
      stoppedAt: snapshot.at,
      switches: previous.switches + 1,
    },
  });
  const hold = (heldBy: HoldReason | null): Outcome<ChargingDecision> => ({
    decision: {
      kind: "hold",
      charging: true,
      currentA: previous.currentA,
      heldBy,
      startAverageW,
    },
    next: previous,
  });
  if (inputs.headroomA < minimumChargingCurrentA) return stop("fuse-headroom");
  if (surplusCallsForStop(inputs)) {
    const onForMin = minutesBetween(
      previous.startedAt ?? snapshot.at,
      snapshot.at
    );
    if (onForMin < settings.minimumOnTimeMin) return hold("minimum-on-time");
    return stop("surplus");
  }
  const { currentA, limitedBy } = chargingCurrent(
    startAverageW,
    wattsPerAmp,
    snapshot.chargerMaximumA,
    inputs.headroomA
  );
  const differenceA = Math.abs(currentA - (previous.currentA ?? 0));
  if (differenceA === 0) return hold(null);
  if (differenceA < settings.deadBandA) return hold("dead-band");
  const heldForMin = minutesBetween(
    previous.currentChangedAt ?? snapshot.at,
    snapshot.at
  );
  if (heldForMin < settings.currentHoldMin) return hold("current-hold");
  return {
    decision: { kind: "change-current", currentA, limitedBy, startAverageW },
    next: { ...previous, currentA, currentChangedAt: snapshot.at },
  };
}

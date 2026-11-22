// The Shadow engine: what Automatic control would do, given one moment's
// live state. Pure: no I/O and no clock of its own; the time comes in with
// the snapshot.
import type { SolarMode } from "@charge-on-solar/shared";

/** Bumped whenever a rule changes; stamped together with the settings. */
export const shadowRulesVersion = 1;

export const phaseSettings = [1, 3] as const;
export type PhaseSetting = (typeof phaseSettings)[number];

export const carStates = ["none", "not-accepting", "accepting"] as const;
export type CarState = (typeof carStates)[number];

export interface ShadowSettings {
  startWindowMinutes: number;
  stopWindowMinutes: number;
  minimumOnTimeMinutes: number;
  minimumOffTimeMinutes: number;
  currentHoldMinutes: number;
  deadBandAmps: number;
  /** Per-phase voltage, fixed by the grid. */
  voltage: number;
  mainFuseAmps: number;
  minimumSolarWatts: number;
  solarMode: SolarMode;
}

export const defaultShadowSettings: ShadowSettings = {
  startWindowMinutes: 5,
  stopWindowMinutes: 10,
  minimumOnTimeMinutes: 15,
  minimumOffTimeMinutes: 15,
  currentHoldMinutes: 15,
  deadBandAmps: 1,
  voltage: 230,
  mainFuseAmps: 25,
  minimumSolarWatts: 0,
  solarMode: "solar-only",
};

/** Settings as recorded beside a Shadow decision: which rules read them. */
export interface StampedShadowSettings {
  rulesVersion: number;
  settings: ShadowSettings;
}

export function stampShadowSettings(
  settings: ShadowSettings
): StampedShadowSettings {
  return { rulesVersion: shadowRulesVersion, settings };
}

/** What the engine reads from the real charger and the meters at one moment. */
export interface ShadowSnapshot {
  at: Date;
  car: CarState;
  phases: PhaseSetting;
  chargerMaximumAmps: number;
  finalStopPause: boolean;
  /** Surplus averaged over the start window. */
  startWindowSurplusWatts: number;
  /** Surplus averaged over the stop window. */
  stopWindowSurplusWatts: number;
  fuseHeadroomAmps: number;
}

/** The charger as the engine would have driven it. Never sent anywhere. */
export interface SimulatedCharger {
  carConnected: boolean;
  charging: boolean;
  currentAmps: number | null;
  currentChangedAt: Date | null;
  /** When charging last started or stopped; null until the first start of the charge session. */
  switchedAt: Date | null;
  /** Simulated switches so far in this charge session. */
  switchCount: number;
}

export const noCar: SimulatedCharger = {
  carConnected: false,
  charging: false,
  currentAmps: null,
  currentChangedAt: null,
  switchedAt: null,
  switchCount: 0,
};

export type CurrentLimit =
  | "surplus"
  | "minimum-current"
  | "charger-maximum"
  | "fuse-headroom";

export type HoldReason =
  | "surplus-too-low"
  | "minimum-off-time"
  | "switch-budget"
  | "fuse-headroom"
  | "minimum-on-time"
  | "within-dead-band"
  | "current-hold";

export type StopReason = "surplus-too-low" | "fuse-headroom";

export type ChargeDecision =
  | { kind: "start"; currentAmps: number; limitedBy: CurrentLimit }
  | { kind: "stop"; reason: StopReason }
  | { kind: "change-current"; currentAmps: number; limitedBy: CurrentLimit }
  | { kind: "hold"; reason: HoldReason };

/** What the engine decides once a car is plugged in, before any pause. */
export type CarDecision = ChargeDecision | { kind: "car-not-accepting" };

export type ShadowDecision =
  | CarDecision
  | { kind: "no-car" }
  /** A final-stop pause wins; underlying is what the engine would do without it. */
  | { kind: "paused"; underlying: CarDecision };

export interface ShadowOutcome {
  decision: ShadowDecision;
  next: SimulatedCharger;
}

interface ChargeOutcome {
  decision: ChargeDecision;
  next: SimulatedCharger;
}

const minimumCurrentAmps = 6;
const minute = 60_000;

const switchBudget = 20;
// Starting needs a switch left over for the stop that follows it.
const switchesNeededToStart = 2;

export function decideShadow(
  snapshot: ShadowSnapshot,
  previous: SimulatedCharger,
  settings: ShadowSettings
): ShadowOutcome {
  if (snapshot.car === "none") {
    return { decision: { kind: "no-car" }, next: noCar };
  }
  const session = previous.carConnected
    ? previous
    : { ...noCar, carConnected: true };
  const underlying = decideForCar(snapshot, session, settings);
  if (snapshot.finalStopPause) {
    return {
      decision: { kind: "paused", underlying: underlying.decision },
      next: stoppedWithoutSwitch(session, snapshot),
    };
  }
  return underlying;
}

function decideForCar(
  snapshot: ShadowSnapshot,
  session: SimulatedCharger,
  settings: ShadowSettings
): { decision: CarDecision; next: SimulatedCharger } {
  if (snapshot.car === "not-accepting") {
    return {
      decision: { kind: "car-not-accepting" },
      next: stoppedWithoutSwitch(session, snapshot),
    };
  }
  return session.charging
    ? decideWhileCharging(snapshot, session, settings)
    : decideWhileStopped(snapshot, session, settings);
}

/** Charging ended by something other than the engine: no switch is counted. */
function stoppedWithoutSwitch(
  state: SimulatedCharger,
  snapshot: ShadowSnapshot
): SimulatedCharger {
  if (!state.charging) return state;
  return {
    ...state,
    charging: false,
    currentAmps: null,
    switchedAt: snapshot.at,
  };
}

function decideWhileCharging(
  snapshot: ShadowSnapshot,
  state: SimulatedCharger,
  settings: ShadowSettings
): ChargeOutcome {
  const stop = (reason: StopReason): ChargeOutcome => ({
    decision: { kind: "stop", reason },
    next: {
      ...state,
      charging: false,
      currentAmps: null,
      switchedAt: snapshot.at,
      switchCount: state.switchCount + 1,
    },
  });
  const hold = (reason: HoldReason): ChargeOutcome => ({
    decision: { kind: "hold", reason },
    next: state,
  });
  if (snapshot.fuseHeadroomAmps < minimumCurrentAmps) {
    return stop("fuse-headroom");
  }
  const changeCurrent = (): ChargeOutcome => {
    const { currentAmps, limitedBy } = chargingCurrent(snapshot, settings);
    return {
      decision: { kind: "change-current", currentAmps, limitedBy },
      next: { ...state, currentAmps, currentChangedAt: snapshot.at },
    };
  };
  const surplusGone = !enoughSurplus(
    snapshot.stopWindowSurplusWatts,
    snapshot,
    settings
  );
  const onFor = state.switchedAt
    ? elapsedMinutes(state.switchedAt, snapshot)
    : Number.POSITIVE_INFINITY;
  const withinMinimumOnTime = onFor < settings.minimumOnTimeMinutes;
  if (surplusGone && !withinMinimumOnTime) return stop("surplus-too-low");
  // The fuse cannot wait out the current hold or the minimum on-time.
  if ((state.currentAmps ?? 0) > Math.floor(snapshot.fuseHeadroomAmps)) {
    return changeCurrent();
  }
  if (surplusGone) return hold("minimum-on-time");
  const { currentAmps, limitedBy } = chargingCurrent(snapshot, settings);
  if (
    Math.abs(currentAmps - (state.currentAmps ?? 0)) < settings.deadBandAmps
  ) {
    return hold("within-dead-band");
  }
  if (
    state.currentChangedAt &&
    elapsedMinutes(state.currentChangedAt, snapshot) <
      settings.currentHoldMinutes
  ) {
    return hold("current-hold");
  }
  return changeCurrent();
}

function decideWhileStopped(
  snapshot: ShadowSnapshot,
  state: SimulatedCharger,
  settings: ShadowSettings
): ChargeOutcome {
  const hold = (reason: HoldReason): ChargeOutcome => ({
    decision: { kind: "hold", reason },
    next: state,
  });
  if (snapshot.fuseHeadroomAmps < minimumCurrentAmps) {
    return hold("fuse-headroom");
  }
  if (!enoughSurplus(snapshot.startWindowSurplusWatts, snapshot, settings))
    return hold("surplus-too-low");
  if (
    state.switchedAt &&
    elapsedMinutes(state.switchedAt, snapshot) < settings.minimumOffTimeMinutes
  ) {
    return hold("minimum-off-time");
  }
  if (switchBudget - state.switchCount < switchesNeededToStart) {
    return hold("switch-budget");
  }
  const { currentAmps, limitedBy } = chargingCurrent(snapshot, settings);
  return {
    decision: { kind: "start", currentAmps, limitedBy },
    next: {
      ...state,
      charging: true,
      currentAmps,
      currentChangedAt: snapshot.at,
      switchedAt: snapshot.at,
      switchCount: state.switchCount + 1,
    },
  };
}

/** Solar only needs 6 A worth of Surplus; All solar more than the minimum solar. */
function enoughSurplus(
  surplusWatts: number,
  snapshot: ShadowSnapshot,
  settings: ShadowSettings
): boolean {
  return settings.solarMode === "solar-only"
    ? surplusWatts >= wattsFor(minimumCurrentAmps, snapshot, settings)
    : surplusWatts > settings.minimumSolarWatts;
}

function chargingCurrent(
  snapshot: ShadowSnapshot,
  settings: ShadowSettings
): { currentAmps: number; limitedBy: CurrentLimit } {
  const surplusAmps = Math.floor(
    snapshot.startWindowSurplusWatts / wattsFor(1, snapshot, settings)
  );
  const fuseAmps = Math.floor(snapshot.fuseHeadroomAmps);
  if (fuseAmps < Math.min(surplusAmps, snapshot.chargerMaximumAmps)) {
    return { currentAmps: fuseAmps, limitedBy: "fuse-headroom" };
  }
  if (snapshot.chargerMaximumAmps < surplusAmps) {
    return {
      currentAmps: snapshot.chargerMaximumAmps,
      limitedBy: "charger-maximum",
    };
  }
  if (surplusAmps < minimumCurrentAmps) {
    return { currentAmps: minimumCurrentAmps, limitedBy: "minimum-current" };
  }
  return { currentAmps: surplusAmps, limitedBy: "surplus" };
}

function elapsedMinutes(since: Date, snapshot: ShadowSnapshot): number {
  return (snapshot.at.getTime() - since.getTime()) / minute;
}

function wattsFor(
  amps: number,
  snapshot: ShadowSnapshot,
  settings: ShadowSettings
): number {
  return amps * settings.voltage * snapshot.phases;
}

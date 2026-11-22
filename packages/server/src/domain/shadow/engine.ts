// The Shadow engine: what Automatic control would do, given one moment's
// live state. Pure: no I/O and no clock of its own; the time comes in with
// the snapshot.
import type {
  CarDecision,
  ChargeDecision,
  CurrentLimit,
  HoldReason,
  Settings,
  ShadowDecision,
  ShadowSettings,
  StopReason,
} from "@charge-on-solar/shared";

export type {
  CarDecision,
  ChargeDecision,
  CurrentLimit,
  HoldReason,
  ShadowDecision,
  ShadowSettings,
  StopReason,
} from "@charge-on-solar/shared";

/** Bumped whenever a rule changes; stamped together with the settings. */
export const shadowRulesVersion = 1;

export const phaseSettings = [1, 3] as const;
export type PhaseSetting = (typeof phaseSettings)[number];

export const carStates = ["none", "not-accepting", "accepting"] as const;
export type CarState = (typeof carStates)[number];

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
  settings: Settings;
}

export function stampShadowSettings(settings: Settings): StampedShadowSettings {
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
  /** The Charging current it set; null while it is not charging. */
  currentAmps: number | null;
  currentChangedAt: Date | null;
  /** When charging last started or stopped; null until the first start of the charge session. */
  switchedAt: Date | null;
  /** Simulated switches so far in this charge session. */
  switchCount: number;
  /**
   * The minimum on-time after a start, or off-time after a stop, as it was
   * set at `switchedAt`: shortening it in the Settings does not cut it short.
   */
  switchHoldMinutes: number | null;
  /** The current hold as it was set at `currentChangedAt`. */
  currentHoldMinutes: number | null;
}

export const noCar: SimulatedCharger = {
  carConnected: false,
  currentAmps: null,
  currentChangedAt: null,
  switchedAt: null,
  switchCount: 0,
  switchHoldMinutes: null,
  currentHoldMinutes: null,
};

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
      next: stoppedWithoutSwitch(session, snapshot, settings),
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
      next: stoppedWithoutSwitch(session, snapshot, settings),
    };
  }
  return isCharging(session)
    ? decideWhileCharging(snapshot, session, settings)
    : decideWhileStopped(snapshot, session, settings);
}

/** Charging ended by something other than the engine: no switch is counted. */
function stoppedWithoutSwitch(
  state: SimulatedCharger,
  snapshot: ShadowSnapshot,
  settings: ShadowSettings
): SimulatedCharger {
  if (!isCharging(state)) return state;
  return {
    ...state,
    currentAmps: null,
    switchedAt: snapshot.at,
    switchHoldMinutes: settings.minimumOffTimeMinutes,
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
      currentAmps: null,
      switchedAt: snapshot.at,
      switchCount: state.switchCount + 1,
      switchHoldMinutes: settings.minimumOffTimeMinutes,
    },
  });
  if (snapshot.fuseHeadroomAmps < minimumCurrentAmps) {
    return stop("fuse-headroom");
  }
  const { currentAmps, limitedBy } = chargingCurrent(snapshot, settings);
  const changeCurrent = (): ChargeOutcome => ({
    decision: { kind: "change-current", currentAmps, limitedBy },
    next: {
      ...state,
      currentAmps,
      currentChangedAt: snapshot.at,
      currentHoldMinutes: settings.currentHoldMinutes,
    },
  });
  const surplusGone = !enoughSurplus(
    snapshot.stopWindowSurplusWatts,
    snapshot,
    settings
  );
  const onFor = state.switchedAt
    ? elapsedMinutes(state.switchedAt, snapshot)
    : Number.POSITIVE_INFINITY;
  const withinMinimumOnTime =
    onFor < heldFor(settings.minimumOnTimeMinutes, state.switchHoldMinutes);
  if (surplusGone && !withinMinimumOnTime) return stop("surplus-too-low");
  // The fuse cannot wait out the current hold or the minimum on-time.
  if ((state.currentAmps ?? 0) > Math.floor(snapshot.fuseHeadroomAmps)) {
    return changeCurrent();
  }
  if (surplusGone) return hold("minimum-on-time", state);
  if (
    Math.abs(currentAmps - (state.currentAmps ?? 0)) < settings.deadBandAmps
  ) {
    return hold("within-dead-band", state);
  }
  if (
    state.currentChangedAt &&
    elapsedMinutes(state.currentChangedAt, snapshot) <
      heldFor(settings.currentHoldMinutes, state.currentHoldMinutes)
  ) {
    return hold("current-hold", state);
  }
  return changeCurrent();
}

function decideWhileStopped(
  snapshot: ShadowSnapshot,
  state: SimulatedCharger,
  settings: ShadowSettings
): ChargeOutcome {
  if (snapshot.fuseHeadroomAmps < minimumCurrentAmps) {
    return hold("fuse-headroom", state);
  }
  if (!enoughSurplus(snapshot.startWindowSurplusWatts, snapshot, settings))
    return hold("surplus-too-low", state);
  if (
    state.switchedAt &&
    elapsedMinutes(state.switchedAt, snapshot) <
      heldFor(settings.minimumOffTimeMinutes, state.switchHoldMinutes)
  ) {
    return hold("minimum-off-time", state);
  }
  if (switchBudget - state.switchCount < switchesNeededToStart) {
    return hold("switch-budget", state);
  }
  const { currentAmps, limitedBy } = chargingCurrent(snapshot, settings);
  return {
    decision: { kind: "start", currentAmps, limitedBy },
    next: {
      ...state,
      currentAmps,
      currentChangedAt: snapshot.at,
      switchedAt: snapshot.at,
      switchCount: state.switchCount + 1,
      switchHoldMinutes: settings.minimumOnTimeMinutes,
      currentHoldMinutes: settings.currentHoldMinutes,
    },
  };
}

/** A hold under way lasts as it was set, or longer if the Settings now say so. */
function heldFor(setting: number, setWhenHoldBegan: number | null): number {
  return Math.max(setting, setWhenHoldBegan ?? 0);
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

function hold(reason: HoldReason, state: SimulatedCharger): ChargeOutcome {
  return { decision: { kind: "hold", reason }, next: state };
}

function isCharging(state: SimulatedCharger): boolean {
  return state.currentAmps !== null;
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

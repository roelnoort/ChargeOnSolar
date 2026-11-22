import {
  decideShadow,
  initialSimulatedCharger,
  type ShadowDecision,
  type ShadowSettings,
  type ShadowSnapshot,
} from "./engine.ts";

export interface ReplayedDecision {
  at: Date;
  decision: ShadowDecision;
}

/** Runs the Shadow engine over recorded ticks, starting with the car unplugged. */
export function replayShadow(
  ticks: readonly ShadowSnapshot[],
  settings: ShadowSettings
): ReplayedDecision[] {
  let charger = initialSimulatedCharger;
  return ticks.map((snapshot) => {
    const { decision, next } = decideShadow(snapshot, charger, settings);
    charger = next;
    return { at: snapshot.at, decision };
  });
}

import type {
  AveragedInputs,
  ShadowDecision,
  ZaptecContext,
} from "@charge-on-solar/shared";
import type {
  PhaseSetting,
  SimulatedCharger,
  StampedShadowSettings,
} from "./engine.ts";

/** One Shadow decision as the runner made and recorded it. */
export interface RecordedShadowDecision {
  at: Date;
  decision: ShadowDecision;
  /** The simulated charger after the decision. */
  simulated: SimulatedCharger;
  /** Null on decisions recorded before the Phase setting was kept with them. */
  phaseSetting: PhaseSetting | null;
  inputs: AveragedInputs;
  zaptec: ZaptecContext;
  stamp: StampedShadowSettings;
}

import type { AveragedInputs, ZaptecContext } from "@charge-on-solar/shared";
import type {
  ShadowDecision,
  SimulatedCharger,
  StampedShadowSettings,
} from "./engine.ts";

/** One Shadow decision as the runner made and recorded it. */
export interface RecordedShadowDecision {
  at: Date;
  decision: ShadowDecision;
  /** The simulated charger after the decision. */
  simulated: SimulatedCharger;
  inputs: AveragedInputs;
  zaptec: ZaptecContext;
  stamp: StampedShadowSettings;
}

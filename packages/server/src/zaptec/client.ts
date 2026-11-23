import type { OverrideCommand } from "@charge-on-solar/shared";
import type { ChargerReading } from "../domain/charger-reading.ts";
import type { CommandResult } from "../domain/override.ts";

export type { CommandResult };

/** Reads the charger and its installation from the Zaptec cloud, and sends it commands. */
export interface ZaptecClient {
  /** One Reading, received now. Rejects when Zaptec cannot be read. */
  read(): Promise<ChargerReading>;
  /**
   * Sends the charger a pause or resume. Never rejects: a failure is a
   * rejected result. Only the Override module calls it.
   */
  sendCommand(command: OverrideCommand): Promise<CommandResult>;
}

import type { ChargerReading } from "../domain/charger-reading.ts";

/** Reads the charger and its installation from the Zaptec cloud. */
export interface ZaptecClient {
  /** One Reading, received now. Rejects when Zaptec cannot be read. */
  read(): Promise<ChargerReading>;
}

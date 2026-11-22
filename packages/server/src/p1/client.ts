import type { P1Reading } from "../domain/p1-reading.ts";

/** A source of live Readings from the P1 meter. */
export interface P1Client {
  /**
   * Opens the live stream and calls `onReading` for each Reading. Resolves
   * once the stream is open; rejects when it cannot be opened.
   */
  connect(onReading: (reading: P1Reading) => void): Promise<P1Connection>;
}

export interface P1Connection {
  /** Resolves, with the reason, when the stream ends. */
  closed: Promise<string>;
  close(): void;
}

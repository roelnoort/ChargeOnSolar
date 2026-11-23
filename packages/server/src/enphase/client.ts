import type { Clock } from "../clock.ts";
import type { SolarInterval } from "../domain/solar-interval.ts";

/** Reads Solar production from the Enphase cloud. Display-only: never used in Surplus. */
export interface EnphaseClient {
  /**
   * The 5-minute production intervals of the day starting at `dayStart`, as
   * far as Enphase has them. Rejects when Enphase cannot be read.
   */
  productionIntervals(dayStart: Date): Promise<SolarInterval[]>;
}

/** Where the rotating Enphase refresh token is kept between calls and restarts. */
export interface RefreshTokenStore {
  load(): Promise<string | undefined>;
  save(refreshToken: string): Promise<void>;
}

/** What an Enphase client needs from the server it runs in. */
export interface EnphaseClientContext {
  clock: Clock;
  refreshTokens: RefreshTokenStore;
  /** Called before every request to Enphase, token requests included. */
  countCall: () => Promise<void>;
}

/** Builds the Enphase client once the server's storage is open. */
export type EnphaseClientFactory = (
  context: EnphaseClientContext
) => EnphaseClient;

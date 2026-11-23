import type { SolarInterval } from "../domain/solar-interval.ts";
import type { EnphaseClient, EnphaseClientFactory } from "../enphase/client.ts";

/** One interval the fake Enphase cloud reports. */
export interface FakeSolarInterval {
  endAt: string;
  solarProductionW: number;
  energyWh?: number;
  devicesReporting?: number;
}

/**
 * Stands in for the Enphase cloud. Like the real one, it counts a token
 * renewal (rotating the stored refresh token) at most once a day, and one
 * telemetry call per fetch.
 */
export interface FakeEnphase {
  factory: EnphaseClientFactory;
  /** The intervals Enphase has from now on; a fetch answers those of its day. */
  set(intervals: FakeSolarInterval[]): void;
  /** While true, every fetch fails. */
  unreachable: boolean;
  /**
   * Makes the next fetch's access token be rejected, as the real client sees
   * a 401: it renews and asks again, so that fetch makes two more calls.
   */
  rejectNextAccessToken(): void;
  /** The day start of every fetch, in order. */
  readonly fetches: Date[];
  /** Resolves after the next fetch has answered. */
  whenFetched(): Promise<void>;
}

const dayMs = 24 * 3600_000;
const accessTokenLifetimeMs = dayMs;

export function createFakeEnphase(): FakeEnphase {
  let intervals: SolarInterval[] = [];
  const fetches: Date[] = [];
  const fetchListeners: (() => void)[] = [];
  let rejectingAccessToken = false;

  function answered() {
    for (const listener of fetchListeners.splice(0)) listener();
  }

  const fake: FakeEnphase = {
    unreachable: false,
    fetches,
    rejectNextAccessToken() {
      rejectingAccessToken = true;
    },
    set(next) {
      intervals = next.map((interval) => ({
        endAt: new Date(interval.endAt),
        solarProductionW: interval.solarProductionW,
        energyWh: interval.energyWh ?? interval.solarProductionW / 12,
        devicesReporting: interval.devicesReporting ?? null,
      }));
    },
    factory({ clock, refreshTokens, countCall }): EnphaseClient {
      let accessTokenUntil = Number.NEGATIVE_INFINITY;
      let renewals = 0;
      return {
        async productionIntervals(dayStart) {
          fetches.push(dayStart);
          try {
            async function renew() {
              await countCall();
              if (fake.unreachable)
                throw new Error("fetch failed (fake Enphase)");
              await refreshTokens.load();
              renewals++;
              await refreshTokens.save(`fake-refresh-token-${renewals + 1}`);
              accessTokenUntil = clock.now().getTime() + accessTokenLifetimeMs;
            }
            if (clock.now().getTime() >= accessTokenUntil) await renew();
            await countCall();
            if (fake.unreachable)
              throw new Error("fetch failed (fake Enphase)");
            if (rejectingAccessToken) {
              rejectingAccessToken = false;
              await renew();
              await countCall();
            }
            const dayEnd = dayStart.getTime() + dayMs;
            return intervals
              .filter(
                ({ endAt }) =>
                  endAt.getTime() > dayStart.getTime() &&
                  endAt.getTime() <= dayEnd
              )
              .map((interval) => ({ ...interval }));
          } finally {
            queueMicrotask(answered);
          }
        },
      };
    },
    whenFetched() {
      return new Promise((resolve) => {
        fetchListeners.push(resolve);
      });
    },
  };
  return fake;
}

// The Enphase Cloud API v4 on the Watt plan (api.enphaseenergy.com).
// Read-only, and display-only: its Solar production never goes into Surplus.
import { z } from "zod";
import { CallBudgetRefusal } from "../domain/call-budget.ts";
import type { SolarInterval } from "../domain/solar-interval.ts";
import type { EnphaseClient, EnphaseClientContext } from "./client.ts";

export interface EnphaseCloudOptions extends EnphaseClientContext {
  apiKey: string;
  clientId: string;
  clientSecret: string;
  systemId: string;
  fetch?: typeof fetch;
}

const baseUrl = "https://api.enphaseenergy.com";
/** The redirect URI Enphase offers apps that have no web page of their own. */
export const enphaseRedirectUri = `${baseUrl}/oauth/redirect_uri`;
// Renew this long before the access token (about a day) runs out, not after.
const renewBeforeExpiryMs = 30 * 60_000;
const notAuthorized =
  "Enphase is not authorized: run `pnpm enphase login` once";

const tokenAnswer = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const tokenRefusal = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const productionTelemetry = z.object({
  intervals: z.array(
    z.object({
      // Seconds since the epoch.
      end_at: z.number(),
      // Average power over the interval, in watts.
      powr: z.number(),
      enwh: z.number(),
      devices_reporting: z.number().nullish(),
    })
  ),
});

class Unauthorized extends Error {}

interface TokenRequest {
  clientId: string;
  clientSecret: string;
  grant: Record<string, string>;
  countCall: () => Promise<void>;
  fetch: typeof fetch;
}

async function requestTokens({
  clientId,
  clientSecret,
  grant,
  countCall,
  fetch: fetchFn,
}: TokenRequest): Promise<z.infer<typeof tokenAnswer>> {
  await countCall();
  // Enphase takes the grant in the query string, as its docs show.
  const response = await fetchFn(
    `${baseUrl}/oauth/token?${new URLSearchParams(grant)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
    }
  );
  if (!response.ok) {
    const refusal = tokenRefusal.safeParse(
      await response.json().catch(() => undefined)
    );
    const reason = refusal.success
      ? (refusal.data.error_description ?? refusal.data.error)
      : undefined;
    throw new Error(
      `Enphase refused the ${grant.grant_type} grant (${response.status}${reason ? `: ${reason}` : ""})`
    );
  }
  return tokenAnswer.parse(await response.json());
}

export function createEnphaseCloudClient({
  apiKey,
  clientId,
  clientSecret,
  systemId,
  clock,
  refreshTokens,
  countCall,
  fetch: fetchFn = fetch,
}: EnphaseCloudOptions): EnphaseClient {
  let token: { value: string; renewAt: number } | undefined;

  async function renew(): Promise<string> {
    const refreshToken = await refreshTokens.load();
    if (!refreshToken) throw new Error(notAuthorized);
    let answer: z.infer<typeof tokenAnswer>;
    try {
      answer = await requestTokens({
        clientId,
        clientSecret,
        grant: { grant_type: "refresh_token", refresh_token: refreshToken },
        countCall,
        fetch: fetchFn,
      });
    } catch (error) {
      if (error instanceof CallBudgetRefusal) throw error;
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; ${notAuthorized}`
      );
    }
    // Enphase rotates the refresh token on every renewal.
    await refreshTokens.save(answer.refresh_token);
    token = {
      value: answer.access_token,
      renewAt:
        clock.now().getTime() + answer.expires_in * 1000 - renewBeforeExpiryMs,
    };
    return token.value;
  }

  async function accessToken(): Promise<string> {
    if (token && clock.now().getTime() < token.renewAt) return token.value;
    return renew();
  }

  async function getOnce(url: URL, bearer: string): Promise<unknown> {
    await countCall();
    const response = await fetchFn(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearer}`,
      },
    });
    if (response.status === 401) throw new Unauthorized();
    if (!response.ok) {
      throw new Error(
        `Enphase answered ${response.status} to GET ${url.pathname}`
      );
    }
    return response.json();
  }

  async function get(url: URL): Promise<unknown> {
    try {
      return await getOnce(url, await accessToken());
    } catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      token = undefined;
      try {
        return await getOnce(url, await renew());
      } catch (retryError) {
        if (retryError instanceof Unauthorized) {
          throw new Error(
            `Enphase rejected a fresh access token for GET ${url.pathname}`
          );
        }
        throw retryError;
      }
    }
  }

  return {
    async productionIntervals(dayStart) {
      const url = new URL(
        `${baseUrl}/api/v4/systems/${encodeURIComponent(systemId)}/telemetry/production_micro`
      );
      url.searchParams.set("key", apiKey);
      url.searchParams.set(
        "start_at",
        String(Math.floor(dayStart.getTime() / 1000))
      );
      url.searchParams.set("granularity", "day");
      const { intervals } = productionTelemetry.parse(await get(url));
      return intervals.map(
        (interval): SolarInterval => ({
          endAt: new Date(interval.end_at * 1000),
          solarProductionW: interval.powr,
          energyWh: interval.enwh,
          devicesReporting: interval.devices_reporting ?? null,
        })
      );
    },
  };
}

export interface AuthorizationCodeExchange {
  clientId: string;
  clientSecret: string;
  code: string;
  refreshTokens: EnphaseClientContext["refreshTokens"];
  countCall: () => Promise<void>;
  fetch?: typeof fetch;
}

/** The one-time login: trades an authorization code for the first refresh token. */
export async function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  refreshTokens,
  countCall,
  fetch: fetchFn = fetch,
}: AuthorizationCodeExchange): Promise<void> {
  const answer = await requestTokens({
    clientId,
    clientSecret,
    grant: {
      grant_type: "authorization_code",
      redirect_uri: enphaseRedirectUri,
      code,
    },
    countCall,
    fetch: fetchFn,
  });
  await refreshTokens.save(answer.refresh_token);
}

/** Where a User logs in to Enlighten and allows ChargeOnSolar to read the system. */
export function enphaseAuthorizeUrl(clientId: string): string {
  return `${baseUrl}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: enphaseRedirectUri,
  })}`;
}

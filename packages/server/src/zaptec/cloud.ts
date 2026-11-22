// The Zaptec cloud REST API (api.zaptec.com). Read-only: ChargeOnSolar never
// sends Zaptec a command or a setting.
import { type PhaseSetting, phaseSetting } from "@charge-on-solar/shared";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import type { Clock } from "../clock.ts";
import type { ChargerReading } from "../domain/charger-reading.ts";
import type { ZaptecClient } from "./client.ts";

export interface ZaptecCloudOptions {
  username: string;
  password: string;
  clock: Clock;
  fetch?: typeof fetch;
}

const baseUrl = "https://api.zaptec.com";
// Zaptec's fair-use policy asks for a User-Agent of the form AppName/Version.
const userAgent = `ChargeOnSolar/${packageJson.version}`;
// Log in again this long before the token runs out, not after.
const renewBeforeExpiryMs = 5 * 60_000;

/** Zaptec state observation IDs, from `GET /api/constants`. */
const stateIds = {
  currentPhase1: 507,
  currentPhase2: 508,
  currentPhase3: 509,
  chargerMaxCurrent: 510,
  totalChargePower: 513,
  maxPhases: 520,
  chargeCurrentSet: 708,
  chargerOperationMode: 710,
  finalStopActive: 718,
  nextScheduleEvent: 763,
} as const;

const tokenAnswer = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const chargerList = z.object({
  data: z.array(z.object({ id: z.string(), installationId: z.string() })),
});

const chargerState = z.array(
  z.object({ stateId: z.number(), valueAsString: z.string().nullish() })
);

const installation = z.object({
  availableCurrentMode: z.number().nullish(),
  enabledFeatures: z.number().nullish(),
  surplusMode: z.object({ active: z.boolean() }).nullish(),
});

/**
 * Zaptec's docs show camelCase JSON; its API has been seen to answer in
 * PascalCase. Both parse the same once the first letter of each key is lower.
 */
function camelKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key.charAt(0).toLowerCase() + key.slice(1),
      camelKeys(inner),
    ])
  );
}

export function toChargerReading(
  raw: { charger: unknown; installation: unknown },
  receivedAt: Date
): ChargerReading {
  const states = new Map(
    chargerState
      .parse(camelKeys(raw.charger))
      .map((state) => [state.stateId, state.valueAsString ?? null])
  );
  const text = (id: number) => {
    const value = states.get(id);
    return value === undefined || value === null || value === "" ? null : value;
  };
  const number = (id: number) => {
    const value = Number(text(id) ?? Number.NaN);
    return Number.isFinite(value) ? value : null;
  };
  const site = installation.parse(camelKeys(raw.installation));

  return {
    receivedAt,
    chargerPowerW: number(stateIds.totalChargePower),
    chargingCurrentSetA: number(stateIds.chargeCurrentSet),
    operationMode: number(stateIds.chargerOperationMode),
    finalStopActive: number(stateIds.finalStopActive) === 1,
    nextScheduleEvent: text(stateIds.nextScheduleEvent),
    phaseSetting: toPhaseSetting(number(stateIds.maxPhases)),
    maxCurrentA: number(stateIds.chargerMaxCurrent),
    phaseCurrentsA: {
      l1: number(stateIds.currentPhase1),
      l2: number(stateIds.currentPhase2),
      l3: number(stateIds.currentPhase3),
    },
    availableCurrentMode: site.availableCurrentMode ?? null,
    enabledFeatures: site.enabledFeatures ?? null,
    surplusModeActive: site.surplusMode?.active ?? null,
    rawState: JSON.stringify(raw),
  };
}

function toPhaseSetting(maxPhases: number | null): PhaseSetting | null {
  const parsed = phaseSetting.safeParse(maxPhases);
  return parsed.success ? parsed.data : null;
}

class Unauthorized extends Error {}

export function createZaptecCloudClient({
  username,
  password,
  clock,
  fetch: fetchFn = fetch,
}: ZaptecCloudOptions): ZaptecClient {
  let token: { value: string; renewAt: number } | undefined;
  let charger: { id: string; installationId: string } | undefined;

  async function logIn(): Promise<string> {
    const response = await fetchFn(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": userAgent,
      },
      body: new URLSearchParams({ grant_type: "password", username, password }),
    });
    if (!response.ok) {
      throw new Error(`Zaptec refused the login (${response.status})`);
    }
    const answer = tokenAnswer.parse(await response.json());
    token = {
      value: answer.access_token,
      renewAt:
        clock.now().getTime() + answer.expires_in * 1000 - renewBeforeExpiryMs,
    };
    return token.value;
  }

  async function accessToken(): Promise<string> {
    if (token && clock.now().getTime() < token.renewAt) return token.value;
    return logIn();
  }

  async function getOnce(path: string, bearer: string): Promise<unknown> {
    const response = await fetchFn(`${baseUrl}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearer}`,
        "user-agent": userAgent,
      },
    });
    if (response.status === 401) throw new Unauthorized();
    if (!response.ok) {
      throw new Error(`Zaptec answered ${response.status} to GET ${path}`);
    }
    return response.json();
  }

  async function get(path: string): Promise<unknown> {
    try {
      return await getOnce(path, await accessToken());
    } catch (error) {
      if (!(error instanceof Unauthorized)) throw error;
      token = undefined;
      try {
        return await getOnce(path, await logIn());
      } catch (retryError) {
        if (retryError instanceof Unauthorized) {
          throw new Error(`Zaptec rejected a fresh token for GET ${path}`);
        }
        throw retryError;
      }
    }
  }

  // Zaptec's fair-use policy: fetch the charger list at most once an hour.
  // A home has one charger that does not move, so once is enough.
  async function findCharger() {
    if (charger) return charger;
    const [first] = chargerList.parse(
      camelKeys(await get("/api/chargers"))
    ).data;
    if (!first) throw new Error("The Zaptec account has no charger");
    charger = first;
    return charger;
  }

  return {
    async read() {
      const { id, installationId } = await findCharger();
      const chargerRaw = await get(`/api/chargers/${id}/state`);
      const installationRaw = await get(`/api/installation/${installationId}`);
      return toChargerReading(
        { charger: chargerRaw, installation: installationRaw },
        clock.now()
      );
    },
  };
}

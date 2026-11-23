import {
  type SolarRefreshResponse,
  solarBudgetPath,
  solarRefreshPath,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Clock } from "../clock.ts";
import { CallBudgetRefusal } from "../domain/call-budget.ts";
import {
  currentCallBudget,
  type SolarCollection,
} from "../enphase/solar-collection.ts";
import type { Storage } from "../storage/index.ts";
import { messageOf } from "../supervision.ts";
import { toLiveSolar } from "./live.ts";
import type { SessionEnv } from "./session.ts";

export interface SolarRouteDependencies {
  /** Undefined while Enphase is not set up in `.env`. */
  solar: SolarCollection | undefined;
  storage: Storage;
  clock: Clock;
}

export function addSolarRoutes(
  app: Hono<SessionEnv>,
  { solar, storage, clock }: SolarRouteDependencies
) {
  app.get(solarBudgetPath, async (c) =>
    c.json(await currentCallBudget(storage, clock))
  );

  app.post(solarRefreshPath, async (c) => {
    if (!solar) {
      throw new HTTPException(503, { message: "Enphase is not set up" });
    }
    let latest: Awaited<ReturnType<SolarCollection["refresh"]>>;
    try {
      latest = await solar.refresh();
    } catch (error) {
      if (error instanceof CallBudgetRefusal) {
        throw new HTTPException(429, { message: error.message });
      }
      throw new HTTPException(502, {
        message: `Enphase could not be read: ${messageOf(error)}`,
      });
    }
    const body: SolarRefreshResponse = {
      solar: toLiveSolar(latest),
      budget: await currentCallBudget(storage, clock),
    };
    return c.json(body);
  });
}

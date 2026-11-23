import {
  type ShadowDecisionList,
  type ShadowDecisionRecord,
  shadowDecisionQuery,
  shadowDecisionsPath,
} from "@charge-on-solar/shared";
import type { Hono } from "hono";
import type { RecordedShadowDecision } from "../domain/shadow/recorded-decision.ts";
import type { Storage } from "../storage/index.ts";
import { parseOr400 } from "./parse.ts";
import type { SessionEnv } from "./session.ts";

export function toShadowDecisionRecord({
  at,
  decision,
  simulated,
  phaseSetting,
  inputs,
  zaptec,
  stamp,
}: RecordedShadowDecision): ShadowDecisionRecord {
  return {
    at: at.toISOString(),
    decision,
    chargingCurrentA: simulated.currentAmps,
    phaseSetting,
    inputs,
    zaptec,
    rulesVersion: stamp.rulesVersion,
    settings: stamp.settings,
  };
}

export function addShadowRoutes(
  app: Hono<SessionEnv>,
  { storage }: { storage: Storage }
) {
  app.get(shadowDecisionsPath, async (c) => {
    const { from, to, limit } = parseOr400(shadowDecisionQuery, c.req.query());
    const decisions = await storage.listShadowDecisions({
      from: new Date(from),
      to: new Date(to),
      limit,
    });
    const body: ShadowDecisionList = {
      decisions: decisions.map(toShadowDecisionRecord),
    };
    return c.json(body);
  });
}

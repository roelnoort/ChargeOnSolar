// `pnpm enphase login`: the one-time authorization that lets ChargeOnSolar
// read the Enphase system. After it, the server renews its tokens itself.
import { z } from "zod";
import type { Clock } from "./clock.ts";
import { amsterdamMonth } from "./domain/amsterdam-time.ts";
import {
  enphaseAuthorizeUrl,
  exchangeAuthorizationCode,
} from "./enphase/cloud.ts";
import type { EnphaseLoginSettings } from "./enphase/from-env.ts";
import { createRefreshTokenStore } from "./enphase/refresh-token-store.ts";
import type { Storage } from "./storage/index.ts";
import { messageOf } from "./supervision.ts";

export const enphaseUsage = [
  "Usage:",
  "  pnpm enphase login             where to authorize ChargeOnSolar",
  "  pnpm enphase login <address>   finish, with the address Enphase sent you to",
];

const command = z.union([
  z.tuple([z.literal("login")]),
  z.tuple([z.literal("login"), z.string().trim().min(1)]),
]);

export interface EnphaseCommandResult {
  exitCode: 0 | 1;
  output: string[];
}

export interface EnphaseCommandDependencies {
  storage: Storage;
  clock: Clock;
  login: EnphaseLoginSettings;
  fetch?: typeof fetch;
}

/** The authorization code in the redirect address, or the argument itself. */
function codeIn(addressOrCode: string): string {
  if (!URL.canParse(addressOrCode)) return addressOrCode;
  return new URL(addressOrCode).searchParams.get("code") ?? addressOrCode;
}

export async function runEnphaseCommand(
  args: string[],
  { storage, clock, login, fetch: fetchFn }: EnphaseCommandDependencies
): Promise<EnphaseCommandResult> {
  const parsed = command.safeParse(args);
  if (!parsed.success) return { exitCode: 1, output: enphaseUsage };

  const [, addressOrCode] = parsed.data;
  if (addressOrCode === undefined) {
    return {
      exitCode: 0,
      output: [
        "1. Open this address, log in with your Enlighten account and approve:",
        `   ${enphaseAuthorizeUrl(login.clientId)}`,
        "2. Enphase sends your browser to an address with ?code=… in it.",
        "   The page may look empty; copy the full address anyway.",
        "3. Run: pnpm enphase login '<that address>'",
      ],
    };
  }

  try {
    await exchangeAuthorizationCode({
      clientId: login.clientId,
      clientSecret: login.clientSecret,
      code: codeIn(addressOrCode),
      refreshTokens: createRefreshTokenStore({
        storage,
        key: login.refreshTokenKey,
      }),
      countCall: () =>
        storage.countEnphaseCalls(amsterdamMonth(clock.now()), 1),
      fetch: fetchFn,
    });
  } catch (error) {
    return { exitCode: 1, output: [messageOf(error)] };
  }
  return { exitCode: 0, output: ["Enphase authorized ChargeOnSolar"] };
}

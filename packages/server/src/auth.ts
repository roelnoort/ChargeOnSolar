// Login by emailed code, and the sessions it opens. Knows nothing about HTTP:
// the API maps its results onto responses.
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import type { Clock } from "./clock.ts";
import type {
  SignedInDevice,
  SignedInDeviceOfUser,
} from "./domain/signed-in-device.ts";
import type { User } from "./domain/user.ts";
import type { Mailer } from "./mailer.ts";
import type { Storage } from "./storage/index.ts";

const minute = 60_000;
const day = 24 * 60 * minute;

export const loginCodeLifetime = 10 * minute;
/** At most this many Login code requests per address in the window. */
export const loginCodeRequestLimit = { requests: 5, window: 60 * minute };
export const wrongAttemptCap = 5;
/** A session lasts this long after it was last used. */
export const sessionLifetime = 90 * day;

export interface AuthDependencies {
  storage: Storage;
  mailer: Mailer;
  clock: Clock;
  log: (line: string) => void;
}

export interface LoggedIn extends SignedInDeviceOfUser {
  token: string;
}

export type Auth = ReturnType<typeof createAuth>;

export function createAuth({ storage, mailer, clock, log }: AuthDependencies) {
  /**
   * Emails a Login code if the address belongs to a User. The answer is the
   * same either way, so it does not tell who has an account.
   */
  async function requestLoginCode(
    email: string
  ): Promise<"sent" | "rate-limited"> {
    const now = clock.now();
    const allowed = await storage.recordLoginCodeRequest(email, now, {
      requests: loginCodeRequestLimit.requests,
      after: new Date(now.getTime() - loginCodeRequestLimit.window),
    });
    if (!allowed) return "rate-limited";

    const user = await storage.findUserByEmail(email);
    if (!user) return "sent";
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await storage.saveLoginCode({
      userId: user.id,
      codeHash: hashCode(user, code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + loginCodeLifetime),
    });
    // Not awaited: waiting for SMTP would make a known address answer slower.
    mailer.sendLoginCode({ to: user.email, code }).catch((error: unknown) => {
      log(`Sending a Login code to ${user.email} failed: ${String(error)}`);
    });
    return "sent";
  }

  /** Trades a live Login code for a new Signed-in device. */
  async function logIn(attempt: {
    email: string;
    code: string;
    deviceName: string;
  }): Promise<LoggedIn | undefined> {
    const now = clock.now();
    const user = await storage.findUserByEmail(attempt.email);
    if (!user) return undefined;
    const token = randomBytes(32).toString("base64url");
    const candidate = hashCode(user, attempt.code);
    const device = await storage.redeemLoginCode(
      { matches: (codeHash) => sameHash(codeHash, candidate), wrongAttemptCap },
      {
        userId: user.id,
        tokenHash: hashToken(token),
        deviceName: attempt.deviceName,
        at: now,
      }
    );
    if (!device) return undefined;
    return { token, device, user };
  }

  /** Finds the session a token opens, and counts this as a use of it. */
  async function authenticate(
    token: string
  ): Promise<SignedInDeviceOfUser | undefined> {
    const found = await storage.findSignedInDevice(hashToken(token));
    if (!found) return undefined;
    const now = clock.now();
    if (now.getTime() - found.device.lastUsedAt.getTime() >= sessionLifetime) {
      await storage.removeSignedInDevice(found.user.id, found.device.id);
      return undefined;
    }
    await storage.touchSignedInDevice(found.device.id, now);
    return { user: found.user, device: { ...found.device, lastUsedAt: now } };
  }

  /** The User's devices whose session is still live, most recent first. */
  async function signedInDevicesOf(user: User): Promise<SignedInDevice[]> {
    const now = clock.now();
    return storage.listSignedInDevices(
      user.id,
      new Date(now.getTime() - sessionLifetime)
    );
  }

  return { requestLoginCode, logIn, authenticate, signedInDevicesOf };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashCode(user: User, code: string): string {
  return createHash("sha256").update(`${user.id}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

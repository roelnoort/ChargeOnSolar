import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Storage } from "../storage/index.ts";
import type { RefreshTokenStore } from "./client.ts";

export interface RefreshTokenStoreOptions {
  storage: Storage;
  /** The 32-byte AES-256 key, from `.env`. */
  key: Buffer;
}

const algorithm = "aes-256-gcm";
const version = "v1";
// Binds the ciphertext to its purpose, so it cannot pass for another secret.
const associatedData = Buffer.from("enphase-refresh-token");

/**
 * Keeps the rotating Enphase refresh token in app state, sealed with
 * AES-256-GCM: a fresh random IV each time, and the tag checked on reading.
 */
export function createRefreshTokenStore({
  storage,
  key,
}: RefreshTokenStoreOptions): RefreshTokenStore {
  if (key.length !== 32) {
    throw new Error("The Enphase token key must be 32 bytes");
  }
  return {
    async load() {
      const sealed = await storage.sealedEnphaseRefreshToken();
      return sealed === undefined ? undefined : unseal(sealed, key);
    },
    async save(refreshToken) {
      await storage.saveSealedEnphaseRefreshToken(seal(refreshToken, key));
    },
  };
}

function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return [version, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(".");
}

function unseal(sealed: string, key: Buffer): string {
  const [sealedVersion, iv, tag, ciphertext] = sealed.split(".");
  if (sealedVersion !== version || !iv || !tag || ciphertext === undefined) {
    throw new Error("The stored Enphase refresh token is not readable");
  }
  const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "base64"));
  decipher.setAAD(associatedData);
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

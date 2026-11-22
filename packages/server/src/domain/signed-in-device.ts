import type { User } from "./user.ts";

/** A device a User signed in on: one session, known by its token's hash. */
export interface SignedInDevice {
  id: number;
  userId: number;
  deviceName: string;
  signedInAt: Date;
  lastUsedAt: Date;
}

export interface NewSignedInDevice {
  userId: number;
  tokenHash: string;
  deviceName: string;
  at: Date;
}

export interface SignedInDeviceOfUser {
  device: SignedInDevice;
  user: User;
}

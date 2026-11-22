/** A Login code as storage keeps it: only its hash, never the code. */
export interface StoredLoginCode {
  id: number;
  userId: number;
  codeHash: string;
  expiresAt: Date;
  wrongAttempts: number;
}

export interface NewLoginCode {
  userId: number;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

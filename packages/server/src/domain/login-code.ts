/** A new Login code as storage keeps it: only its hash, never the code. */
export interface NewLoginCode {
  userId: number;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

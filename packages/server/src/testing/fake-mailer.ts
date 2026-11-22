import type { Mailer } from "../mailer.ts";

export interface FakeMailer extends Mailer {
  /** Every Login code sent, oldest first. */
  sent: { to: string; code: string }[];
  lastCodeFor(email: string): string | undefined;
}

export function createFakeMailer(): FakeMailer {
  const sent: { to: string; code: string }[] = [];
  return {
    sent,
    async sendLoginCode(message) {
      sent.push(message);
    },
    lastCodeFor: (email) => sent.findLast(({ to }) => to === email)?.code,
  };
}

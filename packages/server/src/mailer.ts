import { createTransport } from "nodemailer";
import { z } from "zod";

/** Sends the emails the server sends: for now, only Login codes. */
export interface Mailer {
  sendLoginCode(message: { to: string; code: string }): Promise<void>;
}

export const smtpSettings = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  MAIL_FROM: z.string().min(1),
});
export type SmtpSettings = z.infer<typeof smtpSettings>;

export function loginCodeEmail(code: string) {
  return {
    subject: `${code} is your ChargeOnSolar login code`,
    text: `Your ChargeOnSolar login code is ${code}.\n\nIt works once, for 10 minutes. If you did not ask for it, you can ignore this email.`,
  };
}

/** Sends over SMTP; in production, Lettermint's. */
export function createSmtpMailer(settings: SmtpSettings): Mailer {
  const transport = createTransport({
    host: settings.SMTP_HOST,
    port: settings.SMTP_PORT,
    // Port 465 speaks TLS from the start; others upgrade with STARTTLS.
    secure: settings.SMTP_PORT === 465,
    requireTLS: settings.SMTP_PORT !== 465,
    auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD },
  });
  return {
    async sendLoginCode({ to, code }) {
      await transport.sendMail({
        from: settings.MAIL_FROM,
        to,
        ...loginCodeEmail(code),
      });
    },
  };
}

/** For development without SMTP: writes each code to the log instead. */
export function createLoggingMailer(log: (line: string) => void): Mailer {
  return {
    async sendLoginCode({ to, code }) {
      log(`Login code for ${to}: ${code} (SMTP is not configured)`);
    },
  };
}

/** The SMTP mailer when `.env` configures one, else the logging mailer. */
export function mailerFromEnv(
  env: Record<string, string | undefined>,
  log: (line: string) => void
): Mailer {
  if (!env.SMTP_HOST) {
    log("SMTP_HOST is not set: Login codes go to this log, not by email");
    return createLoggingMailer(log);
  }
  return createSmtpMailer(smtpSettings.parse(env));
}

import {
  loginCode,
  loginCodeRequest,
  type Session,
} from "@charge-on-solar/shared";
import { type FormEvent, useState } from "react";
import type { ApiClient } from "./api/client.ts";
import { deviceNameFor } from "./device-name.ts";

type Step = { kind: "email" } | { kind: "code"; email: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LoginScreen({
  api,
  onSignedIn,
}: {
  api: ApiClient;
  onSignedIn: (session: Session) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const requestCode = (event: FormEvent) =>
    submit(event, async () => {
      const { email: address } = loginCodeRequest.parse({ email });
      await api.requestLoginCode(address);
      setCode("");
      setStep({ kind: "code", email: address });
    });

  const logIn = (event: FormEvent, address: string) =>
    submit(event, async () => {
      const session = await api.logIn({
        email: address,
        code,
        deviceName: deviceNameFor(navigator.userAgent),
      });
      onSignedIn(session);
    });

  return (
    <section className="login" aria-labelledby="login-heading">
      <h2 id="login-heading">Log in</h2>
      {step.kind === "email" ? (
        <form onSubmit={requestCode}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || !loginCodeRequest.safeParse({ email }).success}
          >
            Email me a code
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => logIn(event, step.email)}>
          <p>
            If <strong>{step.email}</strong> belongs to a household member, a
            6-digit code is on its way. It works for 10 minutes.
          </p>
          <label htmlFor="login-code">Code</label>
          <input
            id="login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || !loginCode.safeParse(code).success}
          >
            Log in
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setError(undefined);
              setStep({ kind: "email" });
            }}
          >
            Use another email
          </button>
        </form>
      )}
      {error && (
        <p className="status status-down" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

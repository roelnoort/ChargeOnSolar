import {
  loginCode,
  loginCodeRequest,
  loginCodeRules,
  type Session,
} from "@charge-on-solar/shared";
import { type FormEvent, useState } from "react";
import type { ApiClient } from "./api/client.ts";
import { deviceNameFor } from "./device-name.ts";
import { messageOf } from "./message-of.ts";

type Step = { kind: "email" } | { kind: "code"; email: string };

export function LoginScreen({
  api,
  onSignedIn,
}: {
  api: ApiClient;
  onSignedIn: (session: Session) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
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
      setStep({ kind: "code", email: address });
    });

  const logIn = (event: FormEvent, address: string, code: string) =>
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
        <CodeForm
          key={step.email}
          email={step.email}
          busy={busy}
          onSubmit={(event, code) => logIn(event, step.email, code)}
          onUseAnotherEmail={() => {
            setError(undefined);
            setStep({ kind: "email" });
          }}
        />
      )}
      {error && (
        <p className="status status-down" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The code step, keyed on its email so a new address starts with no code. */
function CodeForm({
  email,
  busy,
  onSubmit,
  onUseAnotherEmail,
}: {
  email: string;
  busy: boolean;
  onSubmit: (event: FormEvent, code: string) => void;
  onUseAnotherEmail: () => void;
}) {
  const [code, setCode] = useState("");
  return (
    <form onSubmit={(event) => onSubmit(event, code)}>
      <p>
        If <strong>{email}</strong> belongs to a household member, a{" "}
        {loginCodeRules.digits}-digit code is on its way. It works for{" "}
        {loginCodeRules.lifetimeMinutes} minutes.
      </p>
      <label htmlFor="login-code">Code</label>
      <input
        id="login-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={loginCodeRules.digits}
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
      <button type="button" className="link" onClick={onUseAnotherEmail}>
        Use another email
      </button>
    </form>
  );
}

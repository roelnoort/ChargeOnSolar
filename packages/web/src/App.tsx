import type { Health, Session } from "@charge-on-solar/shared";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createApiClient, NotSignedInError } from "./api/client.ts";
import type { Clock } from "./clock.ts";
import { LoginScreen } from "./LoginScreen.tsx";
import { NowView } from "./live/NowView.tsx";
import { messageOf } from "./message-of.ts";
import { SignedInDevicesScreen } from "./SignedInDevicesScreen.tsx";

const api = createApiClient();

const tabs = [
  { id: "now", label: "Now" },
  { id: "day", label: "Day" },
  { id: "devices", label: "Devices" },
] as const;
type Tab = (typeof tabs)[number]["id"];

type SessionState =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; session: Session }
  | { kind: "unreachable"; message: string };

function useSession() {
  const [state, setState] = useState<SessionState>({ kind: "checking" });
  useEffect(() => {
    let current = true;
    api.session().then(
      (session) => current && setState({ kind: "signed-in", session }),
      (error: unknown) =>
        current &&
        setState(
          error instanceof NotSignedInError
            ? { kind: "signed-out" }
            : { kind: "unreachable", message: messageOf(error) }
        )
    );
    return () => {
      current = false;
    };
  }, []);
  const signedIn = useCallback(
    (session: Session) => setState({ kind: "signed-in", session }),
    []
  );
  const signedOut = useCallback(() => setState({ kind: "signed-out" }), []);
  return { state, signedIn, signedOut };
}

type ServerState =
  | { kind: "loading" }
  | { kind: "up"; health: Health }
  | { kind: "down"; message: string };

function useServerHealth(): ServerState {
  const [state, setState] = useState<ServerState>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    api.health().then(
      (health) => current && setState({ kind: "up", health }),
      (error: unknown) =>
        current && setState({ kind: "down", message: messageOf(error) })
    );
    return () => {
      current = false;
    };
  }, []);
  return state;
}

function ServerStatus({ state }: { state: ServerState }) {
  switch (state.kind) {
    case "loading":
      return <p className="status">Connecting to the server…</p>;
    case "down":
      return (
        <p className="status status-down" role="alert">
          Server unreachable: {state.message}
        </p>
      );
    case "up":
      return (
        <p className="status status-up">
          Server {state.health.version}, running since{" "}
          <time dateTime={state.health.startedAt}>
            {new Date(state.health.startedAt).toLocaleString()}
          </time>
        </p>
      );
  }
}

export function App({ clock }: { clock: Clock }) {
  const { state, signedIn, signedOut } = useSession();

  switch (state.kind) {
    case "checking":
      return (
        <Shell>
          <p className="status">Connecting to the server…</p>
        </Shell>
      );
    case "unreachable":
      return (
        <Shell>
          <ServerStatus state={{ kind: "down", message: state.message }} />
        </Shell>
      );
    case "signed-out":
      return (
        <Shell>
          <LoginScreen api={api} onSignedIn={signedIn} />
        </Shell>
      );
    case "signed-in":
      return (
        <SignedInApp
          clock={clock}
          session={state.session}
          onSignedOut={signedOut}
        />
      );
  }
}

function Shell({
  children,
  user,
  tabBar,
}: {
  children: ReactNode;
  user?: string;
  tabBar?: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="top-bar">
        <h1>ChargeOnSolar</h1>
        {user && <span className="signed-in-as">{user}</span>}
      </header>
      <main className="content">{children}</main>
      {tabBar}
    </div>
  );
}

function SignedInApp({
  clock,
  session,
  onSignedOut,
}: {
  clock: Clock;
  session: Session;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("now");
  const server = useServerHealth();

  const tabBar = (
    <nav className="tab-bar" aria-label="Views">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className="tab"
          aria-current={tab === id ? "page" : undefined}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  return (
    <Shell user={session.user.name} tabBar={tabBar}>
      {tab === "now" && (
        <section aria-labelledby="now-heading">
          <h2 id="now-heading">Now</h2>
          <NowView clock={clock} api={api} />
        </section>
      )}
      {tab === "day" && (
        <section aria-labelledby="day-heading">
          <h2 id="day-heading">Day</h2>
          <p className="placeholder">
            The day's Readings and Shadow decisions will show here.
          </p>
        </section>
      )}
      {tab === "devices" && (
        <SignedInDevicesScreen api={api} onSignedOut={onSignedOut} />
      )}
      <ServerStatus state={server} />
    </Shell>
  );
}

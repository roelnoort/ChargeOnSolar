import type { Health } from "@charge-on-solar/shared";
import { useEffect, useState } from "react";
import { createApiClient } from "./api/client.ts";
import type { Clock } from "./clock.ts";
import { NowView } from "./live/NowView.tsx";

const api = createApiClient();

const tabs = [
  { id: "now", label: "Now" },
  { id: "day", label: "Day" },
] as const;
type Tab = (typeof tabs)[number]["id"];

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
        current &&
        setState({
          kind: "down",
          message: error instanceof Error ? error.message : String(error),
        })
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
  const [tab, setTab] = useState<Tab>("now");
  const server = useServerHealth();

  return (
    <div className="shell">
      <header className="top-bar">
        <h1>ChargeOnSolar</h1>
      </header>

      <main className="content">
        {tab === "now" ? (
          <section aria-labelledby="now-heading">
            <h2 id="now-heading">Now</h2>
            <NowView clock={clock} />
          </section>
        ) : (
          <section aria-labelledby="day-heading">
            <h2 id="day-heading">Day</h2>
            <p className="placeholder">
              The day's Readings and Shadow decisions will show here.
            </p>
          </section>
        )}
        <ServerStatus state={server} />
      </main>

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
    </div>
  );
}

import {
  type Settings,
  type SolarMode,
  solarMode,
} from "@charge-on-solar/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type ApiClient, NotSignedInError } from "../api/client.ts";
import { messageOf } from "../message-of.ts";
import { parseDraft, type Threshold, toDraft } from "./draft.ts";

const solarModeText: Record<SolarMode, { label: string; explanation: string }> =
  {
    "solar-only": {
      label: "Solar only",
      explanation:
        "Charge only when the Surplus covers the charger's minimum current.",
    },
    "all-solar": {
      label: "All solar",
      explanation:
        "Put every bit of Surplus into the car, topping up from the grid to reach the minimum current.",
    },
  };

const thresholds: { name: Threshold; label: string; unit: string }[] = [
  { name: "startWindowMinutes", label: "Start window", unit: "min" },
  { name: "stopWindowMinutes", label: "Stop window", unit: "min" },
  { name: "minimumOnTimeMinutes", label: "Minimum on-time", unit: "min" },
  { name: "minimumOffTimeMinutes", label: "Minimum off-time", unit: "min" },
  { name: "currentHoldMinutes", label: "Current hold", unit: "min" },
  { name: "deadBandAmps", label: "Dead band", unit: "A" },
  { name: "minimumSolarWatts", label: "Minimum solar (All solar)", unit: "W" },
  { name: "voltage", label: "Voltage", unit: "V" },
  { name: "mainFuseAmps", label: "Main fuse", unit: "A" },
  { name: "tickIntervalSeconds", label: "Tick interval", unit: "s" },
];

type SettingsState =
  | { kind: "loading" }
  | { kind: "loaded"; settings: Settings }
  | { kind: "failed"; message: string };

export function SettingsScreen({
  api,
  onSignedOut,
}: {
  api: ApiClient;
  onSignedOut: () => void;
}) {
  const [state, setState] = useState<SettingsState>({ kind: "loading" });

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof NotSignedInError) onSignedOut();
      else setState({ kind: "failed", message: messageOf(error) });
    },
    [onSignedOut]
  );

  useEffect(() => {
    api
      .settings()
      .then((settings) => setState({ kind: "loaded", settings }), fail);
  }, [api, fail]);

  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      {state.kind === "loading" && <p className="status">Loading…</p>}
      {state.kind === "failed" && (
        <p className="status status-down" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && (
        <SettingsForm
          saved={state.settings}
          save={api.saveSettings}
          onSignedOut={onSignedOut}
        />
      )}
    </section>
  );
}

function SettingsForm({
  saved,
  save,
  onSignedOut,
}: {
  saved: Settings;
  save: (next: Settings) => Promise<Settings>;
  onSignedOut: () => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(saved));
  const [kept, setKept] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<
    { kind: "saved" } | { kind: "failed"; message: string } | undefined
  >();
  const parsed = parseDraft(draft);
  const changed =
    parsed.ok && JSON.stringify(parsed.settings) !== JSON.stringify(kept);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed.ok) return;
    setSaving(true);
    try {
      setKept(await save(parsed.settings));
      setOutcome({ kind: "saved" });
    } catch (error) {
      if (error instanceof NotSignedInError) onSignedOut();
      else setOutcome({ kind: "failed", message: messageOf(error) });
    } finally {
      setSaving(false);
    }
  }

  function edit(change: Partial<typeof draft>) {
    setDraft({ ...draft, ...change });
    setOutcome(undefined);
  }

  return (
    <form className="settings" onSubmit={submit}>
      <fieldset className="solar-modes">
        <legend>Solar mode</legend>
        {solarMode.options.map((mode) => (
          <label key={mode} className="solar-mode">
            <input
              type="radio"
              name="solar-mode"
              value={mode}
              checked={draft.solarMode === mode}
              onChange={() => edit({ solarMode: mode })}
            />
            <span>
              <strong>{solarModeText[mode].label}</strong>
              <span className="status">{solarModeText[mode].explanation}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="thresholds">
        <legend>Shadow rule thresholds</legend>
        {thresholds.map(({ name, label, unit }) => (
          <label key={name} className="threshold">
            <span>{label}</span>
            <span className="threshold-input">
              <input
                inputMode="decimal"
                value={draft[name]}
                onChange={(event) => edit({ [name]: event.target.value })}
              />
              <span className="status">{unit}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {!parsed.ok && (
        <p className="status status-down" role="alert">
          {parsed.message}
        </p>
      )}
      {outcome?.kind === "failed" && (
        <p className="status status-down" role="alert">
          {outcome.message}
        </p>
      )}
      {outcome?.kind === "saved" && (
        <p className="status" role="status">
          Saved. The next Shadow decision follows these Settings.
        </p>
      )}
      <button type="submit" className="primary" disabled={!changed || saving}>
        Save
      </button>
    </form>
  );
}

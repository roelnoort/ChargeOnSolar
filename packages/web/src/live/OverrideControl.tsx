import type { LiveSnapshot, ManualOverride } from "@charge-on-solar/shared";
import { useState } from "react";
import type { ApiClient } from "../api/client.ts";
import { messageOf } from "../message-of.ts";
import {
  describeOverride,
  describeOverrideButton,
  describeSwitchBudget,
  newerOverride,
} from "./override.ts";

/** The one big Pause/Resume button, how the last Manual override went, and the Switch budget. */
export function OverrideControl({
  api,
  snapshot,
  streamOverride,
  chargerStale,
}: {
  api: ApiClient;
  snapshot: LiveSnapshot;
  /** The latest step any screen's override reached, from the live stream. */
  streamOverride: ManualOverride | undefined;
  chargerStale: boolean;
}) {
  const [sending, setSending] = useState(false);
  const [ownOverride, setOwnOverride] = useState<ManualOverride>();
  const [error, setError] = useState<string>();
  const button = describeOverrideButton({
    availability: snapshot.override,
    chargerStale,
    sending,
  });
  const shown = newerOverride(ownOverride, streamOverride);
  const progress = shown && describeOverride(shown);
  const budget = describeSwitchBudget(snapshot.switchBudget);

  async function send() {
    setSending(true);
    setError(undefined);
    try {
      setOwnOverride(await api.sendOverride(button.command));
    } catch (sendError) {
      setError(messageOf(sendError));
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="card override" aria-labelledby="override-heading">
      <h3 id="override-heading">Manual override</h3>
      <div className="override-row">
        <button
          type="button"
          className="primary override-button"
          disabled={button.disabledBecause !== null}
          aria-describedby="override-reason"
          onClick={() => void send()}
        >
          {button.label}
        </button>
        {budget && <p className="override-budget">{budget}</p>}
      </div>
      <p id="override-reason" className="override-reason">
        {button.disabledBecause}
      </p>
      {sending && !progress && (
        <p className="override-progress" role="status">
          Sending…
        </p>
      )}
      {progress && (
        <p
          className={
            progress.failed
              ? "override-progress override-failed"
              : "override-progress"
          }
          role="status"
        >
          {progress.text} <span className="override-by">({progress.by})</span>
        </p>
      )}
      {error && (
        <p className="override-progress override-failed" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

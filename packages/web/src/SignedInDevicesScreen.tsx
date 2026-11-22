import type { SignedInDevice } from "@charge-on-solar/shared";
import { useCallback, useEffect, useState } from "react";
import { type ApiClient, NotSignedInError } from "./api/client.ts";
import { messageOf } from "./message-of.ts";

type DevicesState =
  | { kind: "loading" }
  | { kind: "loaded"; devices: SignedInDevice[] }
  | { kind: "failed"; message: string };

export function SignedInDevicesScreen({
  api,
  onSignedOut,
}: {
  api: ApiClient;
  onSignedOut: () => void;
}) {
  const [state, setState] = useState<DevicesState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof NotSignedInError) onSignedOut();
      else setState({ kind: "failed", message: messageOf(error) });
    },
    [onSignedOut]
  );

  const load = useCallback(
    () =>
      api
        .signedInDevices()
        .then((devices) => setState({ kind: "loaded", devices }), fail),
    [api, fail]
  );

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  async function act(action: () => Promise<void>, signsOutHere: boolean) {
    setBusy(true);
    try {
      await action();
      if (signsOutHere) onSignedOut();
      else await load();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="devices-heading">
      <h2 id="devices-heading">Signed-in devices</h2>
      {state.kind === "loading" && <p className="status">Loading…</p>}
      {state.kind === "failed" && (
        <p className="status status-down" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && (
        <ul className="devices">
          {state.devices.map((device) => (
            <li key={device.id} className="device">
              <div>
                <strong>{device.deviceName}</strong>
                {device.current && <span className="badge">This device</span>}
                <p className="status">
                  Last used{" "}
                  <time dateTime={device.lastUsedAt}>
                    {new Date(device.lastUsedAt).toLocaleString()}
                  </time>
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      device.current
                        ? api.logOut()
                        : api.revokeSignedInDevice(device.id),
                    device.current
                  )
                }
              >
                {device.current ? "Sign out" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="danger"
        disabled={busy}
        onClick={() => act(() => api.signOutEverywhere(), true)}
      >
        Sign out everywhere
      </button>
    </section>
  );
}

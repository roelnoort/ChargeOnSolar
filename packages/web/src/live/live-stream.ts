import {
  type LiveSnapshot,
  liveSnapshot,
  liveStreamPath,
  snapshotEvent,
} from "@charge-on-solar/shared";

export const streamStatuses = [
  "connecting",
  "connected",
  "reconnecting",
] as const;
export type StreamStatus = (typeof streamStatuses)[number];

export interface LiveStreamState {
  status: StreamStatus;
  /** The latest snapshot, and when it arrived (by `now`). */
  latest?: { snapshot: LiveSnapshot; receivedAt: number };
}

/** The part of the browser's EventSource the live stream uses. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void
  ): void;
  close(): void;
}

export interface LiveStreamOptions {
  createEventSource: (url: string) => EventSourceLike;
  after: (milliseconds: number, callback: () => void) => () => void;
  now: () => number;
  onChange: (state: LiveStreamState) => void;
}

const eventSourceClosed = 2;
const reopenAfterMs = 3000;

/**
 * Follows the server's live stream. The browser retries a dropped stream by
 * itself; when it gives up, this opens a new one.
 */
export function connectLiveStream({
  createEventSource,
  after,
  now,
  onChange,
}: LiveStreamOptions): { close(): void } {
  let state: LiveStreamState = { status: "connecting" };
  let source: EventSourceLike | undefined;
  let cancelReopen: (() => void) | undefined;

  function update(change: Partial<LiveStreamState>) {
    state = { ...state, ...change };
    onChange(state);
  }

  function open() {
    cancelReopen = undefined;
    const current = createEventSource(liveStreamPath);
    source = current;
    current.addEventListener("open", () => update({ status: "connected" }));
    current.addEventListener("error", () => {
      update({ status: "reconnecting" });
      if (current.readyState !== eventSourceClosed) return;
      current.close();
      cancelReopen = after(reopenAfterMs, open);
    });
    current.addEventListener(snapshotEvent, (event) => {
      if (typeof event.data !== "string") return;
      const parsed = liveSnapshot.safeParse(parseJson(event.data));
      if (parsed.success) {
        update({ latest: { snapshot: parsed.data, receivedAt: now() } });
      }
    });
  }

  onChange(state);
  open();

  return {
    close() {
      cancelReopen?.();
      source?.close();
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseReader {
  /** The next event, or undefined if none arrives within `waitMs` real time. */
  next(waitMs?: number): Promise<SseEvent | undefined>;
  close(): Promise<void>;
}

/** Reads Server-Sent Events from a streaming response, one at a time. */
export function readSse(response: Response): SseReader {
  if (!response.body) throw new Error("The response has no body to stream");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let pending: ReturnType<typeof reader.read> | undefined;

  function takeEvent(): SseEvent | undefined {
    const end = buffer.indexOf("\n\n");
    if (end < 0) return undefined;
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const event: SseEvent = { event: "message", data: "" };
    for (const line of block.split("\n")) {
      const [field, ...rest] = line.split(":");
      const value = rest.join(":").replace(/^ /, "");
      if (field === "event") event.event = value;
      if (field === "data") event.data += value;
    }
    return event;
  }

  return {
    async next(waitMs = 200) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const event = takeEvent();
        if (event) return event;
        pending ??= reader.read();
        const timedOut = Symbol("timed out");
        const result = await Promise.race([
          pending,
          new Promise<typeof timedOut>((resolve) =>
            setTimeout(() => resolve(timedOut), deadline - Date.now())
          ),
        ]);
        if (result === timedOut) return undefined;
        pending = undefined;
        if (result.done) return undefined;
        buffer += result.value;
      }
    },
    async close() {
      await reader.cancel();
    },
  };
}

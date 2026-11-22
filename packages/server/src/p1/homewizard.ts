// The HomeWizard P1 meter's local API v2: a WebSocket over TLS that pushes a
// measurement about once a second.
import type { PeerCertificate } from "node:tls";
import { type ClientOptions, WebSocket } from "ws";
import { z } from "zod";
import type { Cancel, Clock } from "../clock.ts";
import type { P1Phase, P1Reading } from "../domain/p1-reading.ts";
import type { P1Client, P1Connection } from "./client.ts";
import { homeWizardCa } from "./homewizard-ca.ts";

export interface HomeWizardOptions {
  /** The meter's address on the home network, e.g. `192.168.1.20`. */
  host: string;
  /** The token the meter gave when it was paired. */
  token: string;
  clock: Clock;
  /** The CA that signed the meter's certificate. HomeWizard's own by default. */
  ca?: string;
}

// The meter's certificate names the appliance (appliance/<type>/<serial>),
// not its address on the network.
function checkApplianceIdentity(_host: string, certificate: PeerCertificate) {
  const name = certificate.subject?.CN;
  if (typeof name === "string" && name.startsWith("appliance/")) return;
  return new Error(`The certificate names ${name}, not a HomeWizard appliance`);
}

const silenceLimitMs = 30_000;
const handshakeTimeoutMs = 10_000;

const optionalNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? null);

const measurement = z.object({
  power_w: z.number(),
  power_l1_w: optionalNumber,
  power_l2_w: optionalNumber,
  power_l3_w: optionalNumber,
  current_l1_a: optionalNumber,
  current_l2_a: optionalNumber,
  current_l3_a: optionalNumber,
  voltage_l1_v: optionalNumber,
  voltage_l2_v: optionalNumber,
  voltage_l3_v: optionalNumber,
  timestamp: z.string().nullish(),
});

const deviceMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authorization_requested") }),
  z.object({ type: z.literal("authorized") }),
  z.object({ type: z.literal("measurement"), data: measurement }),
  z.object({
    type: z.literal("error"),
    data: z.object({ message: z.string() }),
  }),
]);
const knownTypes = new Set<string>(
  deviceMessage.options.map((o) => o.shape.type.value)
);

export function toP1Reading(
  data: z.infer<typeof measurement>,
  receivedAt: Date
): P1Reading {
  const phase = (n: 1 | 2 | 3): P1Phase => ({
    powerW: data[`power_l${n}_w`],
    currentA: data[`current_l${n}_a`],
    voltageV: data[`voltage_l${n}_v`],
  });
  return {
    receivedAt,
    deviceTimestamp: data.timestamp ?? null,
    // The P1 meter reports export as negative power.
    netPowerW: data.power_w,
    phases: { l1: phase(1), l2: phase(2), l3: phase(3) },
  };
}

export function createHomeWizardP1Client({
  host,
  token,
  clock,
  ca = homeWizardCa,
}: HomeWizardOptions): P1Client {
  return {
    connect(onReading) {
      return new Promise((resolveConnect, rejectConnect) => {
        const socket = new WebSocket(`wss://${host}/api/ws`, {
          ca,
          rejectUnauthorized: true,
          // @types/ws says boolean; ws hands it to tls.connect, which wants this.
          checkServerIdentity:
            checkApplianceIdentity as unknown as ClientOptions["checkServerIdentity"],
          handshakeTimeout: handshakeTimeoutMs,
        });
        let authorized = false;
        let endReason: string | undefined;
        let resolveClosed: (reason: string) => void = () => {};
        const closed = new Promise<string>((resolve) => {
          resolveClosed = resolve;
        });
        let cancelWatchdog: Cancel = () => {};

        function end(reason: string) {
          endReason ??= reason;
          cancelWatchdog();
          socket.terminate();
        }
        function watchSilence() {
          cancelWatchdog();
          cancelWatchdog = clock.after(silenceLimitMs, () =>
            end(`No message from the P1 meter for ${silenceLimitMs / 1000} s`)
          );
        }
        const send = (message: unknown) => socket.send(JSON.stringify(message));

        socket.on("open", watchSilence);
        socket.on("message", (raw) => {
          watchSilence();
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(raw));
          } catch {
            return end("The P1 meter sent a message that is not JSON");
          }
          const type = (parsed as { type?: unknown } | null)?.type;
          if (typeof type !== "string" || !knownTypes.has(type)) return;
          const result = deviceMessage.safeParse(parsed);
          if (!result.success) {
            return end(`The P1 meter sent an unexpected ${type} message`);
          }
          const message = result.data;
          switch (message.type) {
            case "authorization_requested":
              return send({ type: "authorization", data: token });
            case "authorized":
              authorized = true;
              send({ type: "subscribe", data: "measurement" });
              return resolveConnect(connection);
            case "measurement":
              return onReading(toP1Reading(message.data, clock.now()));
            case "error":
              return end(`The P1 meter answered: ${message.data.message}`);
          }
        });
        socket.on("error", (error) => end(error.message));
        socket.on("close", (code) => {
          cancelWatchdog();
          const reason = endReason ?? `Connection closed (${code})`;
          if (authorized) resolveClosed(reason);
          else rejectConnect(new Error(reason));
        });

        const connection: P1Connection = {
          closed,
          close: () => end("Closed by the server"),
        };
      });
    },
  };
}

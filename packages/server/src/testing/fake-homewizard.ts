// A fake HomeWizard P1 meter on localhost: speaks the local API v2 WebSocket
// over TLS and replays the recorded messages in p1/fixtures.
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import recorded from "../p1/fixtures/homewizard-ws-messages.json" with {
  type: "json",
};
import type { TestCertificates } from "./test-certificates.ts";

export interface FakeHomeWizard {
  /** host:port to connect to. */
  host: string;
  /** Messages the fake received from the client, parsed. */
  received: unknown[];
  /** Cuts every client off, as a network drop would. */
  dropClients(): void;
  close(): Promise<void>;
}

export interface FakeHomeWizardOptions {
  certificates: Pick<TestCertificates, "cert" | "key">;
  token: string;
  /** Stays silent after authorizing, as a meter on a dead link would. */
  silent?: boolean;
}

const byType = (type: string) => recorded.filter((m) => m.type === type);

export async function startFakeHomeWizard({
  certificates,
  token,
  silent = false,
}: FakeHomeWizardOptions): Promise<FakeHomeWizard> {
  const https = createServer(certificates);
  const sockets = new WebSocketServer({ server: https, path: "/api/ws" });
  const received: unknown[] = [];

  sockets.on("connection", (socket) => {
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    for (const message of byType("authorization_requested")) send(message);
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      received.push(message);
      if (message.type === "authorization") {
        if (message.data === token) {
          for (const reply of byType("authorized")) send(reply);
        } else {
          send({ type: "error", data: { message: "user:unauthorized" } });
          socket.close();
        }
      }
      if (message.type === "subscribe" && message.data === "measurement") {
        if (!silent) for (const reply of byType("measurement")) send(reply);
      }
    });
  });

  await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
  const { port } = https.address() as AddressInfo;

  return {
    host: `127.0.0.1:${port}`,
    received,
    dropClients() {
      for (const client of sockets.clients) client.terminate();
    },
    async close() {
      for (const client of sockets.clients) client.terminate();
      await new Promise((resolve) => sockets.close(resolve));
      await new Promise((resolve) => https.close(resolve));
    },
  };
}

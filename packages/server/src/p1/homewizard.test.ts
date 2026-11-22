import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { P1Reading } from "../domain/p1-reading.ts";
import { createFakeClock } from "../testing/fake-clock.ts";
import {
  type FakeHomeWizard,
  startFakeHomeWizard,
} from "../testing/fake-homewizard.ts";
import {
  makeTestCertificates,
  type TestCertificates,
} from "../testing/test-certificates.ts";
import type { P1Connection } from "./client.ts";
import { createHomeWizardP1Client } from "./homewizard.ts";

const token = "0123456789ABCDEF0123456789ABCDEF";
let certificates: TestCertificates;
let otherCa: string;
let device: FakeHomeWizard | undefined;
let connection: P1Connection | undefined;

beforeAll(() => {
  certificates = makeTestCertificates();
  otherCa = makeTestCertificates().ca;
});
afterEach(async () => {
  connection?.close();
  await device?.close();
  connection = undefined;
  device = undefined;
});

async function startDevice(options: { silent?: boolean } = {}) {
  device = await startFakeHomeWizard({ certificates, token, ...options });
  return device;
}

function clientFor(
  host: string,
  overrides: { token?: string; ca?: string } = {}
) {
  const clock = createFakeClock(new Date("2026-06-01T12:00:00.000Z"));
  const client = createHomeWizardP1Client({
    host,
    token: overrides.token ?? token,
    ca: overrides.ca ?? certificates.ca,
    clock,
  });
  return { client, clock };
}

describe("the HomeWizard P1 client", () => {
  it("authorizes with the token and subscribes to measurements", async () => {
    const { host, received } = await startDevice();
    const { client } = clientFor(host);

    connection = await client.connect(() => {});

    await vi.waitFor(() =>
      expect(received).toEqual([
        { type: "authorization", data: token },
        { type: "subscribe", data: "measurement" },
      ])
    );
  });

  it("turns recorded measurements into Readings, received at the clock's time", async () => {
    const { host } = await startDevice();
    const { client } = clientFor(host);
    const readings: P1Reading[] = [];

    connection = await client.connect((reading) => readings.push(reading));

    await vi.waitFor(() => expect(readings).toHaveLength(2));
    expect(readings).toEqual([
      {
        receivedAt: new Date("2026-06-01T12:00:00.000Z"),
        deviceTimestamp: "2026-06-01T14:00:00",
        netPowerW: -1543,
        phases: {
          l1: { powerW: -1600, currentA: 6.9, voltageV: 231.4 },
          l2: { powerW: 23, currentA: 0.2, voltageV: 229.9 },
          l3: { powerW: 34, currentA: 0.3, voltageV: 230.6 },
        },
      },
      {
        receivedAt: new Date("2026-06-01T12:00:00.000Z"),
        deviceTimestamp: "2026-06-01T14:00:01",
        netPowerW: 312,
        phases: {
          l1: { powerW: 312, currentA: 1.4, voltageV: 230.2 },
          l2: { powerW: null, currentA: null, voltageV: null },
          l3: { powerW: null, currentA: null, voltageV: null },
        },
      },
    ]);
  });

  it("refuses a device whose certificate the CA did not sign", async () => {
    const { host } = await startDevice();
    const { client } = clientFor(host, { ca: otherCa });

    await expect(client.connect(() => {})).rejects.toThrow(/certificate/i);
  });

  it("refuses a certificate from the CA that does not name an appliance", async () => {
    const notAnAppliance = makeTestCertificates({ deviceName: "127.0.0.1" });
    device = await startFakeHomeWizard({
      certificates: notAnAppliance,
      token,
    });
    const { client } = clientFor(device.host, { ca: notAnAppliance.ca });

    await expect(client.connect(() => {})).rejects.toThrow(/appliance/i);
  });

  it("trusts only HomeWizard's own CA unless told otherwise", async () => {
    const { host } = await startDevice();
    const client = createHomeWizardP1Client({
      host,
      token,
      clock: createFakeClock(new Date("2026-06-01T12:00:00.000Z")),
    });

    await expect(client.connect(() => {})).rejects.toThrow(/certificate/i);
  });

  it("fails to connect when the device rejects the token", async () => {
    const { host } = await startDevice();
    const { client } = clientFor(host, { token: "not-the-token" });

    await expect(client.connect(() => {})).rejects.toThrow("user:unauthorized");
  });

  it("reports the stream closed when the device drops it", async () => {
    const fake = await startDevice();
    const { client } = clientFor(fake.host);
    connection = await client.connect(() => {});

    fake.dropClients();

    await expect(connection.closed).resolves.toMatch(/closed/i);
  });

  it("gives up on a device that has gone silent", async () => {
    const { host } = await startDevice({ silent: true });
    const { client, clock } = clientFor(host);
    connection = await client.connect(() => {});

    clock.advance(30_000);

    await expect(connection.closed).resolves.toMatch(/no message .* 30 s/i);
  });
});

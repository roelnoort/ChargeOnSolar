import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiError,
  csrfHeader,
  livePath,
  liveSnapshot,
  liveStreamPath,
  type ManualOverride,
  manualOverride,
  type OverrideCommand,
  overrideEvent,
  overridesPath,
} from "@charge-on-solar/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmationWaitMs } from "../overrides.ts";
import type { FakeChargerState } from "../testing/fake-zaptec-client.ts";
import {
  startTestServer,
  type TestServer,
  type TestServerOptions,
} from "../testing/harness.ts";
import { readSse, type SseReader } from "../testing/sse.ts";

let server: TestServer | undefined;
let stream: SseReader | undefined;
afterEach(async () => {
  await stream?.close();
  await server?.close();
  stream = undefined;
  server = undefined;
});

const charging: FakeChargerState = { operationMode: 3, chargerPowerW: 3000 };
const pausedByUs: FakeChargerState = {
  operationMode: 5,
  finalStopActive: true,
};
const unplugged: FakeChargerState = { operationMode: 1 };

async function start(options: TestServerOptions = {}) {
  server = await startTestServer({ charger: charging, ...options });
  return server;
}

async function live() {
  const response = await server?.requestSignedIn(livePath);
  return liveSnapshot.parse(await response?.json());
}

function send(command: OverrideCommand) {
  return server?.requestSignedIn(overridesPath, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [csrfHeader.name]: csrfHeader.value,
    },
    body: JSON.stringify({ command }),
  }) as Promise<Response>;
}

async function sendOk(command: OverrideCommand) {
  const response = await send(command);
  expect(response.status).toBe(200);
  return manualOverride.parse(await response.json());
}

describe("which Manual override the charger allows", () => {
  it.each([
    [charging, "pause", null],
    [{ operationMode: 1 }, "pause", "no-car"],
    [{ operationMode: 2 }, "pause", "not-charging"],
    [{ operationMode: 5, finalStopActive: false }, "resume", "paused-by-car"],
    [
      {
        operationMode: 5,
        finalStopActive: true,
        nextScheduleEvent: "2026-06-02T05:00:00",
      },
      "resume",
      "paused-by-schedule",
    ],
    [pausedByUs, "resume", null],
    [{ operationMode: 0 }, "pause", "charger-offline"],
  ] as const)(
    "for %o offers %s, unavailable because %s",
    async (charger, command, unavailableReason) => {
      await start({ charger });

      expect((await live()).override).toEqual({ command, unavailableReason });
    }
  );

  it("is unavailable as Charger offline before Zaptec has been read", async () => {
    await start({ charger: undefined, zaptecUnreachable: true });

    expect((await live()).override).toEqual({
      command: "pause",
      unavailableReason: "charger-offline",
    });
  });

  it("is unavailable as Charger offline once Zaptec has gone quiet for 90 s", async () => {
    const { zaptec, pollZaptec } = await start();
    zaptec.unreachable = true;
    await pollZaptec(91_000);

    expect((await live()).override.unavailableReason).toBe("charger-offline");
  });

  it("refuses a Pause the charger state does not allow, and sends nothing", async () => {
    const { zaptec } = await start({ charger: { operationMode: 2 } });

    const response = await send("pause");

    expect(response.status).toBe(409);
    expect(apiError.parse(await response.json()).error.message).toBe(
      "Not charging"
    );
    expect(zaptec.commandsSent).toEqual([]);
  });

  it("refuses a Resume while charging", async () => {
    const { zaptec } = await start();

    const response = await send("resume");

    expect(response.status).toBe(409);
    expect(apiError.parse(await response.json()).error.message).toBe(
      "Resume is not available"
    );
    expect(zaptec.commandsSent).toEqual([]);
  });

  it("resumes an External pause made in the Zaptec app", async () => {
    const { zaptec } = await start({ charger: pausedByUs });

    const sent = await sendOk("resume");

    expect(sent.status).toBe("accepted");
    expect(zaptec.commandsSent).toEqual(["resume"]);
  });

  it("refuses a request without a session", async () => {
    const { zaptec, request } = await start();

    const response = await request(overridesPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [csrfHeader.name]: csrfHeader.value,
      },
      body: JSON.stringify({ command: "pause" }),
    });

    expect(response.status).toBe(401);
    expect(zaptec.commandsSent).toEqual([]);
  });

  it("refuses a request without the CSRF header", async () => {
    const { zaptec, requestSignedIn } = await start();

    const response = await requestSignedIn(overridesPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "pause" }),
    });

    expect(response.status).toBe(403);
    expect(zaptec.commandsSent).toEqual([]);
  });

  it("refuses a command it does not know", async () => {
    const { zaptec, requestSignedIn } = await start();

    const response = await requestSignedIn(overridesPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [csrfHeader.name]: csrfHeader.value,
      },
      body: JSON.stringify({ command: "stop" }),
    });

    expect(response.status).toBe(400);
    expect(zaptec.commandsSent).toEqual([]);
  });
});

async function latestOverride() {
  const [latest] = (await server?.storage.listManualOverrides(1)) ?? [];
  return latest;
}

async function pauses() {
  return (await server?.storage.listPauses(10)) ?? [];
}

describe("a Manual override's lifecycle", () => {
  it("is accepted when Zaptec takes the command, and confirmed when the charger pauses", async () => {
    const { zaptec, pollZaptec } = await start();

    const sent = await sendOk("pause");

    expect(sent).toMatchObject({
      command: "pause",
      status: "accepted",
      sentAt: "2026-06-01T12:00:00.000Z",
      user: { name: "Test User" },
      rejection: null,
    });
    expect(zaptec.commandsSent).toEqual(["pause"]);
    expect((await latestOverride())?.confirmation).toBeNull();

    zaptec.set(pausedByUs);
    await pollZaptec();

    expect(await latestOverride()).toMatchObject({
      id: sent.id,
      command: "pause",
      commandResult: { accepted: true },
      confirmation: "confirmed",
    });
  });

  it("records the User who sent it, and when", async () => {
    const { storage, clock } = await start();
    clock.advance(5_000);

    await sendOk("pause");

    const user = await storage.findUserByEmail("test-user@example.com");
    expect(await latestOverride()).toMatchObject({
      sentAt: new Date("2026-06-01T12:00:05.000Z"),
      userId: user?.id,
      userName: "Test User",
      command: "pause",
      answersPauseId: null,
    });
  });

  it("is rejected with Zaptec's code and reason, and the button is free again", async () => {
    const { zaptec } = await start({ charger: pausedByUs });
    zaptec.commandResult = {
      accepted: false,
      code: 528,
      reason: "Charger can't resume in its current state",
    };

    const sent = await sendOk("resume");

    expect(sent.status).toBe("rejected");
    expect(sent.rejection).toEqual({
      code: 528,
      reason: "Charger can't resume in its current state",
    });
    expect((await latestOverride())?.commandResult).toEqual({
      accepted: false,
      code: 528,
      reason: "Charger can't resume in its current state",
    });
    expect((await live()).override).toEqual({
      command: "resume",
      unavailableReason: null,
    });
  });

  it("is unconfirmed when the charger has not changed within 60 s", async () => {
    const { pollZaptec, clock } = await start();
    await sendOk("pause");
    await pollZaptec();
    expect((await latestOverride())?.confirmation).toBeNull();

    clock.advance(confirmationWaitMs - 30_000);
    await pollZaptec(0);

    expect((await latestOverride())?.confirmation).toBe("unconfirmed");
    expect((await live()).override.unavailableReason).toBeNull();
  });

  it("is not confirmed by a change the charger shows after the wait ran out", async () => {
    const { zaptec, pollZaptec, clock } = await start();
    await sendOk("pause");
    clock.advance(confirmationWaitMs);
    await pollZaptec(0);
    zaptec.set(pausedByUs);
    await pollZaptec();

    expect((await latestOverride())?.confirmation).toBe("unconfirmed");
    expect((await pauses())[0]?.source).toBe("external");
  });

  it("keeps the button greyed out while it waits for the charger", async () => {
    const { zaptec } = await start();
    await sendOk("pause");

    expect((await live()).override).toEqual({
      command: "pause",
      unavailableReason: "override-in-progress",
    });
    const second = await send("pause");
    expect(second.status).toBe(409);
    expect(apiError.parse(await second.json()).error.message).toBe(
      "Waiting for the charger"
    );
    expect(zaptec.commandsSent).toEqual(["pause"]);
  });

  it("confirms a Resume when the charger charges again, and ends the pause it answers", async () => {
    const { zaptec, pollZaptec } = await start({ charger: pausedByUs });
    const [pause] = await pauses();
    expect(pause).toMatchObject({ source: "external", endedAt: null });

    const sent = await sendOk("resume");
    expect((await latestOverride())?.answersPauseId).toBe(pause?.id);

    zaptec.set(charging);
    await pollZaptec();

    expect(await latestOverride()).toMatchObject({
      id: sent.id,
      confirmation: "confirmed",
    });
    expect(await pauses()).toEqual([
      expect.objectContaining({
        id: pause?.id,
        endedAt: new Date("2026-06-01T12:00:30.000Z"),
        ending: "resumed-by-chargeonsolar",
      }),
    ]);
  });

  it("tells every open screen about each step in an override event", async () => {
    const { zaptec, pollZaptec } = await start();
    const response = await server?.requestSignedIn(liveStreamPath);
    stream = readSse(response as Response);

    await sendOk("pause");
    zaptec.set(pausedByUs);
    await pollZaptec();

    const events: ManualOverride[] = [];
    for (let event = await stream.next(); event; event = await stream.next()) {
      if (event.event === overrideEvent) {
        events.push(manualOverride.parse(JSON.parse(event.data)));
      }
    }
    expect(events.map((event) => event.status)).toEqual([
      "sending",
      "accepted",
      "confirmed",
    ]);
    expect(events.every((event) => event.user.name === "Test User")).toBe(true);
  });

  it("tells every open screen when a command was rejected or unconfirmed", async () => {
    const { zaptec, clock, pollZaptec } = await start();
    const response = await server?.requestSignedIn(liveStreamPath);
    stream = readSse(response as Response);

    zaptec.commandResult = { accepted: false, code: 528, reason: "No" };
    await sendOk("pause");
    zaptec.commandResult = { accepted: true };
    clock.advance(1_000);
    await sendOk("pause");
    clock.advance(confirmationWaitMs);
    await pollZaptec(0);

    const statuses: string[] = [];
    for (let event = await stream.next(); event; event = await stream.next()) {
      if (event.event === overrideEvent) {
        statuses.push(manualOverride.parse(JSON.parse(event.data)).status);
      }
    }
    expect(statuses).toEqual([
      "sending",
      "rejected",
      "sending",
      "accepted",
      "unconfirmed",
    ]);
  });
});

describe("pauses", () => {
  it("records a confirmed Pause as one ChargeOnSolar sent itself", async () => {
    const { zaptec, pollZaptec } = await start();
    const sent = await sendOk("pause");
    zaptec.set(pausedByUs);
    await pollZaptec();

    expect(await pauses()).toEqual([
      {
        id: expect.any(Number),
        source: "chargeonsolar",
        overrideId: sent.id,
        startedAt: new Date("2026-06-01T12:00:30.000Z"),
        endedAt: null,
        ending: null,
      },
    ]);
  });

  it("records a pause made outside ChargeOnSolar as an External pause", async () => {
    const { zaptec, pollZaptec } = await start();
    zaptec.set(pausedByUs);
    await pollZaptec();

    expect(await pauses()).toEqual([
      expect.objectContaining({ source: "external", overrideId: null }),
    ]);
  });

  it("does not count a schedule or the car stopping as a pause", async () => {
    const { zaptec, pollZaptec } = await start();
    zaptec.set({
      operationMode: 5,
      finalStopActive: true,
      nextScheduleEvent: "2026-06-02T05:00:00",
    });
    await pollZaptec();
    zaptec.set({ operationMode: 5, finalStopActive: false });
    await pollZaptec();

    expect(await pauses()).toEqual([]);
  });

  it("closes when the car is unplugged", async () => {
    const { zaptec, pollZaptec } = await start({ charger: pausedByUs });
    zaptec.set(unplugged);
    await pollZaptec();

    expect(await pauses()).toEqual([
      expect.objectContaining({
        endedAt: new Date("2026-06-01T12:00:30.000Z"),
        ending: "unplugged",
      }),
    ]);
  });

  it("closes when charging restarts without ChargeOnSolar", async () => {
    const { zaptec, pollZaptec } = await start({ charger: pausedByUs });
    zaptec.set(charging);
    await pollZaptec();

    expect(await pauses()).toEqual([
      expect.objectContaining({ ending: "charging-restarted" }),
    ]);
  });

  it("stays open, once, while the charger stays paused", async () => {
    const { pollZaptec } = await start({ charger: pausedByUs });
    await pollZaptec();
    await pollZaptec();

    expect(await pauses()).toEqual([
      expect.objectContaining({ endedAt: null }),
    ]);
  });
});

describe("pauses the charger shows while a command is on its way", () => {
  it("are the ChargeOnSolar pause the Pause made, not an External pause", async () => {
    const { zaptec, pollZaptec } = await start();
    const release = zaptec.holdCommands();
    const sending = send("pause");
    await vi.waitFor(() => expect(zaptec.commandsSent).toHaveLength(1));

    zaptec.set(pausedByUs);
    await pollZaptec();
    release();
    const sent = manualOverride.parse(await (await sending).json());
    await pollZaptec();

    expect(await pauses()).toEqual([
      expect.objectContaining({
        source: "chargeonsolar",
        overrideId: sent.id,
        endedAt: null,
      }),
    ]);
  });

  it("end as resumed by ChargeOnSolar when charging restarts before Zaptec answers the Resume", async () => {
    const { zaptec, pollZaptec } = await start({ charger: pausedByUs });
    const release = zaptec.holdCommands();
    const sending = send("resume");
    await vi.waitFor(() => expect(zaptec.commandsSent).toHaveLength(1));

    zaptec.set(charging);
    await pollZaptec();
    release();
    await sending;
    await pollZaptec();

    expect(await pauses()).toEqual([
      expect.objectContaining({ ending: "resumed-by-chargeonsolar" }),
    ]);
    expect((await latestOverride())?.confirmation).toBe("confirmed");
  });
});

describe("open pauses after a restart", () => {
  let dataDir: string | undefined;
  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  });

  async function restartWith(charger: FakeChargerState) {
    dataDir = await mkdtemp(join(tmpdir(), "overrides-"));
    const before = await startTestServer({ dataDir, charger: pausedByUs });
    await before.close();
    server = await startTestServer({
      dataDir,
      charger,
      now: new Date("2026-06-01T13:00:00.000Z"),
    });
    return server;
  }

  it("are closed when the car has gone", async () => {
    await restartWith(unplugged);

    expect(await pauses()).toEqual([
      expect.objectContaining({
        startedAt: new Date("2026-06-01T12:00:00.000Z"),
        endedAt: new Date("2026-06-01T13:00:00.000Z"),
        ending: "unplugged",
      }),
    ]);
  });

  it("are closed when charging has resumed", async () => {
    await restartWith(charging);

    expect(await pauses()).toEqual([
      expect.objectContaining({ ending: "charging-restarted" }),
    ]);
  });

  it("stay open, and are the pause a Resume answers, when the charger is still paused", async () => {
    await restartWith(pausedByUs);
    const [pause] = await pauses();

    await sendOk("resume");

    expect(await pauses()).toHaveLength(1);
    expect((await latestOverride())?.answersPauseId).toBe(pause?.id);
  });
});

describe("the Switch budget in GET /api/live", () => {
  it("is missing while no car is connected", async () => {
    await start({ charger: unplugged });

    expect((await live()).switchBudget).toBeNull();
  });

  it("counts every interruption seen in the charger state, whoever caused it", async () => {
    const { zaptec, pollZaptec } = await start({
      charger: unplugged,
    });
    const step = async (state: FakeChargerState) => {
      zaptec.set(state);
      await pollZaptec();
      return (await live()).switchBudget?.switchesLeft;
    };

    expect(await step({ ...charging, phaseSetting: 1 })).toBe(20);
    expect(await step({ ...pausedByUs, phaseSetting: 1 })).toBe(19);
    expect(await step({ ...charging, phaseSetting: 1 })).toBe(19);
    expect(await step({ operationMode: 2, phaseSetting: 1 })).toBe(18);
    expect(await step({ ...charging, phaseSetting: 1 })).toBe(18);
    expect(await step({ ...charging, phaseSetting: 3 })).toBe(17);
    expect(await live()).toMatchObject({
      switchBudget: { switchesLeft: 17, switchesPerSession: 20 },
    });
  });

  it("starts again at 20 with the next charge session", async () => {
    const { zaptec, pollZaptec } = await start();
    zaptec.set(pausedByUs);
    await pollZaptec();
    expect((await live()).switchBudget?.switchesLeft).toBe(19);

    zaptec.set(unplugged);
    await pollZaptec();
    expect((await live()).switchBudget).toBeNull();
    zaptec.set(charging);
    await pollZaptec();

    expect((await live()).switchBudget?.switchesLeft).toBe(20);
  });
});

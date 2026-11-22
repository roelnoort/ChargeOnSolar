import { describe, expect, it } from "vitest";
import { createFakeClock } from "./fake-clock.ts";

const start = new Date("2026-06-01T12:00:00.000Z");

describe("the fake clock", () => {
  it("calls a scheduled callback once its time has come, not before", () => {
    const clock = createFakeClock(start);
    const calls: string[] = [];
    clock.after(1000, () => calls.push(clock.now().toISOString()));

    clock.advance(999);
    expect(calls).toEqual([]);
    clock.advance(1);
    expect(calls).toEqual(["2026-06-01T12:00:01.000Z"]);
    clock.advance(5000);
    expect(calls).toHaveLength(1);
  });

  it("calls callbacks in time order, including ones scheduled while advancing", () => {
    const clock = createFakeClock(start);
    const calls: number[] = [];
    clock.after(2000, () => calls.push(2000));
    clock.after(500, () => {
      calls.push(500);
      clock.after(500, () => calls.push(1000));
    });

    clock.advance(3000);

    expect(calls).toEqual([500, 1000, 2000]);
    expect(clock.now()).toEqual(new Date("2026-06-01T12:00:03.000Z"));
  });

  it("does not call a cancelled callback", () => {
    const clock = createFakeClock(start);
    const calls: number[] = [];
    const cancel = clock.after(1000, () => calls.push(1));

    cancel();
    clock.advance(2000);

    expect(calls).toEqual([]);
  });
});

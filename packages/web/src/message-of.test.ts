import { describe, expect, it } from "vitest";
import { messageOf } from "./message-of.ts";

describe("an error's message for the screen", () => {
  it("is an Error's message, without the 'Error:' prefix", () => {
    expect(messageOf(new Error("No such signed-in device"))).toBe(
      "No such signed-in device"
    );
  });

  it("is anything else as text", () => {
    expect(messageOf("offline")).toBe("offline");
  });
});

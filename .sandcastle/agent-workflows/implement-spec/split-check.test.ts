import { describe, expect, it } from "vitest";
import { checkSplit } from "./split-check.ts";

const ticket = (title: string, blocked_by: number[] = []) => ({
  title,
  body: `## What to build\n\n${title}.`,
  blocked_by,
});

describe("checkSplit", () => {
  it("finds no problems in tickets that depend only on earlier tickets", () => {
    const plan = {
      tickets: [
        ticket("Walking skeleton"),
        ticket("Live Net power", [1]),
        ticket("Charge on surplus", [1, 2]),
      ],
    };

    expect(checkSplit(plan)).toEqual([]);
  });

  it("refuses a ticket blocked by itself or by a later ticket", () => {
    const plan = {
      tickets: [ticket("First", [2]), ticket("Second", [2]), ticket("Third")],
    };

    expect(checkSplit(plan)).toEqual([
      "Ticket 1 is blocked by ticket 2, which does not come before it. A ticket can only be blocked by earlier tickets.",
      "Ticket 2 is blocked by ticket 2, which does not come before it. A ticket can only be blocked by earlier tickets.",
    ]);
  });

  it("refuses a ticket blocked by a ticket that does not exist", () => {
    const plan = { tickets: [ticket("First"), ticket("Second", [0, 9])] };

    expect(checkSplit(plan)).toEqual([
      "Ticket 2 is blocked by ticket 0, which does not come before it. A ticket can only be blocked by earlier tickets.",
      "Ticket 2 is blocked by ticket 9, which does not come before it. A ticket can only be blocked by earlier tickets.",
    ]);
  });

  it("refuses a ticket with an empty title or body, whitespace included", () => {
    const plan = {
      tickets: [
        { ...ticket("First"), title: " " },
        { ...ticket("Second"), body: "\n\t" },
      ],
    };

    expect(checkSplit(plan)).toEqual([
      "Ticket 1 has an empty title.",
      "Ticket 2 has an empty body.",
    ]);
  });

  it("refuses a plan with no tickets", () => {
    expect(checkSplit({ tickets: [] })).toEqual([
      "The plan has no tickets. There is nothing to create.",
    ]);
  });

  it("refuses a plan that is not an object with a tickets list", () => {
    const expected = ['The plan is not an object with a "tickets" list.'];

    expect(checkSplit(null)).toEqual(expected);
    expect(checkSplit([ticket("First")])).toEqual(expected);
    expect(checkSplit({ tickets: "First" })).toEqual(expected);
  });

  it("refuses a ticket of the wrong shape", () => {
    const plan = {
      tickets: [ticket("First"), { title: "Second", blocked_by: "1" }],
    };

    expect(checkSplit(plan)).toEqual([
      'Ticket 2 is not shaped like { title, body, blocked_by }: {"title":"Second","blocked_by":"1"}',
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { checkPlan } from "./plan-check.ts";

const survivor = (number: number, tag = "easy-call") => ({
  number,
  tag,
  comment: `Findings for #${number}.`,
});

const duplicate = (number: number, duplicate_of: number) => ({
  ...survivor(number),
  duplicate_of,
});

describe("checkPlan", () => {
  it("finds no problems in a plan with one good entry per batch issue", () => {
    const plan = {
      issues: [
        survivor(12),
        survivor(14, "needs-a-human"),
        duplicate(15, 12),
        survivor(17, "blocked"),
      ],
    };

    expect(checkPlan([12, 14, 15, 17], plan)).toEqual([]);
  });

  it("refuses a plan that leaves out an issue in the batch", () => {
    const plan = { issues: [survivor(12)] };

    expect(checkPlan([12, 14], plan)).toEqual([
      "#14 is in the batch but has no entry in the plan.",
    ]);
  });

  it("refuses a plan with an entry for an issue outside the batch", () => {
    const plan = { issues: [survivor(12), survivor(99)] };

    expect(checkPlan([12], plan)).toEqual([
      "#99 has an entry in the plan but is not in the batch.",
    ]);
  });

  it("refuses a plan that lists an issue twice", () => {
    const plan = { issues: [survivor(12), survivor(12, "blocked")] };

    expect(checkPlan([12], plan)).toEqual([
      "#12 has 2 entries in the plan. It needs exactly one.",
    ]);
  });

  it("refuses a plan with a tag the workflow does not know", () => {
    const plan = { issues: [survivor(12, "ship-it")] };

    expect(checkPlan([12], plan)).toEqual([
      '#12 has a tag this workflow does not know: "ship-it". Known tags: easy-call, needs-a-human, blocked.',
    ]);
  });

  it("refuses a plan with an empty comment, whitespace included", () => {
    const plan = {
      issues: [
        { ...survivor(12), comment: "" },
        { ...survivor(14), comment: " \n\t" },
      ],
    };

    expect(checkPlan([12, 14], plan)).toEqual([
      "#12 has an empty comment. There is nothing to post.",
      "#14 has an empty comment. There is nothing to post.",
    ]);
  });

  it("refuses a duplicate of an issue that is itself a duplicate", () => {
    const plan = {
      issues: [survivor(12), duplicate(14, 12), duplicate(15, 14)],
    };

    expect(checkPlan([12, 14, 15], plan)).toEqual([
      "#15 is a duplicate of #14, which is not a surviving issue in this batch.",
    ]);
  });

  it("refuses a duplicate of an issue outside the batch", () => {
    const plan = { issues: [survivor(12), duplicate(14, 3)] };

    expect(checkPlan([12, 14], plan)).toEqual([
      "#14 is a duplicate of #3, which is not a surviving issue in this batch.",
    ]);
  });

  it("refuses a plan that is not an object with an issues list", () => {
    const expected = ['The plan is not an object with an "issues" list.'];

    expect(checkPlan([12], null)).toEqual(expected);
    expect(checkPlan([12], [survivor(12)])).toEqual(expected);
    expect(checkPlan([12], { issues: "12" })).toEqual(expected);
  });

  it("refuses a plan with an entry of the wrong shape", () => {
    const plan = {
      issues: [survivor(12), { number: "14", tag: "easy-call" }],
    };

    expect(checkPlan([12, 14], plan)).toEqual([
      'Entry 2 in the plan is not shaped like { number, tag, comment, duplicate_of? }: {"number":"14","tag":"easy-call"}',
    ]);
  });
});

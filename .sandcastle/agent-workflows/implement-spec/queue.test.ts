import { describe, expect, it } from "vitest";
import { decideQueue } from "./queue.ts";

const spec = ({
  state = "open",
  labels = ["agent:implement-spec"],
  split_before = false,
} = {}) => ({ number: 23, state, labels, split_before });

// A sub-issue as GitHub's sub-issues endpoint returns it, cut down to what
// the decider reads.
const ticket = (
  number: number,
  {
    state = "open",
    labels = ["ready-for-agent"],
    blocked_by = 0,
    total_blocked_by = blocked_by,
  }: {
    state?: string;
    labels?: string[];
    blocked_by?: number;
    total_blocked_by?: number;
  } = {}
) => ({
  number,
  state,
  labels,
  issue_dependencies_summary: { blocked_by, total_blocked_by },
});

describe("decideQueue", () => {
  it("finds no spec when nothing is labelled", () => {
    expect(decideQueue({ spec: null, sub_issues: [] })).toEqual({
      kind: "no-spec",
    });
  });

  it("finds no spec when the issue named is not labelled agent:implement-spec", () => {
    const named = spec({ labels: ["ready-for-agent"] });

    expect(decideQueue({ spec: named, sub_issues: [ticket(24)] })).toEqual({
      kind: "no-spec",
    });
  });

  it("finds no spec when the spec is closed", () => {
    const closed = spec({ state: "closed" });

    expect(decideQueue({ spec: closed, sub_issues: [ticket(24)] })).toEqual({
      kind: "no-spec",
    });
  });

  it("splits a spec that has no sub-issues", () => {
    expect(decideQueue({ spec: spec(), sub_issues: [] })).toEqual({
      kind: "split",
      spec: 23,
    });
  });

  it("builds the first open ticket in sub-issue order, not the lowest number", () => {
    const sub_issues = [
      ticket(31, { state: "closed" }),
      ticket(34),
      ticket(24),
    ];

    expect(decideQueue({ spec: spec(), sub_issues })).toEqual({
      kind: "build",
      spec: 23,
      ticket: 34,
    });
  });

  it("skips a ticket with an open blocked-by dependency", () => {
    const sub_issues = [ticket(24, { blocked_by: 1 }), ticket(34)];

    expect(decideQueue({ spec: spec(), sub_issues })).toMatchObject({
      kind: "build",
      ticket: 34,
    });
  });

  it("skips a ticket marked agent:blocked", () => {
    const sub_issues = [
      ticket(34, { labels: ["ready-for-agent", "agent:blocked"] }),
      ticket(24),
    ];

    expect(decideQueue({ spec: spec(), sub_issues })).toMatchObject({
      kind: "build",
      ticket: 24,
    });
  });

  it("stops when every open ticket is blocked, and says why for each", () => {
    const sub_issues = [
      ticket(34, { labels: ["agent:blocked"] }),
      ticket(24, { blocked_by: 1 }),
      ticket(33, { blocked_by: 3 }),
      ticket(31, { state: "closed" }),
    ];

    expect(decideQueue({ spec: spec(), sub_issues })).toEqual({
      kind: "all-blocked",
      spec: 23,
      reasons: [
        "#34 is marked `agent:blocked` by a failed run",
        "#24 is blocked by 1 open issue",
        "#33 is blocked by 3 open issues",
      ],
    });
  });

  it("is drained when every sub-issue is closed", () => {
    const sub_issues = [
      ticket(34, { state: "closed" }),
      ticket(24, { state: "closed", labels: ["agent:blocked"] }),
    ];

    expect(decideQueue({ spec: spec(), sub_issues })).toEqual({
      kind: "drained",
      spec: 23,
    });
  });

  it("no longer counts a blocker once it is closed", () => {
    const sub_issues = [ticket(24, { blocked_by: 0, total_blocked_by: 2 })];

    expect(decideQueue({ spec: spec(), sub_issues })).toMatchObject({
      kind: "build",
      ticket: 24,
    });
  });

  it("skips a ticket another run is building", () => {
    const sub_issues = [
      ticket(34, { labels: ["agent:in-progress"] }),
      ticket(24),
    ];

    expect(decideQueue({ spec: spec(), sub_issues })).toMatchObject({
      kind: "build",
      ticket: 24,
    });
  });

  it("never splits a spec twice, even when the first split left no sub-issues", () => {
    const once = spec({ split_before: true });

    expect(decideQueue({ spec: once, sub_issues: [] })).toEqual({
      kind: "all-blocked",
      spec: 23,
      reasons: [
        "#23 was split once already and has no sub-issues. Add them by hand, or check the split run's logs.",
      ],
    });
  });
});

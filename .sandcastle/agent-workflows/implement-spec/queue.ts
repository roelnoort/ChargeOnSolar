// What an implement-spec run does next. The survey job in
// agent-implement-spec.yml fetches the spec and its sub-issues as JSON with
// `gh`, runs this on them, and every later job branches on the answer. It
// runs there on plain Node, with no checkout and no `pnpm install`, so this
// file imports nothing.

const triggerLabel = "agent:implement-spec";
const blockedLabel = "agent:blocked";
const inProgressLabel = "agent:in-progress";

type Spec = {
  readonly number: number;
  readonly state: string;
  readonly labels: readonly string[];
  // A split run has started on this spec before: the announce job marks it
  // before the agent runs. Splitting happens at most once per spec, whatever
  // came of it.
  readonly split_before: boolean;
};

// A sub-issue as GitHub's sub-issues endpoint returns it, cut down to what is
// read here. The endpoint lists them in sub-issue order.
type SubIssue = {
  readonly number: number;
  readonly state: string;
  readonly labels: readonly string[];
  readonly issue_dependencies_summary: {
    // Open "blocked by" issues only. Closed ones no longer block.
    readonly blocked_by: number;
    readonly total_blocked_by: number;
  };
};

export type QueueSnapshot = {
  // The spec this run was pointed at, or null when there was none to find.
  readonly spec: Spec | null;
  readonly sub_issues: readonly SubIssue[];
};

export type QueueDecision =
  | { readonly kind: "no-spec" }
  | { readonly kind: "split"; readonly spec: number }
  | { readonly kind: "build"; readonly spec: number; readonly ticket: number }
  | { readonly kind: "drained"; readonly spec: number }
  | {
      readonly kind: "all-blocked";
      readonly spec: number;
      // One sentence per ticket that could not be built, to post on the spec.
      readonly reasons: readonly string[];
    };

export const decideQueue = ({
  spec,
  sub_issues,
}: QueueSnapshot): QueueDecision => {
  // Taking the label off the spec is how you stop the queue.
  if (spec === null || spec.state !== "open") return { kind: "no-spec" };
  if (!spec.labels.includes(triggerLabel)) return { kind: "no-spec" };

  if (sub_issues.length === 0) {
    if (!spec.split_before) return { kind: "split", spec: spec.number };
    return {
      kind: "all-blocked",
      spec: spec.number,
      reasons: [
        `#${spec.number} was split once already and has no sub-issues. Add them by hand, or check the split run's logs.`,
      ],
    };
  }

  const open = sub_issues.filter((issue) => issue.state === "open");
  if (open.length === 0) return { kind: "drained", spec: spec.number };

  // The first buildable ticket in sub-issue order, not the lowest number.
  const next = open.find((issue) => whyNotBuildable(issue) === null);
  if (next) return { kind: "build", spec: spec.number, ticket: next.number };

  return {
    kind: "all-blocked",
    spec: spec.number,
    reasons: open.map(
      (issue) => `#${issue.number} is ${whyNotBuildable(issue)}`
    ),
  };
};

const whyNotBuildable = ({
  labels,
  issue_dependencies_summary: { blocked_by },
}: SubIssue): string | null => {
  if (labels.includes(blockedLabel)) {
    return "marked `agent:blocked` by a failed run";
  }
  // Building it again would open a second pull request for it.
  if (labels.includes(inProgressLabel)) {
    return "being built by another run (`agent:in-progress`)";
  }
  if (blocked_by > 0) {
    return `blocked by ${blocked_by} open ${blocked_by === 1 ? "issue" : "issues"}`;
  }
  return null;
};

// The gate between the explore agent and GitHub. The apply job in
// agent-explore.yml runs this on the plan before it writes anything, and any
// problem refuses the whole plan. It runs there on plain Node, with no
// checkout and no `pnpm install`, so this file imports nothing.

// The calls an explore run can make. The apply job branches on them.
export const exploreTags = ["easy-call", "needs-a-human", "blocked"] as const;

type PlanEntry = {
  readonly number: number;
  readonly tag: string;
  readonly comment: string;
  readonly duplicate_of?: number | null;
};

// Every problem with the plan, as a sentence. Empty means apply it. The plan
// is whatever the agent handed back, so its shape is checked here too.
export const checkPlan = (
  batch: readonly number[],
  plan: unknown
): string[] => {
  if (!isObject(plan) || !Array.isArray(plan.issues)) {
    return ['The plan is not an object with an "issues" list.'];
  }
  const shapeProblems = plan.issues.flatMap((entry: unknown, index) =>
    isPlanEntry(entry)
      ? []
      : [
          `Entry ${index + 1} in the plan is not shaped like { number, tag, comment, duplicate_of? }: ${JSON.stringify(entry)}`,
        ]
  );
  if (shapeProblems.length > 0) return shapeProblems;

  const entries: readonly PlanEntry[] = plan.issues;
  return [
    ...coverageProblems(batch, entries),
    ...entries.flatMap((entry) => entryProblems(batch, entries, entry)),
  ];
};

// Every issue in the batch, exactly once, and nothing else.
const coverageProblems = (
  batch: readonly number[],
  entries: readonly PlanEntry[]
): string[] => {
  const counts = new Map<number, number>();
  for (const { number } of entries) {
    counts.set(number, (counts.get(number) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const number of batch) {
    if (!counts.has(number)) {
      problems.push(`#${number} is in the batch but has no entry in the plan.`);
    }
  }
  for (const [number, count] of counts) {
    if (!batch.includes(number)) {
      problems.push(
        `#${number} has an entry in the plan but is not in the batch.`
      );
    } else if (count > 1) {
      problems.push(
        `#${number} has ${count} entries in the plan. It needs exactly one.`
      );
    }
  }
  return problems;
};

const entryProblems = (
  batch: readonly number[],
  entries: readonly PlanEntry[],
  { number, tag, comment, duplicate_of }: PlanEntry
): string[] => {
  const problems: string[] = [];
  if (!isExploreTag(tag)) {
    problems.push(
      `#${number} has a tag this workflow does not know: ${JSON.stringify(tag)}. Known tags: ${exploreTags.join(", ")}.`
    );
  }
  if (comment.trim() === "") {
    problems.push(`#${number} has an empty comment. There is nothing to post.`);
  }
  if (duplicate_of != null && !isSurvivor(batch, entries, duplicate_of)) {
    problems.push(
      `#${number} is a duplicate of #${duplicate_of}, which is not a surviving issue in this batch.`
    );
  }
  return problems;
};

// A survivor is in the batch, has an entry, and is not a duplicate itself.
const isSurvivor = (
  batch: readonly number[],
  entries: readonly PlanEntry[],
  number: number
): boolean =>
  batch.includes(number) &&
  entries.some(
    (entry) => entry.number === number && entry.duplicate_of == null
  );

const isExploreTag = (tag: string): boolean =>
  (exploreTags as readonly string[]).includes(tag);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPlanEntry = (value: unknown): value is PlanEntry =>
  isObject(value) &&
  Number.isInteger(value.number) &&
  typeof value.tag === "string" &&
  typeof value.comment === "string" &&
  (value.duplicate_of == null || Number.isInteger(value.duplicate_of));

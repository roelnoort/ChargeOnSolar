// The gate between the split agent and GitHub. The split-apply job in
// agent-implement-spec.yml runs this on the plan before it creates a single
// issue, and any problem refuses the whole plan. It runs there on plain Node,
// with no checkout and no `pnpm install`, so this file imports nothing.

type Ticket = {
  readonly title: string;
  readonly body: string;
  // 1-based positions of earlier tickets in the plan.
  readonly blocked_by: readonly number[];
};

// Every problem with the plan, as a sentence. Empty means apply it. The plan
// is whatever the agent handed back, so its shape is checked here too.
export const checkSplit = (plan: unknown): string[] => {
  if (!isObject(plan) || !Array.isArray(plan.tickets)) {
    return ['The plan is not an object with a "tickets" list.'];
  }
  if (plan.tickets.length === 0) {
    return ["The plan has no tickets. There is nothing to create."];
  }
  const shapeProblems = plan.tickets.flatMap((ticket: unknown, index) =>
    isTicket(ticket)
      ? []
      : [
          `Ticket ${index + 1} is not shaped like { title, body, blocked_by }: ${JSON.stringify(ticket)}`,
        ]
  );
  if (shapeProblems.length > 0) return shapeProblems;

  const tickets: readonly Ticket[] = plan.tickets;
  return tickets.flatMap((ticket, index) => ticketProblems(ticket, index + 1));
};

const ticketProblems = (
  { title, body, blocked_by }: Ticket,
  position: number
): string[] => {
  const problems: string[] = [];
  if (title.trim() === "")
    problems.push(`Ticket ${position} has an empty title.`);
  if (body.trim() === "")
    problems.push(`Ticket ${position} has an empty body.`);
  // Blocked only by earlier tickets, so the dependencies can never form a
  // cycle and sub-issue order is an order they can be built in.
  for (const blocker of blocked_by) {
    if (blocker < 1 || blocker >= position) {
      problems.push(
        `Ticket ${position} is blocked by ticket ${blocker}, which does not come before it. A ticket can only be blocked by earlier tickets.`
      );
    }
  }
  return problems;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTicket = (value: unknown): value is Ticket =>
  isObject(value) &&
  typeof value.title === "string" &&
  typeof value.body === "string" &&
  Array.isArray(value.blocked_by) &&
  value.blocked_by.every(Number.isInteger);

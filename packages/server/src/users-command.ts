// `pnpm users`: how the household admin adds and removes Users. There is no
// self-registration; every User has the same rights.
import { userEmail } from "@charge-on-solar/shared";
import { z } from "zod";
import type { Clock } from "./clock.ts";
import type { Storage } from "./storage/index.ts";

export const usersUsage = [
  "Usage:",
  "  pnpm users add <name> <email>",
  "  pnpm users remove <email>",
  "  pnpm users list",
];

const command = z.union([
  z.tuple([z.literal("add"), z.string().trim().min(1), userEmail]),
  z.tuple([z.literal("remove"), userEmail]),
  z.tuple([z.literal("list")]),
]);

export interface UsersCommandResult {
  exitCode: 0 | 1;
  output: string[];
}

export async function runUsersCommand(
  args: string[],
  { storage, clock }: { storage: Storage; clock: Clock }
): Promise<UsersCommandResult> {
  const parsed = command.safeParse(args);
  if (!parsed.success) return { exitCode: 1, output: usersUsage };

  if (parsed.data[0] === "add") {
    const [, name, email] = parsed.data;
    const added = await storage.addUser({ name, email, at: clock.now() });
    return added
      ? { exitCode: 0, output: [`Added ${name} <${email}>`] }
      : { exitCode: 1, output: [`A User with ${email} already exists`] };
  }
  if (parsed.data[0] === "remove") {
    const [, email] = parsed.data;
    const removed = await storage.removeUser(email);
    return removed
      ? {
          exitCode: 0,
          output: [`Removed ${removed.name} <${email}> and signed them out`],
        }
      : { exitCode: 1, output: [`No User with ${email}`] };
  }
  const users = await storage.listUsers();
  return {
    exitCode: 0,
    output: users.map(({ name, email }) => `${name} <${email}>`),
  };
}

import { z } from "zod";

// The tickets a split run hands back. The split-apply job in
// agent-implement-spec.yml checks the whole plan with split-check.ts, then
// creates them as sub-issues of the spec in this order. split-check.ts runs
// without zod, so it checks these rules again by hand: change one, change
// both.
export const splitPlanSchema = z
  .strictObject({
    tickets: z
      .array(
        z.strictObject({
          title: z.string().trim().min(1).describe("The issue title."),
          body: z
            .string()
            .trim()
            .min(1)
            .describe(
              "The issue body in Markdown, starting at `## What to build`. The workflow puts `## Parent` above it."
            ),
          blocked_by: z
            .array(z.number().int().min(1))
            .describe(
              "1-based positions in this list of the EARLIER tickets this one cannot start before. Empty when it can start at once."
            ),
        })
      )
      .min(1)
      .describe(
        "The tickets in the order they should be built. That order becomes the sub-issue order."
      ),
  })
  .describe("The split plan.");

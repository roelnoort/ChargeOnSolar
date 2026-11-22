import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/** Parses a request's JSON body, answering 400 when it breaks the contract. */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  return parseOr400(schema, body);
}

export function parseOr400<T extends z.ZodType>(
  schema: T,
  value: unknown
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
  }
  return parsed.data;
}

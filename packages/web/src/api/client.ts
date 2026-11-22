import {
  apiError,
  type Health,
  health,
  healthPath,
} from "@charge-on-solar/shared";
import type { z } from "zod";

/** Calls the server's API, parsing every answer with the shared contract. */
export function createApiClient(fetchFn: typeof fetch = fetch) {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetchFn(path, {
      headers: { accept: "application/json" },
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = apiError.safeParse(body);
      throw new Error(
        error.success
          ? error.data.error.message
          : `GET ${path} answered ${response.status}`
      );
    }
    return schema.parse(body);
  }

  return {
    health: (): Promise<Health> => get(healthPath, health),
  };
}

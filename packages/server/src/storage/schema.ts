import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const startups = sqliteTable("startups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  version: text("version").notNull(),
});

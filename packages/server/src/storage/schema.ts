import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const startups = sqliteTable("startups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  version: text("version").notNull(),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Every request for a Login code, for any address, for the rate limit. */
export const loginCodeRequests = sqliteTable(
  "login_code_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("login_code_requests_email_at").on(table.email, table.at)]
);

export const loginCodes = sqliteTable(
  "login_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    wrongAttempts: integer("wrong_attempts").notNull().default(0),
    /** Set once the code is used, or when a newer code or too many wrong attempts retire it. */
    retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("login_codes_user_id").on(table.userId)]
);

/** One Signed-in device: a session of one User on one device. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceName: text("device_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("sessions_user_id").on(table.userId)]
);

import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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

/** Every Reading from the P1 meter, as received. Kept, never cleaned up. */
export const p1Readings = sqliteTable(
  "p1_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** When the server received it, in UTC. */
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    /** The meter's own timestamp, as it sent it (local time, no offset). */
    deviceTimestamp: text("device_timestamp"),
    netPowerW: real("net_power_w").notNull(),
    powerL1W: real("power_l1_w"),
    powerL2W: real("power_l2_w"),
    powerL3W: real("power_l3_w"),
    currentL1A: real("current_l1_a"),
    currentL2A: real("current_l2_a"),
    currentL3A: real("current_l3_a"),
    voltageL1V: real("voltage_l1_v"),
    voltageL2V: real("voltage_l2_v"),
    voltageL3V: real("voltage_l3_v"),
  },
  (table) => [index("p1_readings_received_at").on(table.receivedAt)]
);

/** Every Reading from Zaptec, typed, with the raw state it came from. */
export const chargerReadings = sqliteTable(
  "charger_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** When the server received it, in UTC. */
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    chargerPowerW: real("charger_power_w"),
    chargingCurrentSetA: real("charging_current_set_a"),
    operationMode: integer("operation_mode"),
    finalStopActive: integer("final_stop_active", {
      mode: "boolean",
    }).notNull(),
    nextScheduleEvent: text("next_schedule_event"),
    phaseSetting: integer("phase_setting"),
    maxCurrentA: real("max_current_a"),
    currentL1A: real("current_l1_a"),
    currentL2A: real("current_l2_a"),
    currentL3A: real("current_l3_a"),
    availableCurrentMode: integer("available_current_mode"),
    enabledFeatures: integer("enabled_features"),
    surplusModeActive: integer("surplus_mode_active", { mode: "boolean" }),
    /** The charger state and installation exactly as Zaptec sent them. */
    rawState: text("raw_state").notNull(),
  },
  (table) => [index("charger_readings_received_at").on(table.receivedAt)]
);

/**
 * One Shadow decision per tick of the Shadow runner, with the averaged live
 * data and Zaptec's own state it was made beside. Kept, never cleaned up.
 */
export const shadowDecisions = sqliteTable(
  "shadow_decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    /** The decision, with its Charging current, limit or reason, as JSON. */
    decision: text("decision").notNull(),
    /** The simulated charger after the decision, as JSON. */
    simulated: text("simulated").notNull(),
    surplusW: real("surplus_w"),
    netPowerW: real("net_power_w"),
    solarProductionW: real("solar_production_w"),
    chargerPowerW: real("charger_power_w"),
    fuseHeadroomA: real("fuse_headroom_a"),
    startWindowSurplusW: real("start_window_surplus_w"),
    stopWindowSurplusW: real("stop_window_surplus_w"),
    p1AgeMs: integer("p1_age_ms"),
    chargerAgeMs: integer("charger_age_ms"),
    solarAgeMs: integer("solar_age_ms"),
    availableCurrentMode: integer("available_current_mode"),
    enabledFeatures: integer("enabled_features"),
    surplusModeActive: integer("surplus_mode_active", { mode: "boolean" }),
    chargeCurrentSetA: real("charge_current_set_a"),
    rulesVersion: integer("rules_version").notNull(),
    /** The Shadow settings, Solar mode included, as JSON. */
    settings: text("settings").notNull(),
  },
  (table) => [index("shadow_decisions_at").on(table.at)]
);

/**
 * What the server keeps between restarts that is not a record of the past:
 * one row per key, its value as JSON.
 */
export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

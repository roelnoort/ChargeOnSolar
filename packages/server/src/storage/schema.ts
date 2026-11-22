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

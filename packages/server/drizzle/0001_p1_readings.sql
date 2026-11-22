CREATE TABLE `p1_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` integer NOT NULL,
	`device_timestamp` text,
	`net_power_w` real NOT NULL,
	`power_l1_w` real,
	`power_l2_w` real,
	`power_l3_w` real,
	`current_l1_a` real,
	`current_l2_a` real,
	`current_l3_a` real,
	`voltage_l1_v` real,
	`voltage_l2_v` real,
	`voltage_l3_v` real
);
--> statement-breakpoint
CREATE INDEX `p1_readings_received_at` ON `p1_readings` (`received_at`);
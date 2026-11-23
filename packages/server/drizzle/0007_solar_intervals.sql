CREATE TABLE `enphase_calls` (
	`month` text PRIMARY KEY NOT NULL,
	`calls` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `solar_intervals` (
	`end_at` integer PRIMARY KEY NOT NULL,
	`solar_production_w` real NOT NULL,
	`energy_wh` real NOT NULL,
	`devices_reporting` integer
);

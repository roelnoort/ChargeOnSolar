CREATE TABLE `shadow_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`decision` text NOT NULL,
	`simulated` text NOT NULL,
	`surplus_w` real,
	`net_power_w` real,
	`solar_production_w` real,
	`charger_power_w` real,
	`fuse_headroom_a` real,
	`start_window_surplus_w` real,
	`stop_window_surplus_w` real,
	`p1_age_ms` integer,
	`charger_age_ms` integer,
	`solar_age_ms` integer,
	`available_current_mode` integer,
	`enabled_features` integer,
	`surplus_mode_active` integer,
	`charge_current_set_a` real,
	`rules_version` integer NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shadow_decisions_at` ON `shadow_decisions` (`at`);
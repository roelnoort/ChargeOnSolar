CREATE TABLE `charger_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` integer NOT NULL,
	`charger_power_w` real,
	`charging_current_set_a` real,
	`operation_mode` integer,
	`final_stop_active` integer NOT NULL,
	`next_schedule_event` text,
	`phase_setting` integer,
	`max_current_a` real,
	`current_l1_a` real,
	`current_l2_a` real,
	`current_l3_a` real,
	`available_current_mode` integer,
	`enabled_features` integer,
	`surplus_mode_active` integer,
	`raw_state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `charger_readings_received_at` ON `charger_readings` (`received_at`);
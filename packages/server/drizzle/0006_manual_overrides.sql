CREATE TABLE `manual_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sent_at` integer NOT NULL,
	`user_id` integer,
	`user_name` text NOT NULL,
	`command` text NOT NULL,
	`command_result` text,
	`rejection_code` integer,
	`rejection_reason` text,
	`confirmation` text,
	`answers_pause_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`answers_pause_id`) REFERENCES `pauses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `manual_overrides_sent_at` ON `manual_overrides` (`sent_at`);--> statement-breakpoint
CREATE TABLE `pauses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`override_id` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`ending` text,
	FOREIGN KEY (`override_id`) REFERENCES `manual_overrides`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pauses_ended_at` ON `pauses` (`ended_at`);
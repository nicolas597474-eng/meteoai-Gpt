CREATE TABLE `recovery_weather_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_table` text NOT NULL,
	`source_id` integer NOT NULL,
	`weather_date` text,
	`payload` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_weather_history_source` ON `recovery_weather_history` (`source_table`,`source_id`);--> statement-breakpoint
CREATE TABLE `site_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_users_subject` ON `site_users` (`subject`);
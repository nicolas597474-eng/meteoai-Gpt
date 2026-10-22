CREATE TABLE `site_personal_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`location_key` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`observed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`temperature` real,
	`condition` text NOT NULL,
	`wind_speed` real,
	`precipitation` real,
	`source` text DEFAULT 'personal_declaration' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `site_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `personal_observations_owner_location_time` ON `site_personal_observations` (`user_id`,`location_key`,`observed_at`);
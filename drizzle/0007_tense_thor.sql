CREATE TABLE `weather_physical_references` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`valid_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`station_count` integer NOT NULL,
	`temperature` real NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `physical_references_location_valid` ON `weather_physical_references` (`location_key`,`valid_at`);
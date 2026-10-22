CREATE TABLE `weather_server_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`received_at` integer NOT NULL,
	`persisted_at` integer NOT NULL,
	`measurement_count` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_observations_location_received` ON `weather_server_observations` (`location_key`,`received_at`);
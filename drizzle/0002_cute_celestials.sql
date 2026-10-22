CREATE TABLE `weather_station_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`station_key` text NOT NULL,
	`measured_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`temperature` real NOT NULL,
	`distance` real NOT NULL,
	`elevation` real,
	`source` text NOT NULL,
	`quality_flags` text NOT NULL,
	`payload_digest` text NOT NULL,
	`object_key` text NOT NULL,
	`calibration_eligible` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `station_observations_measured_at` ON `weather_station_observations` (`measured_at`);
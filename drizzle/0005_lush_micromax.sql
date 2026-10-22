CREATE TABLE `weather_daily_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL,
	`origin` text NOT NULL,
	`model_count` integer NOT NULL,
	`forecast_count` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `daily_captures_location_received` ON `weather_daily_captures` (`location_key`,`received_at`);
CREATE TABLE `weather_learning_days` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`valid_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`source_digest` text NOT NULL,
	`coverage_hours` integer NOT NULL,
	`score_count` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_days_location_date` ON `weather_learning_days` (`location_key`,`valid_date`);--> statement-breakpoint
CREATE TABLE `weather_learning_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`received_at` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_forecasts_location_received` ON `weather_learning_forecasts` (`location_key`,`received_at`);
CREATE TABLE `weather_learning_provider_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`model_id` text NOT NULL,
	`provider_run_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `learning_runs_location_received` ON `weather_learning_provider_runs` (`location_key`,`received_at`);
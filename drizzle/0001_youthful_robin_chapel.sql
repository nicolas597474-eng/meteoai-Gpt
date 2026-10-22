CREATE TABLE `weather_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`capture_day` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL,
	`origin` text NOT NULL,
	`model_count` integer NOT NULL,
	`forecast_count` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weather_collection_status` (
	`channel` text PRIMARY KEY NOT NULL,
	`attempted_at` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL
);

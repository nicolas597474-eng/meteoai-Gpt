CREATE TABLE `weather_fusion_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`location_key` text NOT NULL,
	`slot` text NOT NULL,
	`valid_date` text NOT NULL,
	`computed_at` text NOT NULL,
	`received_at` integer NOT NULL,
	`object_key` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fusion_snapshots_slot` ON `weather_fusion_snapshots` (`location_key`,`slot`,`valid_date`);--> statement-breakpoint
CREATE INDEX `fusion_snapshots_time` ON `weather_fusion_snapshots` (`location_key`,`computed_at`);--> statement-breakpoint
ALTER TABLE `site_favorites` ADD `radius_km` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `site_favorites` ADD `local_mode` text DEFAULT 'standard' NOT NULL;
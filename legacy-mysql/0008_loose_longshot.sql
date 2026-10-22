ALTER TABLE `meteoai_forecast` DROP INDEX `meteoai_forecast_date_unique`;--> statement-breakpoint
ALTER TABLE `observations` DROP INDEX `observations_date_unique`;--> statement-breakpoint
ALTER TABLE `forecasts` ADD `locationKey` varchar(32) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `meteoai_forecast` ADD `locationKey` varchar(32) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `observations` ADD `locationKey` varchar(32) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `locationKey` varchar(32) DEFAULT 'default' NOT NULL;
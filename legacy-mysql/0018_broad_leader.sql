ALTER TABLE `weather_stations` ADD `qualificationStatus` varchar(24) DEFAULT 'validated' NOT NULL;--> statement-breakpoint
ALTER TABLE `weather_stations` ADD `sourceTier` int;
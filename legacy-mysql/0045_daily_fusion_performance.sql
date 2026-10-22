CREATE TABLE `daily_forecast_observation_comparisons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`comparisonKey` varchar(160) NOT NULL,
	`forecastRunId` int NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`validDate` varchar(10) NOT NULL,
	`serviceName` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`modelId` varchar(96) NOT NULL,
	`horizonBucket` enum('0-6h','6-24h','1-3d','4-7d','8-15d') NOT NULL,
	`leadTimeMinutes` int NOT NULL,
	`variable` enum('temperature_max','temperature_min','precipitation_sum','wind_speed_max','wind_gust_max') NOT NULL,
	`forecastValue` float NOT NULL,
	`observedValue` float NOT NULL,
	`signedError` float NOT NULL,
	`absoluteError` float NOT NULL,
	`evidenceType` enum('physical_observation') NOT NULL DEFAULT 'physical_observation',
	`observationIsQualified` int NOT NULL DEFAULT 1,
	`observationCoverageHours` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_forecast_observation_comparisons_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_fc_obs_comparison_key_uq` UNIQUE(`comparisonKey`)
);
--> statement-breakpoint
CREATE INDEX `daily_fc_obs_location_date_idx` ON `daily_forecast_observation_comparisons` (`locationKey`,`validDate`);--> statement-breakpoint
CREATE INDEX `daily_fc_obs_selection_idx` ON `daily_forecast_observation_comparisons` (`locationKey`,`horizonBucket`,`variable`,`validDate`);--> statement-breakpoint
CREATE INDEX `daily_fc_obs_model_idx` ON `daily_forecast_observation_comparisons` (`locationKey`,`serviceName`,`variable`,`horizonBucket`,`validDate`);
CREATE TABLE `daily_forecast_observation_comparison_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`comparisonKey` varchar(160) NOT NULL,
	`revisionHash` varchar(64) NOT NULL,
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
	`forecastAvailableAt` bigint,
	`observationWindowStartAt` bigint,
	`observationWindowEndAt` bigint,
	`stationEvidence` json,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_forecast_observation_comparison_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_fc_obs_revision_hash_uq` UNIQUE(`comparisonKey`,`revisionHash`)
);
--> statement-breakpoint
CREATE INDEX `daily_fc_obs_revision_location_date_idx` ON `daily_forecast_observation_comparison_revisions` (`locationKey`,`validDate`,`id`);--> statement-breakpoint
CREATE INDEX `daily_fc_obs_revision_selection_idx` ON `daily_forecast_observation_comparison_revisions` (`locationKey`,`horizonBucket`,`variable`,`validDate`,`id`);
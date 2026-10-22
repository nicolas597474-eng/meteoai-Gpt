CREATE TABLE `hourly_forecast_exact_comparisons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`forecastRunValueId` int NOT NULL,
	`observationSnapshotId` int NOT NULL,
	`captureRunId` varchar(36) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`sourceName` varchar(64) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96),
	`variable` varchar(32) NOT NULL,
	`validTime` bigint NOT NULL,
	`availableAt` bigint NOT NULL,
	`horizonMilliseconds` bigint NOT NULL,
	`horizonMinutes` double NOT NULL,
	`horizonBucket` varchar(16) NOT NULL,
	`forecastValue` float NOT NULL,
	`forecastUnit` varchar(32),
	`observedValue` float NOT NULL,
	`observedUnit` varchar(32) NOT NULL,
	`signedError` float NOT NULL,
	`absoluteError` float NOT NULL,
	`observationDate` varchar(10) NOT NULL,
	`observationHour` int NOT NULL,
	`observationReferenceAt` bigint NOT NULL,
	`observationCollectedAt` bigint,
	`stationCount` int NOT NULL,
	`confidenceScore` float,
	`stationsUsed` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_exact_comparisons_id` PRIMARY KEY(`id`),
	CONSTRAINT `hourly_exact_comparison_run_snapshot_uq` UNIQUE(`forecastRunValueId`,`observationSnapshotId`)
);
--> statement-breakpoint
CREATE TABLE `hourly_forecast_exact_evaluation_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`date` varchar(10) NOT NULL,
	`sourceName` varchar(64) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96),
	`variable` varchar(32) NOT NULL,
	`horizonMilliseconds` bigint NOT NULL,
	`horizonMinutes` double NOT NULL,
	`horizonBucket` varchar(16) NOT NULL,
	`observationCount` int NOT NULL DEFAULT 0,
	`evaluableObservationCount` int NOT NULL DEFAULT 0,
	`sampleSize` int NOT NULL DEFAULT 0,
	`coverageRatio` float NOT NULL DEFAULT 0,
	`mae` float,
	`rmse` float,
	`bias` float,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_exact_evaluation_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `hourly_exact_eval_day_model_variable_lead_uq` UNIQUE(`locationKey`,`date`,`sourceName`,`modelName`,`variable`,`horizonMilliseconds`)
);
--> statement-breakpoint
CREATE INDEX `hourly_exact_comparison_location_time_idx` ON `hourly_forecast_exact_comparisons` (`locationKey`,`validTime`);--> statement-breakpoint
CREATE INDEX `hourly_exact_comparison_model_lead_idx` ON `hourly_forecast_exact_comparisons` (`locationKey`,`modelName`,`variable`,`horizonMilliseconds`,`observationDate`);--> statement-breakpoint
CREATE INDEX `hourly_exact_eval_location_date_idx` ON `hourly_forecast_exact_evaluation_scores` (`locationKey`,`date`);--> statement-breakpoint
CREATE INDEX `hourly_exact_eval_model_lead_date_idx` ON `hourly_forecast_exact_evaluation_scores` (`locationKey`,`modelName`,`variable`,`horizonMilliseconds`,`date`);
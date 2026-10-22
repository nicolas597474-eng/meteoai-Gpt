CREATE TABLE `hourly_forecast_evaluation_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`date` varchar(10) NOT NULL,
	`sourceName` varchar(64) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96),
	`variable` varchar(32) NOT NULL,
	`horizonBucket` varchar(16) NOT NULL,
	`observationCount` int NOT NULL DEFAULT 0,
	`evaluableObservationCount` int NOT NULL DEFAULT 0,
	`sampleSize` int NOT NULL DEFAULT 0,
	`coverageRatio` float NOT NULL DEFAULT 0,
	`mae` float,
	`rmse` float,
	`bias` float,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_evaluation_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `hourly_eval_score_day_model_variable_horizon_unique` UNIQUE(`locationKey`,`date`,`sourceName`,`modelName`,`variable`,`horizonBucket`)
);
--> statement-breakpoint
CREATE TABLE `hourly_forecast_run_values` (
	`id` int AUTO_INCREMENT NOT NULL,
	`captureRunId` varchar(36) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`targetDate` varchar(10) NOT NULL,
	`sourceName` varchar(64) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96),
	`requestStartedAt` bigint NOT NULL,
	`availableAt` bigint NOT NULL,
	`validTime` bigint NOT NULL,
	`variable` varchar(32) NOT NULL,
	`value` float,
	`unit` varchar(32),
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_run_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `hourly_run_values_identity` UNIQUE(`captureRunId`,`locationKey`,`modelName`,`validTime`,`variable`)
);
--> statement-breakpoint
CREATE INDEX `hourly_eval_score_location_date_idx` ON `hourly_forecast_evaluation_scores` (`locationKey`,`date`);--> statement-breakpoint
CREATE INDEX `hourly_run_values_location_target_idx` ON `hourly_forecast_run_values` (`locationKey`,`targetDate`);--> statement-breakpoint
CREATE INDEX `hourly_run_values_series_idx` ON `hourly_forecast_run_values` (`locationKey`,`modelName`,`variable`,`validTime`);
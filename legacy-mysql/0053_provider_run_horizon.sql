CREATE TABLE `hourly_forecast_provider_run_captures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`captureRunId` varchar(36) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`targetDate` varchar(10) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96) NOT NULL,
	`leadBasis` varchar(32) NOT NULL DEFAULT 'provider_run',
	`status` varchar(48) NOT NULL,
	`reasonCode` varchar(64),
	`metadataUrl` varchar(512),
	`metadataHttpStatus` int,
	`metadataAvailableAt` bigint,
	`providerRunAt` bigint,
	`requestStartedAt` bigint,
	`availableAt` bigint,
	`collectionLatencyMilliseconds` bigint,
	`requestUrl` text,
	`responseStatus` int,
	`responsePayload` json,
	`valuesStored` int NOT NULL DEFAULT 0,
	`minimumForecastLeadMilliseconds` bigint,
	`maximumForecastLeadMilliseconds` bigint,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_provider_run_captures_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_run_capture_id_uq` UNIQUE(`captureRunId`)
);
--> statement-breakpoint
CREATE TABLE `hourly_forecast_provider_run_comparisons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`forecastRunValueId` int NOT NULL,
	`observationSnapshotId` int NOT NULL,
	`captureRunId` varchar(36) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96) NOT NULL,
	`leadBasis` varchar(32) NOT NULL DEFAULT 'provider_run',
	`variable` varchar(32) NOT NULL,
	`metadataAvailableAt` bigint NOT NULL,
	`providerRunAt` bigint NOT NULL,
	`requestStartedAt` bigint NOT NULL,
	`availableAt` bigint NOT NULL,
	`validTime` bigint NOT NULL,
	`forecastLeadTimeMilliseconds` bigint NOT NULL,
	`forecastLeadTimeMinutes` double NOT NULL,
	`collectionLatencyMilliseconds` bigint NOT NULL,
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
	CONSTRAINT `hourly_forecast_provider_run_comparisons_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_run_comparison_run_snapshot_uq` UNIQUE(`forecastRunValueId`,`observationSnapshotId`)
);
--> statement-breakpoint
CREATE TABLE `hourly_forecast_provider_run_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`date` varchar(10) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96) NOT NULL,
	`leadBasis` varchar(32) NOT NULL DEFAULT 'provider_run',
	`variable` varchar(32) NOT NULL,
	`forecastLeadTimeMilliseconds` bigint NOT NULL,
	`forecastLeadTimeMinutes` double NOT NULL,
	`observationCount` int NOT NULL DEFAULT 0,
	`evaluableObservationCount` int NOT NULL DEFAULT 0,
	`sampleSize` int NOT NULL DEFAULT 0,
	`coverageRatio` float NOT NULL DEFAULT 0,
	`mae` float,
	`rmse` float,
	`bias` float,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_provider_run_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_run_score_day_model_variable_lead_uq` UNIQUE(`locationKey`,`date`,`modelName`,`modelId`,`leadBasis`,`variable`,`forecastLeadTimeMilliseconds`)
);
--> statement-breakpoint
CREATE TABLE `hourly_forecast_provider_run_values` (
	`id` int AUTO_INCREMENT NOT NULL,
	`captureRunId` varchar(36) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`targetDate` varchar(10) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96) NOT NULL,
	`leadBasis` varchar(32) NOT NULL DEFAULT 'provider_run',
	`metadataAvailableAt` bigint NOT NULL,
	`providerRunAt` bigint NOT NULL,
	`requestStartedAt` bigint NOT NULL,
	`availableAt` bigint NOT NULL,
	`validTime` bigint NOT NULL,
	`forecastLeadTimeMilliseconds` bigint NOT NULL,
	`collectionLatencyMilliseconds` bigint NOT NULL,
	`variable` varchar(32) NOT NULL,
	`value` float,
	`unit` varchar(32),
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecast_provider_run_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_run_value_identity_uq` UNIQUE(`captureRunId`,`validTime`,`variable`)
);
--> statement-breakpoint
CREATE INDEX `provider_run_capture_location_time_idx` ON `hourly_forecast_provider_run_captures` (`locationKey`,`capturedAt`);--> statement-breakpoint
CREATE INDEX `provider_run_capture_model_time_idx` ON `hourly_forecast_provider_run_captures` (`locationKey`,`modelName`,`capturedAt`);--> statement-breakpoint
CREATE INDEX `provider_run_comparison_location_time_idx` ON `hourly_forecast_provider_run_comparisons` (`locationKey`,`validTime`);--> statement-breakpoint
CREATE INDEX `provider_run_comparison_model_lead_idx` ON `hourly_forecast_provider_run_comparisons` (`locationKey`,`modelName`,`variable`,`forecastLeadTimeMilliseconds`,`observationDate`);--> statement-breakpoint
CREATE INDEX `provider_run_score_location_date_idx` ON `hourly_forecast_provider_run_scores` (`locationKey`,`date`);--> statement-breakpoint
CREATE INDEX `provider_run_score_model_lead_date_idx` ON `hourly_forecast_provider_run_scores` (`locationKey`,`modelName`,`variable`,`forecastLeadTimeMilliseconds`,`date`);--> statement-breakpoint
CREATE INDEX `provider_run_value_location_target_idx` ON `hourly_forecast_provider_run_values` (`locationKey`,`targetDate`);--> statement-breakpoint
CREATE INDEX `provider_run_value_series_idx` ON `hourly_forecast_provider_run_values` (`locationKey`,`modelName`,`variable`,`validTime`);
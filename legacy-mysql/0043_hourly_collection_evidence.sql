CREATE TABLE `hourly_forecast_collection_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collectionJobId` int NOT NULL,
	`scheduleRunKey` varchar(48) NOT NULL,
	`batchAttemptId` varchar(36) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`targetDate` varchar(10) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`modelId` varchar(96),
	`isOfficialModel` int NOT NULL DEFAULT 0,
	`sourceName` varchar(64) NOT NULL,
	`status` enum('attempting','succeeded','partial','failed','safe_error') NOT NULL,
	`requestAttempts` int NOT NULL DEFAULT 0,
	`hoursReceived` int NOT NULL DEFAULT 0,
	`valuesReceived` int NOT NULL DEFAULT 0,
	`expectedValueCount` int NOT NULL DEFAULT 0,
	`archiveRowsWritten` int NOT NULL DEFAULT 0,
	`projectionRowsWritten` int NOT NULL DEFAULT 0,
	`errorCode` varchar(32),
	`attemptedAt` bigint NOT NULL,
	`completedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `hourly_forecast_collection_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `hourly_collection_attempt_source_unique` UNIQUE(`batchAttemptId`,`locationKey`,`modelName`)
);
--> statement-breakpoint
CREATE INDEX `hourly_collection_location_time_idx` ON `hourly_forecast_collection_results` (`locationKey`,`attemptedAt`);--> statement-breakpoint
CREATE INDEX `hourly_collection_schedule_slot_idx` ON `hourly_forecast_collection_results` (`scheduleRunKey`,`locationKey`);
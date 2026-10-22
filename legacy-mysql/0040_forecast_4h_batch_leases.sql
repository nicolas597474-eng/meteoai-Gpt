CREATE TABLE `forecast_refresh_locks` (
	`lockKey` varchar(64) NOT NULL,
	`ownerToken` varchar(64) NOT NULL,
	`leaseExpiresAt` timestamp NOT NULL,
	CONSTRAINT `forecast_refresh_locks_lockKey` PRIMARY KEY(`lockKey`)
);
--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `scheduleRunKey` varchar(48);--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `dailyModelsCollected` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `dailyModelsExpected` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `hourlyModelsCollected` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD `hourlyModelsExpected` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_jobs` ADD CONSTRAINT `collection_jobs_schedule_run_key_unique` UNIQUE(`scheduleRunKey`);
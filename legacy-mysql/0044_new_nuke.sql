CREATE TABLE `shadow_weather_daily_unified_candidates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`cycleKey` varchar(128) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`forecastDate` varchar(10) NOT NULL,
	`validTime` bigint NOT NULL,
	`candidateStatus` varchar(16) NOT NULL,
	`deterministicSourceCount` int NOT NULL DEFAULT 0,
	`expectedDeterministicSourceCount` int NOT NULL DEFAULT 7,
	`variableResults` json NOT NULL,
	`legacyReference` json NOT NULL,
	`bestMatchReference` json NOT NULL,
	`missingEvidence` json NOT NULL,
	`productionReadsEnabled` int NOT NULL DEFAULT 0,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_weather_daily_unified_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_daily_unified_cycle_location_date_uq` UNIQUE(`cycleKey`,`locationKey`,`forecastDate`)
);
--> statement-breakpoint
CREATE INDEX `shadow_daily_unified_location_status_idx` ON `shadow_weather_daily_unified_candidates` (`locationKey`,`candidateStatus`);--> statement-breakpoint
CREATE INDEX `shadow_daily_unified_applied_idx` ON `shadow_weather_daily_unified_candidates` (`appliedToProduction`);
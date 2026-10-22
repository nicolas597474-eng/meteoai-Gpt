CREATE TABLE `shadow_weather_phase7_local_performance` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`periodKey` varchar(64) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`sourceKey` varchar(128) NOT NULL,
	`variable` varchar(48) NOT NULL,
	`phase3WindowKey` varchar(16) NOT NULL,
	`evidenceType` varchar(32) NOT NULL,
	`performanceStatus` varchar(16) NOT NULL,
	`comparisonCount` int NOT NULL DEFAULT 0,
	`evaluatedDays` int NOT NULL DEFAULT 0,
	`physicalComparisonCount` int NOT NULL DEFAULT 0,
	`legacyComparisonCount` int NOT NULL DEFAULT 0,
	`mae` float,
	`rmse` float,
	`bias` float,
	`lastValidTime` bigint,
	`missingEvidence` json,
	`productionReadsEnabled` int NOT NULL DEFAULT 0,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_weather_phase7_local_performance_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_p7_perf_period_loc_src_var_win_uq` UNIQUE(`periodKey`,`locationKey`,`sourceKey`,`variable`,`phase3WindowKey`)
);
--> statement-breakpoint
CREATE INDEX `shadow_phase7_local_performance_location_status_idx` ON `shadow_weather_phase7_local_performance` (`locationKey`,`performanceStatus`);--> statement-breakpoint
CREATE INDEX `shadow_phase7_local_performance_source_variable_idx` ON `shadow_weather_phase7_local_performance` (`sourceKey`,`variable`);--> statement-breakpoint
CREATE INDEX `shadow_phase7_local_performance_applied_idx` ON `shadow_weather_phase7_local_performance` (`appliedToProduction`);
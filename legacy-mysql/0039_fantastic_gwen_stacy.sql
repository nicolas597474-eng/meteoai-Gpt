CREATE TABLE `shadow_weather_phase8_comparisons` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`comparisonKey` varchar(160) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`sourceKey` varchar(128) NOT NULL,
	`variable` varchar(48) NOT NULL,
	`phase3WindowKey` varchar(16) NOT NULL,
	`forecastRunId` bigint NOT NULL,
	`forecastIssuedAt` bigint NOT NULL,
	`forecastValidTime` bigint NOT NULL,
	`forecastHorizonMinutes` int NOT NULL,
	`observationId` int NOT NULL,
	`observationDate` varchar(10) NOT NULL,
	`observationHour` int NOT NULL,
	`observationAt` bigint NOT NULL,
	`observationCollectedAt` timestamp NOT NULL,
	`forecastValue` float NOT NULL,
	`observedValue` float NOT NULL,
	`error` float NOT NULL,
	`absoluteError` float NOT NULL,
	`observationQualityStatus` varchar(24) NOT NULL,
	`observationStationCount` int NOT NULL,
	`observationConfidence` float,
	`observationProvenance` json NOT NULL,
	`forecastProvenance` json NOT NULL,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shadow_weather_phase8_comparisons_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_p8_comparison_key_uq` UNIQUE(`comparisonKey`)
);
--> statement-breakpoint
CREATE INDEX `shadow_p8_comparison_group_idx` ON `shadow_weather_phase8_comparisons` (`locationKey`,`sourceKey`,`variable`,`phase3WindowKey`);--> statement-breakpoint
CREATE INDEX `shadow_p8_comparison_observation_idx` ON `shadow_weather_phase8_comparisons` (`observationId`,`observationAt`);--> statement-breakpoint
CREATE INDEX `shadow_p8_comparison_applied_idx` ON `shadow_weather_phase8_comparisons` (`appliedToProduction`);
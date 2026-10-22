CREATE TABLE `shadow_local_temperature_nowcasts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`observationDate` varchar(10) NOT NULL,
	`observationHour` int NOT NULL,
	`observationReferenceAt` bigint NOT NULL,
	`observationCollectedAt` bigint NOT NULL,
	`observedTemperature` float,
	`stationCount` int NOT NULL DEFAULT 0,
	`confidenceScore` float,
	`validTime` bigint NOT NULL,
	`horizonMinutes` int,
	`candidateStatus` varchar(24) NOT NULL,
	`baselineTemperature` float,
	`rawResidual` float,
	`boundedResidual` float,
	`correctionFactor` float NOT NULL DEFAULT 0,
	`appliedCorrection` float,
	`correctedTemperature` float,
	`correctionClamped` int NOT NULL DEFAULT 0,
	`forecastAvailableAt` bigint,
	`forecastEvidence` json NOT NULL,
	`reasons` json NOT NULL,
	`productionReadsEnabled` int NOT NULL DEFAULT 0,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_local_temperature_nowcasts_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_local_nowcast_obs_time_valid_uq` UNIQUE(`locationKey`,`observationReferenceAt`,`validTime`)
);
--> statement-breakpoint
CREATE INDEX `shadow_local_nowcast_location_evaluated_idx` ON `shadow_local_temperature_nowcasts` (`locationKey`,`evaluatedAt`);--> statement-breakpoint
CREATE INDEX `shadow_local_nowcast_status_idx` ON `shadow_local_temperature_nowcasts` (`candidateStatus`);--> statement-breakpoint
CREATE INDEX `shadow_local_nowcast_applied_idx` ON `shadow_local_temperature_nowcasts` (`appliedToProduction`);
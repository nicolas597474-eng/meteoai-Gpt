-- Rollback (schema only): DROP TABLE `shadow_local_precipitation_forecast_outcomes`; DROP TABLE `shadow_local_precipitation_forecast_emissions`;
CREATE TABLE `shadow_local_precipitation_forecast_emissions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`observationDate` varchar(10) NOT NULL,
	`observationHour` int NOT NULL,
	`observationReferenceAt` bigint NOT NULL,
	`referenceSnapshotId` int NOT NULL,
	`referenceCollectedAt` bigint NOT NULL,
	`referenceSnapshot` json NOT NULL,
	`emittedAt` bigint NOT NULL,
	`availableAt` bigint NOT NULL,
	`validTime` bigint NOT NULL,
	`horizonMinutes` int NOT NULL,
	`candidateStatus` varchar(24) NOT NULL,
	`baselinePrecipitation` float,
	`baselineWet` int,
	`localWetSignal` int NOT NULL DEFAULT 0,
	`candidateWet` int,
	`continuationFactor` float NOT NULL DEFAULT 0,
	`forecastAvailableAt` bigint,
	`forecastAccumulationWindow` json,
	`forecastProvenance` json NOT NULL,
	`productionReadsEnabled` int NOT NULL DEFAULT 0,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shadow_local_precipitation_forecast_emissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_local_precip_emission_ref_valid_uq` UNIQUE(`locationKey`,`observationReferenceAt`,`validTime`)
);
--> statement-breakpoint
CREATE TABLE `shadow_local_precipitation_forecast_outcomes` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`emissionId` bigint NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`validTime` bigint NOT NULL,
	`horizonMinutes` int NOT NULL,
	`outcomeStatus` varchar(64) NOT NULL,
	`futureSnapshotId` int,
	`futureReferenceAt` bigint,
	`futureCollectedAt` bigint,
	`futureObservedAt` bigint,
	`sourceObservationIds` json NOT NULL,
	`sourceObservations` json NOT NULL,
	`observedPrecipitation` float,
	`observedWet` int,
	`accumulationWindow` json,
	`unavailabilityReason` varchar(128),
	`productionReadsEnabled` int NOT NULL DEFAULT 0,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shadow_local_precipitation_forecast_outcomes_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_local_precip_outcome_emission_uq` UNIQUE(`emissionId`)
);
--> statement-breakpoint
CREATE INDEX `shadow_local_precip_emission_location_valid_idx` ON `shadow_local_precipitation_forecast_emissions` (`locationKey`,`validTime`);--> statement-breakpoint
CREATE INDEX `shadow_local_precip_emission_location_emitted_idx` ON `shadow_local_precipitation_forecast_emissions` (`locationKey`,`emittedAt`);--> statement-breakpoint
CREATE INDEX `shadow_local_precip_outcome_location_status_idx` ON `shadow_local_precipitation_forecast_outcomes` (`locationKey`,`outcomeStatus`);--> statement-breakpoint
CREATE INDEX `shadow_local_precip_outcome_location_valid_idx` ON `shadow_local_precipitation_forecast_outcomes` (`locationKey`,`validTime`);

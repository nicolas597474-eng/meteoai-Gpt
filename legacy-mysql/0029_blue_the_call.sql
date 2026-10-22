CREATE TABLE `shadow_weather_ingestion_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`cycleKey` varchar(128) NOT NULL,
	`sourceDefinitionId` int NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`requestStartedAt` bigint NOT NULL,
	`receivedAt` bigint,
	`providerRunTime` bigint,
	`runTimeKnown` int NOT NULL DEFAULT 0,
	`providerAvailableAt` bigint,
	`status` varchar(16) NOT NULL,
	`attempts` int NOT NULL DEFAULT 1,
	`httpStatus` int,
	`durationMs` int,
	`payloadHash` varchar(64),
	`rawStorageKey` varchar(512),
	`failureClass` varchar(48),
	`failureReason` text,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_weather_ingestion_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_ingestion_cycle_source_location_unique` UNIQUE(`cycleKey`,`sourceDefinitionId`,`locationKey`)
);
--> statement-breakpoint
CREATE TABLE `shadow_weather_licenses` (
	`licenseKey` varchar(64) NOT NULL,
	`label` varchar(128) NOT NULL,
	`termsUrl` varchar(512),
	`usageStatus` varchar(32) NOT NULL,
	`attributionText` text,
	`redistributionAllowed` int NOT NULL DEFAULT 0,
	`reviewedAt` bigint,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_weather_licenses_licenseKey` PRIMARY KEY(`licenseKey`)
);
--> statement-breakpoint
CREATE TABLE `shadow_weather_source_definitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(96) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`sourceFamily` varchar(64) NOT NULL,
	`model` varchar(96) NOT NULL,
	`modelVersion` varchar(64),
	`sourceType` varchar(32) NOT NULL,
	`sourceRole` varchar(32) NOT NULL,
	`independenceClass` varchar(32) NOT NULL,
	`apiIdentifier` varchar(160) NOT NULL,
	`sourceUrl` varchar(512),
	`licenseKey` varchar(64) NOT NULL,
	`nativeResolutionKm` float,
	`expectedUpdateMinutes` int,
	`shadowEnabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_weather_source_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_source_definition_key_unique` UNIQUE(`sourceKey`)
);
--> statement-breakpoint
CREATE TABLE `shadow_weather_source_relations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`relationKey` varchar(128) NOT NULL,
	`parentSourceId` int NOT NULL,
	`childSourceId` int,
	`relationType` varchar(32) NOT NULL,
	`effectiveFrom` bigint,
	`effectiveTo` bigint,
	`evidence` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shadow_weather_source_relations_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_source_relation_key_unique` UNIQUE(`relationKey`)
);
--> statement-breakpoint
CREATE TABLE `shadow_weather_values` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`ingestionRunId` bigint NOT NULL,
	`sourceDefinitionId` int NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`latitude` float NOT NULL,
	`longitude` float NOT NULL,
	`validTime` bigint NOT NULL,
	`forecastHorizonMinutes` int,
	`variable` varchar(48) NOT NULL,
	`value` float,
	`unit` varchar(16) NOT NULL,
	`levelKey` varchar(32) NOT NULL,
	`memberKey` varchar(32) NOT NULL DEFAULT 'deterministic',
	`nativeResolutionKm` float,
	`qualityStatus` varchar(16) NOT NULL,
	`freshnessStatus` varchar(16) NOT NULL,
	`missingData` int NOT NULL DEFAULT 0,
	`confidence` float,
	`qcFlags` json,
	`ingestedAt` bigint NOT NULL,
	`shadowMode` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shadow_weather_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_value_run_valid_variable_level_member_unique` UNIQUE(`ingestionRunId`,`validTime`,`variable`,`levelKey`,`memberKey`)
);
--> statement-breakpoint
CREATE INDEX `shadow_ingestion_location_created_idx` ON `shadow_weather_ingestion_runs` (`locationKey`,`createdAt`);--> statement-breakpoint
CREATE INDEX `shadow_ingestion_source_status_idx` ON `shadow_weather_ingestion_runs` (`sourceDefinitionId`,`status`);--> statement-breakpoint
CREATE INDEX `shadow_source_definition_provider_model_idx` ON `shadow_weather_source_definitions` (`provider`,`model`);--> statement-breakpoint
CREATE INDEX `shadow_source_definition_family_independence_idx` ON `shadow_weather_source_definitions` (`sourceFamily`,`independenceClass`);--> statement-breakpoint
CREATE INDEX `shadow_source_relation_parent_type_idx` ON `shadow_weather_source_relations` (`parentSourceId`,`relationType`);--> statement-breakpoint
CREATE INDEX `shadow_value_location_valid_variable_idx` ON `shadow_weather_values` (`locationKey`,`validTime`,`variable`);--> statement-breakpoint
CREATE INDEX `shadow_value_run_quality_idx` ON `shadow_weather_values` (`ingestionRunId`,`qualityStatus`);--> statement-breakpoint
CREATE INDEX `shadow_value_source_valid_variable_idx` ON `shadow_weather_values` (`sourceDefinitionId`,`validTime`,`variable`);--> statement-breakpoint
CREATE INDEX `shadow_value_quality_freshness_ingested_idx` ON `shadow_weather_values` (`qualityStatus`,`freshnessStatus`,`ingestedAt`);
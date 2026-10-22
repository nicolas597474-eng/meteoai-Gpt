CREATE TABLE `forecast_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`validDate` varchar(10) NOT NULL,
	`serviceName` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`modelId` varchar(96),
	`sourceKind` enum('model_forecast','service_forecast') NOT NULL,
	`issuedAt` bigint NOT NULL,
	`tempMax` float,
	`tempMin` float,
	`precipitation` float,
	`windSpeed` float,
	`windGust` float,
	`humidity` float,
	`cloudCover` float,
	`condition` varchar(128),
	`rawData` json,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forecast_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `forecast_runs_unique_emission` UNIQUE(`locationKey`,`validDate`,`serviceName`,`issuedAt`)
);
--> statement-breakpoint
ALTER TABLE `observations` ADD `provenanceType` enum('physical_observation','model_reference','legacy_unqualified') DEFAULT 'legacy_unqualified' NOT NULL;--> statement-breakpoint
ALTER TABLE `observations` ADD `isQualified` int DEFAULT 0 NOT NULL;
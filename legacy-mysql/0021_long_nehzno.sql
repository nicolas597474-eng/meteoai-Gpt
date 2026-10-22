CREATE TABLE `qualified_observation_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`date` varchar(10) NOT NULL,
	`hour` int NOT NULL,
	`stationCount` int NOT NULL,
	`confidenceScore` float,
	`temperature` float,
	`humidity` float,
	`pressure` float,
	`windSpeed` float,
	`windGust` float,
	`precipitation` float,
	`stationsUsed` json,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qualified_observation_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `qualified_observation_snapshot_location_date_hour_unique` UNIQUE(`locationKey`,`date`,`hour`)
);

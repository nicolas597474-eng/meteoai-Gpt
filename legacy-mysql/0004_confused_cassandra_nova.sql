CREATE TABLE `ground_truth` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`refLat` float NOT NULL,
	`refLon` float NOT NULL,
	`radiusKm` float NOT NULL,
	`stationsUsed` json,
	`stationsIgnored` json,
	`temperature` float,
	`humidity` float,
	`pressure` float,
	`windSpeed` float,
	`windGust` float,
	`precipitation` float,
	`stationCount` int NOT NULL,
	`confidenceScore` float,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ground_truth_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `station_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationId` varchar(128) NOT NULL,
	`observedAt` bigint NOT NULL,
	`temperature` float,
	`humidity` float,
	`pressure` float,
	`windSpeed` float,
	`windGust` float,
	`windDirection` float,
	`precipitation` float,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `station_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `weather_stations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationId` varchar(128) NOT NULL,
	`source` varchar(64) NOT NULL,
	`name` varchar(256) NOT NULL,
	`lat` float NOT NULL,
	`lon` float NOT NULL,
	`altitude` float,
	`refLat` float NOT NULL,
	`refLon` float NOT NULL,
	`distanceKm` float NOT NULL,
	`reliabilityScore` float DEFAULT 50,
	`updateFrequencyMin` int,
	`dataAvailability` float DEFAULT 1,
	`isActive` int DEFAULT 1,
	`exclusionReason` varchar(256),
	`firstSeen` timestamp NOT NULL DEFAULT (now()),
	`lastSeen` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weather_stations_id` PRIMARY KEY(`id`),
	CONSTRAINT `weather_stations_stationId_unique` UNIQUE(`stationId`)
);

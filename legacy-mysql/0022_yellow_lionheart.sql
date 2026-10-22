CREATE TABLE `station_quality_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationId` varchar(128) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'en_observation',
	`observationCount` int NOT NULL DEFAULT 0,
	`temperatureObservationCount` int NOT NULL DEFAULT 0,
	`continuityScore` float,
	`completenessScore` float,
	`stabilityScore` float,
	`windowHours` int NOT NULL DEFAULT 0,
	`firstObservedAt` bigint,
	`lastObservedAt` bigint,
	`evaluatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `station_quality_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `station_quality_profile_station_unique` UNIQUE(`stationId`)
);

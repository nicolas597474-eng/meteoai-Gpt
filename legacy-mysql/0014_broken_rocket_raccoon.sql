CREATE TABLE `station_collection_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`date` varchar(10) NOT NULL,
	`radiusKm` int NOT NULL,
	`physicalStationCount` int NOT NULL,
	`dailyModelCount` int NOT NULL,
	`hourlyModelCount` int NOT NULL,
	`dailyMissingModels` json,
	`hourlyMissingModels` json,
	`status` enum('completed','partial','failed') NOT NULL,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `station_collection_snapshots_id` PRIMARY KEY(`id`)
);

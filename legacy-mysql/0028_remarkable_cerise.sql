CREATE TABLE `physical_snapshot_collection_traces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`locationName` varchar(256),
	`date` varchar(10) NOT NULL,
	`hour` int NOT NULL,
	`radiusKm` int NOT NULL,
	`status` enum('stored','no_station','failed') NOT NULL,
	`attempts` int NOT NULL,
	`stationCount` int NOT NULL,
	`reason` text,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `physical_snapshot_collection_traces_id` PRIMARY KEY(`id`),
	CONSTRAINT `physical_snapshot_trace_location_date_hour_unique` UNIQUE(`locationKey`,`date`,`hour`)
);

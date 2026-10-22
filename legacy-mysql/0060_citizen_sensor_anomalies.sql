CREATE TABLE `citizen_sensor_anomalies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refLat` float NOT NULL,
	`refLon` float NOT NULL,
	`stationId` varchar(128) NOT NULL,
	`version` varchar(64) NOT NULL,
	`status` varchar(32) NOT NULL,
	`reason` varchar(512) NOT NULL,
	`recentMaeC` float NOT NULL,
	`recentBiasC` float,
	`biasShiftC` float,
	`recentComparisons` int NOT NULL,
	`recentDistinctDays` int NOT NULL,
	`recentMeanOfficialDisagreementC` float,
	`baselineMaeC` float,
	`baselineAcceptanceBoundC` float,
	`anomalyThresholdC` float,
	`baselineWindowDays` int NOT NULL,
	`recentWindowDays` int NOT NULL,
	`firstComparedAt` varchar(32),
	`lastComparedAt` varchar(32),
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citizen_sensor_anomalies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `citizen_sensor_anomalies_reference_idx` ON `citizen_sensor_anomalies` (`refLat`,`refLon`);

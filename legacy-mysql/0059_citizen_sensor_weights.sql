CREATE TABLE `citizen_sensor_weights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refLat` float NOT NULL,
	`refLon` float NOT NULL,
	`stationId` varchar(128) NOT NULL,
	`version` varchar(64) NOT NULL,
	`performanceMultiplier` float NOT NULL,
	`meanAbsoluteErrorC` float NOT NULL,
	`regularizedMaeC` float NOT NULL,
	`meanBiasC` float,
	`sampleReliability` float NOT NULL,
	`comparisons` int NOT NULL,
	`retainedComparisons` int NOT NULL,
	`distinctDays` int NOT NULL,
	`windowDays` int NOT NULL,
	`meanOfficialDisagreementC` float,
	`acceptanceBoundC` float,
	`firstComparedAt` varchar(32),
	`lastComparedAt` varchar(32),
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citizen_sensor_weights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `citizen_sensor_weights_reference_idx` ON `citizen_sensor_weights` (`refLat`,`refLon`);

CREATE TABLE `citizen_variable_qualifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refLat` float NOT NULL,
	`refLon` float NOT NULL,
	`stationId` varchar(128) NOT NULL,
	`variable` varchar(32) NOT NULL,
	`version` varchar(64) NOT NULL,
	`status` varchar(32) NOT NULL,
	`reason` varchar(512) NOT NULL,
	`comparisons` int NOT NULL,
	`retainedComparisons` int NOT NULL,
	`outlierComparisons` int NOT NULL,
	`distinctDays` int NOT NULL,
	`officialStationsUsed` json NOT NULL,
	`meanOfficialDisagreement` float,
	`acceptanceBound` float,
	`meanAbsoluteError` float,
	`meanBias` float,
	`firstComparedAt` varchar(32),
	`lastComparedAt` varchar(32),
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citizen_variable_qualifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `citizen_variable_qualifications_reference_idx` ON `citizen_variable_qualifications` (`refLat`,`refLon`);

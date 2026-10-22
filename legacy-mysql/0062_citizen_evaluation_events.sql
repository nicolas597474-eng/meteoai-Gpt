CREATE TABLE `citizen_evaluation_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referenceKey` varchar(64) NOT NULL,
	`kind` enum('activation','weight','anomaly','variable') NOT NULL,
	`stationId` varchar(128),
	`variable` varchar(32),
	`evaluatedAt` bigint NOT NULL,
	`payload` json NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citizen_evaluation_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `citizen_evaluation_events_identity` UNIQUE(`kind`,`referenceKey`,`payloadHash`)
);
--> statement-breakpoint
CREATE INDEX `citizen_evaluation_events_reference_time` ON `citizen_evaluation_events` (`referenceKey`,`evaluatedAt`,`id`);
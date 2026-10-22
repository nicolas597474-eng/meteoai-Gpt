CREATE TABLE `citizen_fusion_activations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refLat` float NOT NULL,
	`refLon` float NOT NULL,
	`status` enum('activated','not-activated') NOT NULL,
	`version` varchar(64) NOT NULL,
	`reason` varchar(512) NOT NULL,
	`comparisons` int NOT NULL,
	`distinctDays` int NOT NULL,
	`windowDays` int NOT NULL,
	`baselineMaeC` float,
	`withCitizenMaeC` float,
	`improvementC` float,
	`validatedCitizenStations` json NOT NULL,
	`firstComparedAt` varchar(32),
	`lastComparedAt` varchar(32),
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citizen_fusion_activations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `citizen_fusion_activations_reference_idx` ON `citizen_fusion_activations` (`refLat`,`refLon`);

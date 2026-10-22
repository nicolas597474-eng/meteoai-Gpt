CREATE TABLE `shadow_weather_phase6_candidates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`cycleKey` varchar(128) NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`validTime` bigint NOT NULL,
	`variable` varchar(48) NOT NULL,
	`phase3WindowKey` varchar(16) NOT NULL,
	`candidateStatus` varchar(16) NOT NULL,
	`candidateValue` float,
	`contributingSourceCount` int NOT NULL DEFAULT 0,
	`independentSourceCount` int NOT NULL DEFAULT 0,
	`weights` json NOT NULL,
	`referenceValues` json NOT NULL,
	`productionReadsEnabled` int NOT NULL DEFAULT 0,
	`shadowMode` int NOT NULL DEFAULT 1,
	`appliedToProduction` int NOT NULL DEFAULT 0,
	`evaluatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shadow_weather_phase6_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_phase6_candidate_cycle_location_time_variable_unique` UNIQUE(`cycleKey`,`locationKey`,`validTime`,`variable`)
);
--> statement-breakpoint
CREATE INDEX `shadow_phase6_candidate_location_status_idx` ON `shadow_weather_phase6_candidates` (`locationKey`,`candidateStatus`);--> statement-breakpoint
CREATE INDEX `shadow_phase6_candidate_applied_idx` ON `shadow_weather_phase6_candidates` (`appliedToProduction`);
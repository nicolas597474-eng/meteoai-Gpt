CREATE TABLE `shadow_weather_observation_closures` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`closureStatus` varchar(24) NOT NULL DEFAULT 'CLOSED',
	`validatedByUserId` int NOT NULL,
	`validatedAt` bigint NOT NULL,
	`evidenceSnapshot` json NOT NULL,
	`evidenceHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shadow_weather_observation_closures_id` PRIMARY KEY(`id`),
	CONSTRAINT `shadow_observation_closure_location_unique` UNIQUE(`locationKey`)
);
--> statement-breakpoint
CREATE INDEX `shadow_observation_closure_validator_time_idx` ON `shadow_weather_observation_closures` (`validatedByUserId`,`validatedAt`);
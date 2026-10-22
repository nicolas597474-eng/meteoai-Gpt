CREATE TABLE `personal_model_calibrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`comparisonCount` int NOT NULL DEFAULT 0,
	`scoreEma` float,
	`temperatureMaeEma` float,
	`conditionScoreEma` float,
	`windScoreEma` float,
	`weightMultiplier` float NOT NULL DEFAULT 1,
	`evidenceState` varchar(24) NOT NULL DEFAULT 'insufficient',
	`lastObservationAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personal_model_calibrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_model_calibration_user_location_model_unique` UNIQUE(`userId`,`locationKey`,`modelName`)
);
--> statement-breakpoint
CREATE TABLE `personal_model_observation_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`observationId` int NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`temperatureError` float,
	`temperatureScore` float,
	`conditionScore` float,
	`windScore` float,
	`overallScore` float NOT NULL,
	`forecastSnapshot` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `personal_model_observation_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_model_score_observation_model_unique` UNIQUE(`observationId`,`modelName`)
);
--> statement-breakpoint
CREATE TABLE `personal_weather_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`lat` float NOT NULL,
	`lon` float NOT NULL,
	`observedAt` bigint NOT NULL,
	`temperature` float,
	`condition` varchar(32) NOT NULL,
	`windSpeed` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personal_weather_observations_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_weather_observation_user_time_unique` UNIQUE(`userId`,`locationKey`,`observedAt`)
);

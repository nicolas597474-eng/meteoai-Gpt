CREATE TABLE `collection_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobType` enum('forecast','observation') NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`servicesCollected` int,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `collection_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forecasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`serviceName` varchar(64) NOT NULL,
	`serviceCategory` enum('public','expert') NOT NULL,
	`tempMax` float,
	`tempMin` float,
	`precipitation` float,
	`windSpeed` float,
	`windGust` float,
	`humidity` float,
	`cloudCover` float,
	`condition` varchar(128),
	`rawData` json,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `forecasts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meteoai_forecast` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`tempMax` float,
	`tempMin` float,
	`precipitation` float,
	`windSpeed` float,
	`condition` varchar(128),
	`stabilityIndex` float,
	`stabilityLabel` enum('stable','unstable') NOT NULL,
	`confidenceScore` float,
	`weights` json,
	`explanation` text,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meteoai_forecast_id` PRIMARY KEY(`id`),
	CONSTRAINT `meteoai_forecast_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`tempMax` float,
	`tempMin` float,
	`precipitation` float,
	`windSpeed` float,
	`windGust` float,
	`humidity` float,
	`cloudCover` float,
	`condition` varchar(128),
	`source` varchar(128),
	`rawData` json,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `observations_id` PRIMARY KEY(`id`),
	CONSTRAINT `observations_date_unique` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `reliability_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`serviceName` varchar(64) NOT NULL,
	`maeTemp` float,
	`maePrecip` float,
	`maeWind` float,
	`rmseTemp` float,
	`rmsePrecip` float,
	`rmseWind` float,
	`biasTemp` float,
	`biasPrecip` float,
	`biasWind` float,
	`conditionAccuracy` float,
	`weightedScore` float,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reliability_scores_id` PRIMARY KEY(`id`)
);

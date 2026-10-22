CREATE TABLE `lead_time_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL DEFAULT 'default',
	`date` varchar(10) NOT NULL,
	`serviceName` varchar(64) NOT NULL,
	`bucket` varchar(10) NOT NULL,
	`maeTemp` float,
	`rmseTemp` float,
	`biasTemp` float,
	`maePrecip` float,
	`maeWind` float,
	`sampleSize` int NOT NULL DEFAULT 0,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_time_scores_id` PRIMARY KEY(`id`)
);

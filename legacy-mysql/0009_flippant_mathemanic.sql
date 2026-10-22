CREATE TABLE `hourly_forecasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationKey` varchar(32) NOT NULL,
	`date` varchar(10) NOT NULL,
	`hour` int NOT NULL,
	`modelName` varchar(64) NOT NULL,
	`temperature` float,
	`apparentTemperature` float,
	`precipitation` float,
	`windSpeed` float,
	`windGusts` float,
	`windDirection` int,
	`humidity` float,
	`cloudCover` float,
	`weatherCode` int,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_forecasts_id` PRIMARY KEY(`id`)
);

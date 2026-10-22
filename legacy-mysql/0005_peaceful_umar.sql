CREATE TABLE `favorite_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(256) NOT NULL,
	`customName` varchar(256),
	`lat` float NOT NULL,
	`lon` float NOT NULL,
	`isDefault` int DEFAULT 0,
	`position` int NOT NULL DEFAULT 0,
	`radiusKm` int DEFAULT 20,
	`preferredModels` json,
	`tempUnit` enum('celsius','fahrenheit') DEFAULT 'celsius',
	`alertsEnabled` int DEFAULT 1,
	`alertThresholds` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `favorite_locations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `alert_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` varchar(64) NOT NULL,
	`locationKey` varchar(32) NOT NULL DEFAULT 'default',
	`locationName` varchar(128) NOT NULL DEFAULT 'Ma position',
	`alertType` varchar(32) NOT NULL,
	`severity` varchar(16) NOT NULL DEFAULT 'warning',
	`title` varchar(256) NOT NULL,
	`message` text NOT NULL,
	`regimeId` varchar(32),
	`temperature` float,
	`windSpeed` float,
	`precipitation` float,
	`isRead` tinyint NOT NULL DEFAULT 0,
	`triggeredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alert_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` varchar(64) NOT NULL,
	`locationKey` varchar(32) NOT NULL DEFAULT 'default',
	`locationName` varchar(128) NOT NULL DEFAULT 'Ma position',
	`dangerousRegime` tinyint NOT NULL DEFAULT 1,
	`extremeHeat` tinyint NOT NULL DEFAULT 1,
	`extremeCold` tinyint NOT NULL DEFAULT 1,
	`strongWind` tinyint NOT NULL DEFAULT 1,
	`heavyRain` tinyint NOT NULL DEFAULT 1,
	`frost` tinyint NOT NULL DEFAULT 1,
	`heatThresholdC` float NOT NULL DEFAULT 35,
	`coldThresholdC` float NOT NULL DEFAULT 0,
	`windThresholdKmh` float NOT NULL DEFAULT 60,
	`rainThresholdMm` float NOT NULL DEFAULT 20,
	`regimeConfidenceThreshold` float NOT NULL DEFAULT 60,
	`inAppEnabled` tinyint NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_preferences_id` PRIMARY KEY(`id`)
);

CREATE TABLE `netatmo_oauth_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`encryptedRefreshToken` text NOT NULL,
	`scopes` varchar(256) NOT NULL DEFAULT 'read_station',
	`connectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `netatmo_oauth_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `netatmo_oauth_tokens_userId_unique` UNIQUE(`userId`)
);

CREATE TABLE `netatmo_oauth_states` (
	`stateHash` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `netatmo_oauth_states_stateHash` PRIMARY KEY(`stateHash`)
);

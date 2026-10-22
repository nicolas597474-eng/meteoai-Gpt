CREATE TABLE `hourly_comparison_diagnostic_snapshots` (
	`locationKey` varchar(32) NOT NULL,
	`cycleDate` varchar(10) NOT NULL,
	`diagnostics` json NOT NULL,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hourly_comparison_diagnostic_snapshots_locationKey` PRIMARY KEY(`locationKey`)
);

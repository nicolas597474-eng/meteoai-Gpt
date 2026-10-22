ALTER TABLE `shadow_weather_ingestion_runs` ADD `providerModifiedAt` bigint;--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidenceStatus` varchar(32) DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidenceScope` varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidenceObservedAt` bigint;--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidenceSourceUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidenceHash` varchar(64);--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidenceDetail` text;--> statement-breakpoint
ALTER TABLE `shadow_weather_ingestion_runs` ADD `runEvidence` json;
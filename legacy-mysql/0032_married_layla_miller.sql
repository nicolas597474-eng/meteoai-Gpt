ALTER TABLE `shadow_weather_source_definitions` ADD `classificationCategory` varchar(32);--> statement-breakpoint
ALTER TABLE `shadow_weather_source_definitions` ADD `classificationRole` varchar(24);--> statement-breakpoint
ALTER TABLE `shadow_weather_source_definitions` ADD `classificationVersion` varchar(64);--> statement-breakpoint
ALTER TABLE `shadow_weather_source_definitions` ADD `classificationEvidence` json;--> statement-breakpoint
ALTER TABLE `shadow_weather_source_definitions` ADD `classificationAppliedToProduction` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shadow_weather_source_definitions` ADD `classifiedAt` bigint;--> statement-breakpoint
CREATE INDEX `shadow_source_definition_phase2_category_idx` ON `shadow_weather_source_definitions` (`classificationCategory`);--> statement-breakpoint
CREATE INDEX `shadow_source_definition_phase2_applied_idx` ON `shadow_weather_source_definitions` (`classificationAppliedToProduction`);
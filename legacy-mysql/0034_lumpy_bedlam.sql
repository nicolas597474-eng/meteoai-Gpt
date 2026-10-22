ALTER TABLE `shadow_weather_values` ADD `phase5QualityStatus` varchar(16);--> statement-breakpoint
ALTER TABLE `shadow_weather_values` ADD `phase5QualityMetadata` json;--> statement-breakpoint
ALTER TABLE `shadow_weather_values` ADD `phase5EvaluatedAt` bigint;--> statement-breakpoint
ALTER TABLE `shadow_weather_values` ADD `phase5AppliedToProduction` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `shadow_value_phase5_status_evaluated_idx` ON `shadow_weather_values` (`phase5QualityStatus`,`phase5EvaluatedAt`);--> statement-breakpoint
CREATE INDEX `shadow_value_phase5_applied_idx` ON `shadow_weather_values` (`phase5AppliedToProduction`);
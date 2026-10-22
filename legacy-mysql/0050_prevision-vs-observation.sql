ALTER TABLE `daily_forecast_observation_comparisons` ADD `forecastAvailableAt` bigint;--> statement-breakpoint
ALTER TABLE `daily_forecast_observation_comparisons` ADD `observationWindowStartAt` bigint;--> statement-breakpoint
ALTER TABLE `daily_forecast_observation_comparisons` ADD `observationWindowEndAt` bigint;--> statement-breakpoint
ALTER TABLE `daily_forecast_observation_comparisons` ADD `stationEvidence` json;
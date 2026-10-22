ALTER TABLE `personal_model_calibrations` ADD `precipitationScoreEma` float;--> statement-breakpoint
ALTER TABLE `personal_model_observation_scores` ADD `precipitationError` float;--> statement-breakpoint
ALTER TABLE `personal_model_observation_scores` ADD `precipitationScore` float;--> statement-breakpoint
ALTER TABLE `personal_weather_observations` ADD `precipitation` float;--> statement-breakpoint
ALTER TABLE `personal_model_calibrations` ADD `precipitationScoreEma` float;

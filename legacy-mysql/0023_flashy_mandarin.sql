ALTER TABLE `hourly_forecasts` ADD `pressure` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `sampleSize` int;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `normalizedScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `humidityScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `humidityMae` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `humidityRmse` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `humidityBias` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `pressureScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `pressureMae` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `pressureRmse` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `pressureBias` float;
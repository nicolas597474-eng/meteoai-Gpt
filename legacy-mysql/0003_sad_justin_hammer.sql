ALTER TABLE `reliability_scores` ADD `tempScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `tempMaxError` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `precipScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `precipPod` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `precipFar` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `precipCsi` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `precipFalsePositives` int;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `precipFalseNegatives` int;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `windScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `windMaeGusts` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `condScore` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `condConcordance` float;--> statement-breakpoint
ALTER TABLE `reliability_scores` ADD `condMaeCloud` float;
CREATE TABLE `site_favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`custom_name` text,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `site_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_favorites_location` ON `site_favorites` (`user_id`,`lat`,`lon`);--> statement-breakpoint
CREATE INDEX `site_favorites_owner` ON `site_favorites` (`user_id`);
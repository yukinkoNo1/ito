CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text NOT NULL,
	`mark` text NOT NULL,
	`color` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`activity_read_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`disabled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_login_unique` ON `members` (`login`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_name_active` ON `members` (`name`) WHERE disabled_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `members_color_active` ON `members` (`color`) WHERE disabled_at IS NULL;
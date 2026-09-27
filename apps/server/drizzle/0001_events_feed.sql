CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`event_id` text NOT NULL,
	`action` text NOT NULL,
	`title` text NOT NULL,
	`diff` text DEFAULT '[]' NOT NULL,
	`visibility` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_created` ON `activity` (`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `changes_created` ON `changes` (`created_at`);--> statement-breakpoint
CREATE TABLE `event_members` (
	`event_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`location` text,
	`all_day` integer NOT NULL,
	`start_at` integer,
	`end_at` integer,
	`start_date` text,
	`end_date` text,
	`rrule` text,
	`exdates` text DEFAULT '[]' NOT NULL,
	`parent_id` text,
	`recurrence_id` text,
	`for_everyone` integer DEFAULT false NOT NULL,
	`busy` integer NOT NULL,
	`visibility` text DEFAULT 'family' NOT NULL,
	`owner_id` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_shape" CHECK((all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_at IS NULL AND end_at IS NULL) OR (all_day = 0 AND start_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL)),
	CONSTRAINT "events_end_date" CHECK(end_date IS NULL OR end_date >= start_date),
	CONSTRAINT "events_end_at" CHECK(end_at IS NULL OR end_at > start_at),
	CONSTRAINT "events_visibility" CHECK(visibility IN ('family', 'private')),
	CONSTRAINT "events_private_not_everyone" CHECK(visibility = 'family' OR for_everyone = 0)
);
--> statement-breakpoint
CREATE INDEX `events_deleted_start` ON `events` (`deleted_at`,`start_at`);--> statement-breakpoint
CREATE INDEX `events_start_date` ON `events` (`start_date`);--> statement-breakpoint
CREATE INDEX `events_parent` ON `events` (`parent_id`);--> statement-breakpoint
CREATE TABLE `feed_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'display' NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`last_user_device_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_tokens_token_hash_unique` ON `feed_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`member_id` text NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`key`, `member_id`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_created` ON `idempotency_keys` (`created_at`);
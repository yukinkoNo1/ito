CREATE TABLE `notification_log` (
	`key` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notification_log_sent` ON `notification_log` (`sent_at`);--> statement-breakpoint
CREATE TABLE `pending_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`event_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`flushed_at` integer
);
--> statement-breakpoint
CREATE INDEX `pending_notices_recipient` ON `pending_notices` (`recipient_id`,`flushed_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_ok_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_member` ON `push_subscriptions` (`member_id`);
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`ok` integer NOT NULL,
	`source` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_member` ON `ai_usage` (`member_id`,`created_at`);
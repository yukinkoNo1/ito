CREATE TABLE `reminder_prefs` (
	`event_id` text NOT NULL,
	`member_id` text NOT NULL,
	`offsets` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);

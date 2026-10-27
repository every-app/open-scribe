CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`calendar_event_id` text,
	`status` text DEFAULT 'recording' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meetings_org_owner` ON `meetings` (`org_id`,`owner_user_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`markdown` text NOT NULL,
	`model` text NOT NULL,
	`generated_at` text DEFAULT (current_timestamp) NOT NULL,
	`edited_at` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`seq` integer NOT NULL,
	`started_ms` integer NOT NULL,
	`ended_ms` integer NOT NULL,
	`speaker` text,
	`text` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segments_meeting_seq` ON `transcript_segments` (`meeting_id`,`seq`);
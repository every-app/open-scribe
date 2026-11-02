CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`space` text NOT NULL,
	`name` text NOT NULL,
	`default_template_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `folders_org` ON `folders` (`org_id`,`space`);--> statement-breakpoint
CREATE TABLE `meeting_folders` (
	`meeting_id` text NOT NULL,
	`folder_id` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`meeting_id`, `folder_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meeting_folders_folder` ON `meeting_folders` (`folder_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `templates_org` ON `templates` (`org_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`default_template_id` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`)
);
--> statement-breakpoint
ALTER TABLE `meetings` ADD `owner_email` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `attendees` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `template_id` text;
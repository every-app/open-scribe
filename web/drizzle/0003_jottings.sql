CREATE TABLE `jottings` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`markdown` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);

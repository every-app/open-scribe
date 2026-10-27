DROP INDEX `segments_meeting_seq`;--> statement-breakpoint
CREATE UNIQUE INDEX `segments_meeting_seq` ON `transcript_segments` (`meeting_id`,`seq`);
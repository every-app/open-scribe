-- Full-text search over each meeting's title, notes, jottings and transcript.
-- search_docs names what each FTS row is (one per title/notes/jottings, one
-- per transcript segment); search_fts holds the text, rowid = search_docs.id.
-- Triggers keep both in step with the source tables; the last statements
-- backfill what exists. char(2)/char(3) are the snippet's match markers, so
-- they are stripped from indexed text. Triggers insert with WHERE NOT EXISTS,
-- not OR IGNORE: an outer statement's conflict policy (an upsert's) would
-- override a trigger's OR IGNORE.
CREATE TABLE `search_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meeting_id` text NOT NULL,
	`field` text NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_docs_key` ON `search_docs` (`meeting_id`,`field`,`seq`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_fts` USING fts5(body, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER search_meeting_insert AFTER INSERT ON meetings BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.id, 'title', 0
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.id AND field = 'title' AND seq = 0);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.id AND field = 'title' AND seq = 0);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.id AND field = 'title' AND seq = 0), replace(replace(new.title, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_meeting_title AFTER UPDATE OF title ON meetings BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.id, 'title', 0
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.id AND field = 'title' AND seq = 0);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.id AND field = 'title' AND seq = 0);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.id AND field = 'title' AND seq = 0), replace(replace(new.title, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_meeting_delete AFTER DELETE ON meetings BEGIN
  DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_docs WHERE meeting_id = old.id);
  DELETE FROM search_docs WHERE meeting_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_notes_insert AFTER INSERT ON notes BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.meeting_id, 'notes', 0
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'notes' AND seq = 0);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'notes' AND seq = 0);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'notes' AND seq = 0), replace(replace(new.markdown, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_notes_update AFTER UPDATE OF markdown ON notes BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.meeting_id, 'notes', 0
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'notes' AND seq = 0);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'notes' AND seq = 0);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'notes' AND seq = 0), replace(replace(new.markdown, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_notes_delete AFTER DELETE ON notes BEGIN
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = old.meeting_id AND field = 'notes' AND seq = 0);
  DELETE FROM search_docs WHERE meeting_id = old.meeting_id AND field = 'notes' AND seq = 0;
END;
--> statement-breakpoint
CREATE TRIGGER search_jottings_insert AFTER INSERT ON jottings BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.meeting_id, 'jottings', 0
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'jottings' AND seq = 0);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'jottings' AND seq = 0);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'jottings' AND seq = 0), replace(replace(new.markdown, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_jottings_update AFTER UPDATE OF markdown ON jottings BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.meeting_id, 'jottings', 0
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'jottings' AND seq = 0);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'jottings' AND seq = 0);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'jottings' AND seq = 0), replace(replace(new.markdown, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_jottings_delete AFTER DELETE ON jottings BEGIN
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = old.meeting_id AND field = 'jottings' AND seq = 0);
  DELETE FROM search_docs WHERE meeting_id = old.meeting_id AND field = 'jottings' AND seq = 0;
END;
--> statement-breakpoint
CREATE TRIGGER search_segment_insert AFTER INSERT ON transcript_segments BEGIN
  INSERT INTO search_docs (meeting_id, field, seq) SELECT new.meeting_id, 'transcript', new.seq
    WHERE NOT EXISTS (SELECT 1 FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'transcript' AND seq = new.seq);
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'transcript' AND seq = new.seq);
  INSERT INTO search_fts (rowid, body) VALUES ((SELECT id FROM search_docs WHERE meeting_id = new.meeting_id AND field = 'transcript' AND seq = new.seq), replace(replace(new.text, char(2), ''), char(3), ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_segment_delete AFTER DELETE ON transcript_segments BEGIN
  DELETE FROM search_fts WHERE rowid = (SELECT id FROM search_docs WHERE meeting_id = old.meeting_id AND field = 'transcript' AND seq = old.seq);
  DELETE FROM search_docs WHERE meeting_id = old.meeting_id AND field = 'transcript' AND seq = old.seq;
END;
--> statement-breakpoint
INSERT OR IGNORE INTO search_docs (meeting_id, field, seq) SELECT id, 'title', 0 FROM meetings;
--> statement-breakpoint
INSERT OR IGNORE INTO search_docs (meeting_id, field, seq) SELECT meeting_id, 'notes', 0 FROM notes;
--> statement-breakpoint
INSERT OR IGNORE INTO search_docs (meeting_id, field, seq) SELECT meeting_id, 'jottings', 0 FROM jottings;
--> statement-breakpoint
INSERT OR IGNORE INTO search_docs (meeting_id, field, seq) SELECT meeting_id, 'transcript', seq FROM transcript_segments;
--> statement-breakpoint
INSERT INTO search_fts (rowid, body) SELECT d.id, replace(replace(m.title, char(2), ''), char(3), '') FROM search_docs d JOIN meetings m ON m.id = d.meeting_id WHERE d.field = 'title';
--> statement-breakpoint
INSERT INTO search_fts (rowid, body) SELECT d.id, replace(replace(n.markdown, char(2), ''), char(3), '') FROM search_docs d JOIN notes n ON n.meeting_id = d.meeting_id WHERE d.field = 'notes';
--> statement-breakpoint
INSERT INTO search_fts (rowid, body) SELECT d.id, replace(replace(j.markdown, char(2), ''), char(3), '') FROM search_docs d JOIN jottings j ON j.meeting_id = d.meeting_id WHERE d.field = 'jottings';
--> statement-breakpoint
INSERT INTO search_fts (rowid, body) SELECT d.id, replace(replace(s.text, char(2), ''), char(3), '') FROM search_docs d JOIN transcript_segments s ON s.meeting_id = d.meeting_id AND s.seq = d.seq WHERE d.field = 'transcript';

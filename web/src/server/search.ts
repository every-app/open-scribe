import { sql } from "drizzle-orm";
import type {
  SearchField,
  SearchResponse,
  SearchSnippet,
} from "@/api/contract";
import { db } from "@/db";
import { meetingVisibleTo } from "./access";
import { meetingRowsByIds } from "./meetings";
import type { Viewer } from "./viewer";

/**
 * Full-text search (SQLite FTS5, migration 0004_search.sql). Each meeting's
 * title, notes, jottings and transcript segments are rows of `search_fts`,
 * named by `search_docs` and kept in step by triggers on the source tables.
 */

/** Marks the snippet() puts around a match; stripped from indexed text. */
const OPEN = "\u0002";
const CLOSE = "\u0003";

const MAX_TERMS = 12;
const MAX_OFFSET = 1000;

/**
 * The person's words as an FTS5 query: letters and digits only, each a
 * quoted prefix term, all required. Null when nothing is left. Quoting
 * every term means no FTS5 syntax (NEAR, OR, column filters, `"`) ever
 * comes from the client.
 */
export function toMatchQuery(q: string): string | null {
  const terms = (q.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, MAX_TERMS)
    .map((term) => term.slice(0, 64));
  return terms.length ? terms.map((term) => `"${term}"*`).join(" ") : null;
}

/**
 * snippet()'s output (matches between OPEN and CLOSE) as plain text with
 * the matches' offsets. Nothing in it is markup: a client renders `text`
 * as text and highlights the ranges.
 */
export function parseSnippet(marked: string): SearchSnippet {
  let text = "";
  const ranges: SearchSnippet["ranges"] = [];
  let start: number | null = null;
  for (const char of marked) {
    if (char === OPEN) {
      start = text.length;
    } else if (char === CLOSE) {
      if (start !== null && text.length > start) {
        ranges.push({ start, end: text.length });
      }
      start = null;
    } else {
      text += char;
    }
  }
  return { text, ranges };
}

function decodeOffset(cursor: string | undefined): number | null {
  if (cursor === undefined) return 0;
  if (!/^\d{1,4}$/.test(cursor)) return null;
  const offset = Number(cursor);
  return offset <= MAX_OFFSET ? offset : null;
}

export class InvalidSearchCursor extends Error {}

/**
 * The meetings the viewer may read that match `q`, best first: one result
 * per meeting, from its best-matching field (a title match counts four
 * times a transcript one, notes and jottings twice), ties to the newest.
 * Visibility is meetingVisibleTo, the meeting list's own rule, and
 * jottings match only for their owner.
 */
export async function searchMeetings(
  viewer: Viewer,
  input: { q: string; limit: number; cursor?: string },
): Promise<SearchResponse> {
  const offset = decodeOffset(input.cursor);
  if (offset === null) throw new InvalidSearchCursor();
  const match = toMatchQuery(input.q);
  if (!match) return { results: [], nextCursor: null };

  const hits = await db.all<{
    meetingId: string;
    field: SearchField;
    rid: number;
  }>(sql`
    WITH hits AS (
      SELECT search_docs.meeting_id AS meeting_id,
        search_docs.field AS field,
        search_fts.rowid AS rid,
        bm25(search_fts) * CASE search_docs.field
          WHEN 'title' THEN 4.0
          WHEN 'notes' THEN 2.0
          WHEN 'jottings' THEN 2.0
          ELSE 1.0 END AS score,
        meetings.starts_at AS starts_at
      FROM search_fts
      JOIN search_docs ON search_docs.id = search_fts.rowid
      JOIN meetings ON meetings.id = search_docs.meeting_id
      WHERE search_fts MATCH ${match}
        AND ${meetingVisibleTo(viewer)}
        AND (search_docs.field <> 'jottings'
          OR meetings.owner_user_id = ${viewer.id})
    ),
    best AS (
      SELECT meeting_id, field, rid, score, starts_at,
        row_number() OVER (PARTITION BY meeting_id ORDER BY score, rid) AS n
      FROM hits
    )
    SELECT meeting_id AS meetingId, field, rid
    FROM best
    WHERE n = 1
    ORDER BY score, starts_at DESC, meeting_id
    LIMIT ${input.limit + 1} OFFSET ${offset}
  `);

  const more = hits.length > input.limit;
  const page = more ? hits.slice(0, input.limit) : hits;
  if (page.length === 0) return { results: [], nextCursor: null };

  const [rows, snippets] = await Promise.all([
    meetingRowsByIds(
      viewer,
      page.map((hit) => hit.meetingId),
    ),
    db.all<{ rid: number; marked: string }>(sql`
      SELECT rowid AS rid,
        snippet(search_fts, 0, char(2), char(3), '…', 16) AS marked
      FROM search_fts
      WHERE search_fts MATCH ${match}
        AND rowid IN (${sql.join(
          page.map((hit) => sql`${hit.rid}`),
          sql`, `,
        )})
    `),
  ]);
  const markedBy = new Map(snippets.map((row) => [row.rid, row.marked]));

  const results = page.flatMap((hit) => {
    const meeting = rows.get(hit.meetingId);
    if (!meeting) return [];
    return [
      {
        meeting,
        field: hit.field,
        snippet: parseSnippet(markedBy.get(hit.rid) ?? ""),
      },
    ];
  });
  const next = offset + input.limit;
  return {
    results,
    nextCursor: more && next <= MAX_OFFSET ? String(next) : null,
  };
}

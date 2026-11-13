/**
 * Who "me" and "them" are, from the meeting's calendar guests. One place, so
 * the notes prompt and the transcript's labels agree. Free of the Worker's
 * bindings so it can be tested.
 *
 * A transcript line is stored as `me` (the microphone) or `them` (the Mac's
 * audio, one stream for the whole far side). Names are worked out each time
 * the transcript is read, never stored: a meeting recorded before this, or
 * linked to an event later, gets them too.
 */
import type { Attendee, SpeakerLabels } from "@/api/contract";

/**
 * How a guest is called: their name, else their email; one line, no control
 * or invisible characters (bidi overrides, zero-width marks), at most 80
 * characters. Calendar guests are typed by whoever sent the invite, so this
 * is data: never instructions in a prompt, and only ever text on a page.
 */
function attendeeLabel(attendee: Attendee): string | null {
  const raw = attendee.name?.trim() || attendee.email?.trim() || "";
  const label = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return label || null;
}

const nameOnly = (attendee: Attendee): string | null =>
  attendeeLabel({ ...attendee, email: null });

export interface Speakers {
  /** The recorder's name, when the calendar has it (never their email). */
  me: string | null;
  /** The other guests' names (or emails), without blanks and duplicates. */
  others: string[];
  /**
   * How many other guests the event has, named or not. Only this says
   * whether "them" is one person: a guest with no name and no email is
   * still someone on the call.
   */
  otherCount: number;
}

export function speakersOf(
  attendees: Attendee[] | null = [],
  { emails = true }: { emails?: boolean } = {},
): Speakers {
  const guests = attendees ?? [];
  const self = guests.find((attendee) => attendee.self);
  const rest = guests.filter((attendee) => !attendee.self);
  const others = rest
    .map(emails ? attendeeLabel : nameOnly)
    .filter((label): label is string => label !== null);
  return {
    me: self ? nameOnly(self) : null,
    others: [...new Set(others)],
    otherCount: rest.length,
  };
}

/**
 * Who is reading the transcript: its owner, a teammate it is shared with, or
 * anyone holding a public link.
 */
type Reader = "owner" | "member" | "public";

/** How many guests the "With …" line names before it counts the rest. */
const MAX_LISTED = 3;

function withLine(names: string[], total: number): string | null {
  const listed = names.slice(0, MAX_LISTED);
  if (listed.length === 0) return null;
  const more = total - listed.length;
  if (more > 0) return `With ${listed.join(", ")} and ${more} more`;
  if (listed.length === 1) return `With ${listed[0]}`;
  return `With ${listed.slice(0, -1).join(", ")} and ${listed.at(-1)}`;
}

/**
 * The labels a reader sees on the transcript.
 *
 * - `me`: the owner reading their own meeting always reads "Me". Anyone
 *   else reads the recorder's calendar name, or "Note-taker" when the
 *   calendar has none, since "Me" would be the wrong person.
 * - `them`: with exactly one other guest, that guest. With several, "Others"
 *   (one audio stream: who is speaking can't be told, so nobody is guessed)
 *   and `guests` names them once. With no guests, "Them".
 *
 * Signed-in readers (owner, teammate) see a guest's email where the invite
 * has no name, as the guest list on the meeting page does. A public link
 * never shows an email: a guest without a name stays "Them", or is counted
 * in "and 2 more".
 */
export function speakerLabels(
  attendees: Attendee[] | null,
  reader: Reader,
): SpeakerLabels {
  const { me, others, otherCount } = speakersOf(attendees, {
    emails: reader !== "public",
  });
  return {
    me: reader === "owner" ? "Me" : (me ?? "Note-taker"),
    them:
      otherCount > 1
        ? "Others"
        : otherCount === 1 && others.length === 1
          ? others[0]!
          : "Them",
    guests: otherCount > 1 ? withLine(others, otherCount) : null,
  };
}

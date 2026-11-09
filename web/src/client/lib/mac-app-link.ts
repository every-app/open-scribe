/**
 * Links that open the Mac app (Every App for Mac, which answers
 * `everyapp://scribe/record`) to take notes: the Mac app records, the browser can't. An event the Mac app also sees in its
 * calendar starts at once; anything else asks first.
 */
export function takeNotesLink(event?: {
  id: string;
  title: string;
  start: string;
  join?: boolean;
}): string {
  if (!event) return "everyapp://scribe/record";
  const query = new URLSearchParams({
    event: event.id,
    title: event.title,
    start: event.start,
  });
  if (event.join) query.set("join", "1");
  return `everyapp://scribe/record?${query}`;
}

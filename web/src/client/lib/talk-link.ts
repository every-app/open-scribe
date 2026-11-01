/**
 * Links that open Talk for Mac (its `talk://` scheme) to take notes: the Mac
 * app records, the browser can't. An event the Mac app also sees in its
 * calendar starts at once; anything else asks first.
 */
export function takeNotesLink(event?: {
  id: string;
  title: string;
  start: string;
  join?: boolean;
}): string {
  if (!event) return "talk://record";
  const query = new URLSearchParams({
    event: event.id,
    title: event.title,
    start: event.start,
  });
  if (event.join) query.set("join", "1");
  return `talk://record?${query}`;
}

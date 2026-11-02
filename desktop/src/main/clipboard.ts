// What the window may put on the clipboard ("clipboard:writeText"): a link, nothing else. The
// sandboxed renderer's navigator.clipboard is refused, so main writes it. No Electron import
// (tested).

export const MAX_CLIPBOARD_LENGTH = 2048;

function parse(text: unknown): URL | null {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_CLIPBOARD_LENGTH) return null;
  if (text.trim() !== text || /[\s\u0000-\u001f]/.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** The argument check: a short, plain http(s) URL. Main checks the origin with `isCopyableUrl`. */
export function looksLikeLink(text: unknown): text is string {
  const url = parse(text);
  return !!url && (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
}

/** An https link, or one on the app's own origin (a local `everyapp dev` app is http). */
export function isCopyableUrl(text: unknown, appUrl?: string): text is string {
  if (!looksLikeLink(text)) return false;
  const url = new URL(text);
  if (url.protocol === "https:") return true;
  if (!appUrl) return false;
  try {
    return url.origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

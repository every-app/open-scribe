/**
 * The desktop app's private update feed: electron-builder's generic-provider
 * files under `mac/` in the updates bucket, served to signed-in members.
 * electron-updater reads `latest-mac.yml`, then downloads the zip, using the
 * blockmaps and Range requests for differential downloads.
 */

/** A release version: 1.2.3, or 1.2.3-beta.1 (dot-separated, no empty part). */
const VERSION = String.raw`\d{1,4}\.\d{1,4}\.\d{1,4}`;
/** "-arm64", "-mac", "-beta.1", …: letters and digits, dots only between them. */
const PART = String.raw`-[0-9A-Za-z]{1,32}(?:\.[0-9A-Za-z]{1,32})*`;

/**
 * The only names served: `latest-mac.yml`, and `Talk-<version>[-…].zip`,
 * `.dmg`, and their `.blockmap`s. `Talk-` is the old desktop app's release name;
 * Every App for Mac releases are `EveryApp-…` (TODO.md, "After the move"). No `/`, no `..`, nothing else.
 */
const RELEASE_FILE = new RegExp(
  String.raw`^Talk-${VERSION}(?:${PART}){0,4}\.(?:zip|dmg)(?:\.blockmap)?$`,
);

export function isUpdateFile(name: string): boolean {
  return (
    name.length <= 128 && (name === "latest-mac.yml" || RELEASE_FILE.test(name))
  );
}

function contentType(name: string): string {
  if (name.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (name.endsWith(".zip")) return "application/zip";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  return "application/octet-stream";
}

/**
 * The feed's manifest changes with every release, so clients always
 * revalidate it; a release file never changes once uploaded (its name holds
 * the version), so it caches for a year. Private: only members may read it.
 */
function cacheControl(name: string): string {
  return name === "latest-mac.yml"
    ? "private, no-cache"
    : "private, max-age=31536000, immutable";
}

function headersFor(name: string, object: R2Object): Headers {
  const headers = new Headers({
    "content-type": contentType(name),
    "cache-control": cacheControl(name),
    "accept-ranges": "bytes",
    etag: object.httpEtag,
  });
  if (object.uploaded) {
    headers.set("last-modified", object.uploaded.toUTCString());
  }
  return headers;
}

const notFound = () =>
  Response.json(
    { error: "not_found" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );

/** The byte range R2 returned, as [start, end] inclusive. */
function servedRange(range: R2Range, size: number): [number, number] {
  if ("suffix" in range && range.suffix !== undefined) {
    return [Math.max(0, size - range.suffix), size - 1];
  }
  const offset = "offset" in range ? (range.offset ?? 0) : 0;
  const length =
    "length" in range && range.length !== undefined
      ? range.length
      : size - offset;
  return [offset, Math.min(size, offset + length) - 1];
}

/**
 * Answer GET (or HEAD) for `mac/<name>`: 404 for a name off the allowlist or
 * a missing file, 206 with Content-Range for a Range request (R2 reads the
 * header itself), 416 for a range past the end.
 */
export async function serveUpdateFile(
  bucket: R2Bucket,
  name: string,
  request: Request,
): Promise<Response> {
  if (!isUpdateFile(name)) return notFound();
  const key = `mac/${name}`;

  if (request.method === "HEAD") {
    const object = await bucket.head(key);
    if (!object) return notFound();
    const headers = headersFor(name, object);
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }

  const wantsRange = request.headers.has("range");
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(
      key,
      wantsRange ? { range: request.headers } : undefined,
    );
  } catch (error) {
    // R2 refuses a range it can't satisfy (or can't parse).
    if (!wantsRange) throw error;
    const head = await bucket.head(key);
    if (!head) return notFound();
    return new Response(null, {
      status: 416,
      headers: {
        "content-range": `bytes */${head.size}`,
        "cache-control": "no-store",
      },
    });
  }
  if (!object) return notFound();

  const headers = headersFor(name, object);
  if (wantsRange && object.range) {
    const [start, end] = servedRange(object.range, object.size);
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}

import { describe, expect, it, vi } from "vitest";

// A small stand-in for the updates bucket: R2's get() reads the Range
// header itself (bytes=a-b, a-, -n) and throws on one it can't satisfy.
const files = vi.hoisted(() => new Map<string, Uint8Array>());
const bucket = vi.hoisted(() => {
  const meta = (key: string, data: Uint8Array) => ({
    key,
    size: data.byteLength,
    httpEtag: `"etag-${key}"`,
    uploaded: new Date("2026-11-01T00:00:00Z"),
  });
  return {
    gets: [] as { key: string; range: unknown }[],
    async head(key: string) {
      const data = files.get(key);
      return data ? meta(key, data) : null;
    },
    async get(key: string, options?: { range?: Headers }) {
      bucket.gets.push({ key, range: options?.range });
      const data = files.get(key);
      if (!data) return null;
      const header = options?.range?.get("range");
      let range:
        | { offset: number; length: number }
        | { suffix: number }
        | undefined;
      let slice = data;
      if (header) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (!match || (!match[1] && !match[2])) throw new Error("bad range");
        if (!match[1]) {
          const suffix = Number(match[2]);
          range = { suffix };
          slice = data.slice(Math.max(0, data.byteLength - suffix));
        } else {
          const start = Number(match[1]);
          if (start >= data.byteLength)
            throw new Error("range not satisfiable");
          const end = match[2]
            ? Math.min(Number(match[2]), data.byteLength - 1)
            : data.byteLength - 1;
          range = { offset: start, length: end - start + 1 };
          slice = data.slice(start, end + 1);
        }
      }
      return {
        ...meta(key, data),
        range,
        body: new Blob([slice as Uint8Array<ArrayBuffer>]).stream(),
      };
    },
  };
});

vi.mock("cloudflare:workers", () => ({ env: { updates: bucket } }));
vi.mock("@every-app/sdk/server", () => ({
  getEveryAppUser: async (request: Request) =>
    request.headers.get("x-test-user")
      ? { id: "alice", orgId: "acme", email: "alice@acme.test" }
      : null,
}));

const { isUpdateFile } = await import("./updates");
const route = (await import("@/routes/api/v1/updates.mac.$file")).Route as {
  options: {
    server: {
      handlers: Record<
        string,
        (ctx: {
          request: Request;
          params: Record<string, string>;
        }) => Promise<Response>
      >;
    };
  };
};

function fetchFile(
  file: string,
  init: { signedIn?: boolean; range?: string; method?: "GET" | "HEAD" } = {},
) {
  const headers = new Headers();
  if (init.signedIn !== false) headers.set("x-test-user", "alice");
  if (init.range) headers.set("range", init.range);
  const method = init.method ?? "GET";
  const request = new Request(`https://talk.test/api/v1/updates/mac/${file}`, {
    method,
    headers,
  });
  return route.options.server.handlers[method]!({ request, params: { file } });
}

const yml = new TextEncoder().encode(
  "version: 1.2.3\npath: Talk-1.2.3-arm64-mac.zip\n",
);
const zip = new TextEncoder().encode("0123456789abcdefghij");
files.set("mac/latest-mac.yml", yml);
files.set("mac/Talk-1.2.3-arm64-mac.zip", zip);

describe("the update file allowlist", () => {
  it("takes the feed's files", () => {
    for (const name of [
      "latest-mac.yml",
      "Talk-1.2.3-arm64-mac.zip",
      "Talk-1.2.3-arm64-mac.zip.blockmap",
      "Talk-1.2.3-arm64.dmg",
      "Talk-1.2.3.dmg.blockmap",
      "Talk-10.0.12-mac.zip",
      "Talk-1.2.3-beta.1-universal-mac.zip",
    ]) {
      expect(isUpdateFile(name), name).toBe(true);
    }
  });

  it("refuses traversal and anything else", () => {
    for (const name of [
      "",
      "../latest-mac.yml",
      "..%2Flatest-mac.yml",
      "mac/latest-mac.yml",
      "latest.yml",
      "latest-mac.yml.bak",
      "Talk-1.2.3..zip",
      "Talk-1.2.3-../x.zip",
      "Talk-1.2.3-arm64/../../db.zip",
      "Talk-1.2.zip",
      "Talk-1.2.3-arm64.exe",
      "Talk-1.2.3-arm64.zip.sig",
      "Talk Dev-1.2.3.dmg",
      "talk-1.2.3.dmg",
      "Talk-1.2.3-a..b.zip",
      "Talk-1.2.3-arm64-mac.zip\n",
      `Talk-1.2.3${"-x".repeat(10)}.zip`,
    ]) {
      expect(isUpdateFile(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe("GET /api/v1/updates/mac/:file", () => {
  it("refuses a request without a member", async () => {
    const res = await fetchFile("latest-mac.yml", { signedIn: false });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("serves latest-mac.yml, revalidated every time", async () => {
    const res = await fetchFile("latest-mac.yml");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("content-type")).toBe("text/yaml; charset=utf-8");
    expect(res.headers.get("etag")).toBe('"etag-mac/latest-mac.yml"');
    expect(await res.text()).toBe(new TextDecoder().decode(yml));
  });

  it("serves a release whole, cached as immutable", async () => {
    const res = await fetchFile("Talk-1.2.3-arm64-mac.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("20");
    expect(await res.text()).toBe("0123456789abcdefghij");
  });

  it("passes a Range through to R2 and answers 206", async () => {
    bucket.gets.length = 0;
    const res = await fetchFile("Talk-1.2.3-arm64-mac.zip", {
      range: "bytes=5-9",
    });
    expect(bucket.gets[0]!.range).toBeInstanceOf(Headers);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("56789");

    const open = await fetchFile("Talk-1.2.3-arm64-mac.zip", {
      range: "bytes=15-",
    });
    expect(open.headers.get("content-range")).toBe("bytes 15-19/20");
    expect(await open.text()).toBe("fghij");

    const suffix = await fetchFile("Talk-1.2.3-arm64-mac.zip", {
      range: "bytes=-3",
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 17-19/20");
    expect(await suffix.text()).toBe("hij");
  });

  it("answers 416 for a range past the end", async () => {
    const res = await fetchFile("Talk-1.2.3-arm64-mac.zip", {
      range: "bytes=50-60",
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */20");
  });

  it("answers HEAD with the size and no body", async () => {
    const res = await fetchFile("Talk-1.2.3-arm64-mac.zip", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("20");
    expect(res.body).toBeNull();
  });

  it("is 404 for a missing file and for a name off the allowlist, without asking R2", async () => {
    expect((await fetchFile("Talk-9.9.9-arm64-mac.zip")).status).toBe(404);
    bucket.gets.length = 0;
    for (const name of ["../latest-mac.yml", "secrets.env", "mac%2F..%2Fx"]) {
      const res = await fetchFile(name);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(bucket.gets).toEqual([]);
  });
});

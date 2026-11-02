import { describe, expect, it } from "vitest";
import { isCopyableUrl, looksLikeLink, MAX_CLIPBOARD_LENGTH } from "../src/main/clipboard";
import { validArgs } from "../src/main/ipcValidation";

describe("clipboard:writeText (Codex V2: Copy link failed in the sandboxed window)", () => {
  it("lets a public link through the argument check", () => {
    expect(validArgs("clipboard:writeText", ["https://talk.every.app/s/q8Zr2kTw4pXn"])).toBe(true);
    expect(validArgs("clipboard:writeText", ["http://talk.localhost:8787/s/abc"])).toBe(true);
  });

  it("refuses anything that isn't one short plain link", () => {
    for (const args of [
      [],
      ["https://a.example", "extra"],
      [42],
      [""],
      ["not a url"],
      ["javascript:alert(1)"],
      ["file:///etc/passwd"],
      ["https://user:pw@talk.every.app/s/x"],
      [" https://talk.every.app/s/x"],
      ["https://talk.every.app/s/x\nrm -rf"],
      [`https://talk.every.app/${"a".repeat(MAX_CLIPBOARD_LENGTH)}`],
    ]) {
      expect(validArgs("clipboard:writeText", args), JSON.stringify(args).slice(0, 60)).toBe(false);
    }
  });

  it("copies https anywhere, but http only on the app's own origin", () => {
    expect(isCopyableUrl("https://talk.every.app/s/x")).toBe(true);
    expect(isCopyableUrl("http://talk.localhost:8787/s/x", "http://talk.localhost:8787")).toBe(true);
    expect(isCopyableUrl("http://talk.localhost:8787/s/x", "http://talk.localhost:9999")).toBe(false);
    expect(isCopyableUrl("http://evil.example/s/x", "http://talk.localhost:8787")).toBe(false);
    expect(isCopyableUrl("http://talk.localhost:8787/s/x")).toBe(false);
    expect(looksLikeLink("ftp://talk.every.app/x")).toBe(false);
  });
});

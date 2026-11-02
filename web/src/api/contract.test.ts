import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  listMeetingsQuery,
  patchMeetingInput,
  saveJottingsInput,
} from "./contract";

describe("the API contract", () => {
  it("imports nothing but zod, so the desktop app can use it as is", () => {
    const source = readFileSync(
      new URL("./contract.ts", import.meta.url),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["zod"]);
  });

  it("reads the list query from strings", () => {
    expect(listMeetingsQuery.parse({ shared: "1", mine: "false" })).toEqual({
      shared: true,
      mine: false,
      limit: 50,
    });
    expect(listMeetingsQuery.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(patchMeetingInput.safeParse({ owner: "x" }).success).toBe(false);
    expect(saveJottingsInput.safeParse({ markdown: "", at: 1 }).success).toBe(
      false,
    );
  });
});

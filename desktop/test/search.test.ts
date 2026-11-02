import { describe, expect, it } from "vitest";
import { parseTab, searchable, tabFor } from "../src/renderer/src/search";

describe("search", () => {
  it("only sends a query with a letter or digit in it", () => {
    expect(searchable("pricing")).toBe(true);
    expect(searchable("SOC2")).toBe(true);
    expect(searchable("café")).toBe(true);
    expect(searchable("会議")).toBe(true);
    expect(searchable("?!—")).toBe(false);
    expect(searchable("   ")).toBe(false);
  });

  it("opens a result on the tab where it matched", () => {
    expect(tabFor("transcript")).toBe("transcript");
    expect(tabFor("jottings")).toBe("jottings");
    expect(tabFor("notes")).toBeUndefined();
    expect(tabFor("title")).toBeUndefined();
    expect(parseTab("transcript")).toBe("transcript");
    expect(parseTab("admin")).toBeUndefined();
    expect(parseTab(undefined)).toBeUndefined();
  });
});

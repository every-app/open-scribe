import { describe, expect, it } from "vitest";
import { takeNotesLink } from "./mac-app-link";

describe("takeNotesLink", () => {
  it("opens Every App for Mac's Scribe recorder", () => {
    expect(takeNotesLink()).toBe("everyapp://scribe/record");
  });

  it("carries the event, and join only when asked", () => {
    const url = new URL(
      takeNotesLink({
        id: "ev 1",
        title: "Q&A sync",
        start: "2026-11-09T15:00:00Z",
        join: true,
      }),
    );
    expect(url.protocol).toBe("everyapp:");
    expect(`${url.host}${url.pathname}`).toBe("scribe/record");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      event: "ev 1",
      title: "Q&A sync",
      start: "2026-11-09T15:00:00Z",
      join: "1",
    });
    expect(
      new URL(
        takeNotesLink({ id: "e", title: "t", start: "s" }),
      ).searchParams.has("join"),
    ).toBe(false);
  });
});

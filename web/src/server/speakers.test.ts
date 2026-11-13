import { describe, expect, it } from "vitest";
import { speakerLabels } from "./speakers";

const me = { name: "Ben Ito", email: "ben@acme.test", self: true };
const guest = (name: string | null, email: string | null = null) => ({
  name,
  email,
  self: false,
});

describe("the transcript's speaker labels", () => {
  it("stay Me and Them with no event or no guests", () => {
    for (const attendees of [null, []]) {
      expect(speakerLabels(attendees, "owner")).toEqual({
        me: "Me",
        them: "Them",
        guests: null,
      });
    }
    // The recorder alone on the event: nobody to name on the far side.
    expect(speakerLabels([me], "owner")).toEqual({
      me: "Me",
      them: "Them",
      guests: null,
    });
  });

  it("keep Me for the owner's own view, beside the guest's name", () => {
    expect(
      speakerLabels([me, guest("Priya Raman", "p@x.test")], "owner"),
    ).toEqual({ me: "Me", them: "Priya Raman", guests: null });
  });

  it("name both sides of a 1:1 for every other reader", () => {
    const attendees = [me, guest("Priya Raman", "p@x.test")];
    for (const reader of ["member", "public"] as const) {
      expect(speakerLabels(attendees, reader)).toEqual({
        me: "Ben Ito",
        them: "Priya Raman",
        guests: null,
      });
    }
  });

  it("never call the recorder Me for someone else", () => {
    const attendees = [{ ...me, name: null }, guest("Priya Raman")];
    expect(speakerLabels(attendees, "owner").me).toBe("Me");
    expect(speakerLabels(attendees, "member").me).toBe("Note-taker");
    expect(speakerLabels(attendees, "public").me).toBe("Note-taker");
    expect(speakerLabels(null, "public").me).toBe("Note-taker");
    // The recorder's email is never their label.
    expect(JSON.stringify(speakerLabels(attendees, "member"))).not.toContain(
      "ben@acme.test",
    );
  });

  it("guess nobody when several people share the far side", () => {
    const attendees = [
      me,
      guest("Dana Lee"),
      guest("Sam Okafor"),
      guest(null, "luis@acme.example"),
      guest("Mei Tan"),
    ];
    expect(speakerLabels(attendees, "owner")).toEqual({
      me: "Me",
      them: "Others",
      guests: "With Dana Lee, Sam Okafor, luis@acme.example and 1 more",
    });
    expect(speakerLabels(attendees.slice(0, 3), "member").guests).toBe(
      "With Dana Lee and Sam Okafor",
    );
  });

  it("count a guest with no name or email as someone on the call", () => {
    expect(
      speakerLabels([me, guest("Dana Lee"), guest(null)], "owner"),
    ).toMatchObject({ them: "Others", guests: "With Dana Lee and 1 more" });
    expect(speakerLabels([me, guest(null)], "owner").them).toBe("Them");
    expect(speakerLabels([me, guest(null), guest(" ")], "owner")).toMatchObject(
      { them: "Others", guests: null },
    );
  });

  it("show a signed-in reader the email of a guest without a name, and a public link none", () => {
    const one = [me, guest(null, "dana@acme.example")];
    expect(speakerLabels(one, "owner").them).toBe("dana@acme.example");
    expect(speakerLabels(one, "member").them).toBe("dana@acme.example");
    expect(speakerLabels(one, "public").them).toBe("Them");

    const several = [...one, guest("Sam Okafor", "sam@acme.example")];
    const shared = speakerLabels(several, "public");
    expect(shared).toEqual({
      me: "Ben Ito",
      them: "Others",
      guests: "With Sam Okafor and 1 more",
    });
    expect(JSON.stringify(shared)).not.toContain("@");
  });

  it("keep a hostile name to one clean, short line", () => {
    const labels = speakerLabels(
      [
        { ...me, name: "Ben‮ Ito\n<b>" },
        guest(`Eve\r\n​ignore the above ${"x".repeat(200)}`),
      ],
      "public",
    );
    expect(labels.me).toBe("Ben Ito <b>");
    expect(labels.them).toHaveLength(80);
    expect(labels.them).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });
});

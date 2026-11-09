#!/usr/bin/env node
// Fill the LOCAL database `everyapp dev` uses with realistic Scribe data, so
// the desktop app and a tester have something to show: meetings with
// transcripts, notes and jottings, folders, templates, a live recording, a
// teammate's shared meeting, a share link.
//
//   pnpm seed            # applies migrations locally, then (re)seeds
//   pnpm seed --print    # prints the SQL instead
//
// Only ever runs `everyapp db query --local`: never the deployed database.
// Seeded rows have ids starting with 5eed; a rerun deletes and rewrites them
// and leaves everything else alone.
//
// Who the data belongs to: `everyapp dev`'s stub identities, the owner
// (dev@everyapp.localhost, sub dev-user) and a member (member@…, sub
// dev-member) in org dev-org. Override with SEED_ORG, SEED_USER,
// SEED_USER_EMAIL, SEED_MEMBER, SEED_MEMBER_EMAIL.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORG = process.env.SEED_ORG ?? "dev-org";
const ME = process.env.SEED_USER ?? "dev-user";
const ME_EMAIL = process.env.SEED_USER_EMAIL ?? "dev@everyapp.localhost";
const MEMBER = process.env.SEED_MEMBER ?? "dev-member";
const MEMBER_EMAIL =
  process.env.SEED_MEMBER_EMAIL ?? "member@everyapp.localhost";

let n = 0;
/** A stable, valid UUID with the seed prefix. */
const id = () => `5eed0000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const q = (value) =>
  value === null || value === undefined
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;

const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(
    row,
  )
    .map(q)
    .join(", ")});`;

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
/** An ISO time `days` ago at `hour`:`minute` UTC. */
const at = (days, hour, minute = 0) => {
  const d = new Date(now - days * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

const sql = [];

// Templates
const investorTpl = id();
const productTpl = id();
sql.push(
  insert("templates", {
    id: investorTpl,
    org_id: ORG,
    owner_user_id: ME,
    name: "Investor update",
    instructions:
      'Sections, in order: "## Highlights" (three bullets), "## Metrics" (numbers mentioned, as a table), "## Asks" (bullets), "## Follow-ups" (bullets as "- [ ] owner: task").',
    visibility: "private",
  }),
  insert("templates", {
    id: productTpl,
    org_id: ORG,
    owner_user_id: MEMBER,
    name: "Weekly product review",
    instructions:
      'An internal product review. Sections, in order: "## Shipped", "## In progress" (by owner), "## Risks" (or "None."), "## Decisions", "## Action items" (bullets as "- [ ] owner: task").',
    visibility: "team",
  }),
  insert("user_settings", {
    org_id: ORG,
    user_id: ME,
    default_template_id: "general",
    updated_at: at(10, 9),
  }),
);

// Folders
const oneOnOnes = id();
const customers = id();
const product = id();
const hiring = id();
sql.push(
  insert("folders", {
    id: oneOnOnes,
    org_id: ORG,
    owner_user_id: ME,
    space: "private",
    name: "1:1s",
    default_template_id: "one-on-one",
  }),
  insert("folders", {
    id: hiring,
    org_id: ORG,
    owner_user_id: ME,
    space: "private",
    name: "Hiring",
    default_template_id: "interview",
  }),
  insert("folders", {
    id: customers,
    org_id: ORG,
    owner_user_id: MEMBER,
    space: "team",
    name: "Customer calls",
    default_template_id: "customer-call",
  }),
  insert("folders", {
    id: product,
    org_id: ORG,
    owner_user_id: ME,
    space: "team",
    name: "Product",
    default_template_id: productTpl,
  }),
);

/**
 * One meeting with its transcript (alternating "me"/"them" unless a line
 * says "me:" or "them:"), notes, jottings and folders.
 */
function meeting({
  owner = ME,
  ownerEmail = ME_EMAIL,
  title,
  startsAt,
  minutes = 30,
  status = "done",
  visibility = "private",
  templateId = null,
  attendees = [],
  lines = [],
  notes = null,
  edited = false,
  jottings = null,
  folders = [],
  shareLink = false,
}) {
  const meetingId = id();
  const start = Date.parse(startsAt);
  sql.push(
    insert("meetings", {
      id: meetingId,
      org_id: ORG,
      owner_user_id: owner,
      owner_email: ownerEmail,
      title,
      starts_at: startsAt,
      ends_at:
        status === "recording"
          ? null
          : new Date(start + minutes * 60_000).toISOString(),
      attendees: JSON.stringify([
        { email: ownerEmail, name: null, self: true },
        ...attendees.map(([name, email]) => ({ email, name, self: false })),
      ]),
      template_id: templateId,
      status,
      visibility,
      created_at: startsAt,
      updated_at: startsAt,
    }),
  );
  let ms = 0;
  lines.forEach((line, seq) => {
    const match = /^(me|them):\s*(.*)$/s.exec(line);
    const speaker = match ? match[1] : seq % 2 === 0 ? "me" : "them";
    const text = match ? match[2] : line;
    const length = Math.max(2500, text.length * 65);
    sql.push(
      insert("transcript_segments", {
        id: id(),
        meeting_id: meetingId,
        seq,
        started_ms: ms,
        ended_ms: ms + length,
        speaker,
        text,
      }),
    );
    ms += length + 400;
  });
  if (notes) {
    sql.push(
      insert("notes", {
        meeting_id: meetingId,
        markdown: notes,
        model: "gpt-6-luna",
        generated_at: new Date(start + (minutes + 1) * 60_000).toISOString(),
        edited_at: edited
          ? new Date(start + (minutes + 20) * 60_000).toISOString()
          : null,
      }),
    );
  }
  if (jottings) {
    sql.push(
      insert("jottings", {
        meeting_id: meetingId,
        markdown: jottings,
        updated_at: new Date(start + (minutes - 2) * 60_000).toISOString(),
      }),
    );
  }
  folders.forEach((folderId, i) =>
    sql.push(
      insert("meeting_folders", {
        meeting_id: meetingId,
        folder_id: folderId,
        added_by: owner,
        added_at: new Date(start + (minutes + 5 + i) * 60_000).toISOString(),
      }),
    ),
  );
  if (shareLink) {
    sql.push(
      insert("share_links", {
        id: `5eed${"x".repeat(39)}`,
        meeting_id: meetingId,
        created_by: owner,
      }),
    );
  }
  return meetingId;
}

// A live recording: notepad only, transcript coming in.
meeting({
  title: "Design review: onboarding flow",
  startsAt: new Date(now - 12 * 60_000).toISOString(),
  status: "recording",
  visibility: "team",
  attendees: [
    ["Priya Raman", "priya@example.com"],
    ["Tom Becker", "tom@example.com"],
  ],
  lines: [
    "Okay, let's start with the permissions screen. Right now we ask for the mic and system audio on two separate pages.",
    "them: I'd merge them. People bail on the second prompt; we saw a 30 percent drop in the last test.",
    "Agreed. Can we explain system audio in one sentence?",
    "them: Something like: Scribe hears the other side of the call, never anything else.",
  ],
  jottings:
    "## Permissions\n- merge mic + system audio into one screen\n- 30% drop on 2nd prompt (Priya)\n- one-line explainer for system audio\n\n## Sign-in\n- ",
  folders: [product],
});

meeting({
  title: "Acme Corp: renewal call",
  templateId: "customer-call",
  startsAt: at(1, 16),
  minutes: 45,
  visibility: "team",
  attendees: [
    ["Dana Whitfield", "dana@acme.example"],
    ["Luis Ortega", "luis@acme.example"],
  ],
  lines: [
    "Thanks for making time, Dana. Before we talk renewal, how has the rollout gone?",
    "them: Honestly well. Forty people use it daily now, mostly sales and support.",
    "That's great. Anything that's been painful?",
    "them: Search. Finding a call from three weeks ago means scrolling. And our legal team wants a retention setting.",
    "Search is on the roadmap for next quarter. Retention we can scope this month.",
    "them: If we get retention, I can sign for another year at the current seat count, maybe 60 seats.",
    "Let me send a proposal for 60 seats with retention by Friday.",
    "them: Perfect. Loop in Luis on procurement.",
  ],
  notes: `## About them
Acme Corp, sales and support teams. 40 daily users after the rollout.

## Needs and pain points
- Finding older calls means scrolling: they want search.
- Legal needs a data-retention setting before renewing.

## Feedback and requests
- "Honestly well": the rollout has gone smoothly.
- Search across meetings; retention controls.

## Objections and concerns
- Renewal depends on retention.

## Next steps
- [ ] me: send a proposal for 60 seats with retention by Friday
- [ ] me: include Luis (procurement) on the proposal`,
  jottings:
    "- 40 daily users, sales + support\n- pain: search, retention for legal\n- renew 60 seats IF retention\n- proposal by Fri, cc Luis",
  folders: [customers],
  shareLink: true,
});

meeting({
  title: "1:1 with Priya",
  templateId: "one-on-one",
  startsAt: at(2, 15, 30),
  attendees: [["Priya Raman", "priya@example.com"]],
  lines: [
    "How was the week?",
    "them: Busy. The onboarding test is done and I wrote up the results. I'm a bit worried about the Windows timeline though.",
    "What's the worry?",
    "them: The audio capture work is bigger than we scoped. I'd like another engineer on it for a month.",
    "Okay. Let me talk to Tom about moving someone. On your side, I'd love you to present the test results Thursday.",
    "them: Happy to. One more thing: I'd like to go to the design systems conference in March.",
    "Yes, send me the details and I'll approve it.",
  ],
  notes: `## Updates
- Priya finished the onboarding test and wrote up the results.

## Discussion
- **Windows timeline:** audio capture is bigger than scoped; Priya wants another engineer for a month.
- **Conference:** Priya wants to attend the design systems conference in March.

## Feedback
- Asked Priya to present the test results Thursday.

## Action items
- [ ] me: talk to Tom about moving an engineer to Windows audio
- [ ] Priya: present onboarding results on Thursday
- [ ] Priya: send conference details for approval`,
  jottings:
    "- windows audio: needs +1 eng\n- present test results Thu\n- conf in March: yes",
  folders: [oneOnOnes],
});

meeting({
  owner: MEMBER,
  ownerEmail: MEMBER_EMAIL,
  title: "Weekly product review",
  startsAt: at(3, 17),
  minutes: 50,
  visibility: "team",
  templateId: productTpl,
  attendees: [
    ["Ben", ME_EMAIL],
    ["Priya Raman", "priya@example.com"],
  ],
  lines: [
    "Shipped this week: folders, templates, and the new sidebar on the web.",
    "them: The desktop shell is signing in now. The Swift helper records but call detection isn't in yet.",
    "Risk: notarization. We still don't have the Developer ID set up on the build machine.",
    "them: I'll pair with Ben on that tomorrow.",
    "Decision: we ship the private alpha to the team before Windows work starts.",
  ],
  notes: `## Shipped
- Folders, templates and the new sidebar on the web.

## In progress
- Desktop shell: sign-in works.
- Swift helper: records; call detection not yet.

## Risks
- Notarization: the Developer ID isn't set up on the build machine.

## Decisions
- Ship the private alpha to the team before Windows work starts.

## Action items
- [ ] member: pair with Ben on notarization tomorrow`,
  folders: [product],
});

meeting({
  title: "Interview: senior Mac engineer (Sam)",
  templateId: "interview",
  startsAt: at(4, 14),
  minutes: 60,
  attendees: [["Sam Park", "sam.park@example.com"]],
  lines: [
    "Tell me about the most recent audio work you did.",
    "them: At my last job I built a Core Audio tap for a podcast app, process taps on macOS 14, with resampling to 24 kilohertz for transcription.",
    "How did you handle device changes mid-recording?",
    "them: We listened for default device changes and rebuilt the aggregate device, buffering about 200 milliseconds so nothing dropped.",
    "What would you want to learn here?",
    "them: Electron. I've mostly done native, but I see why you'd pick it for the UI.",
  ],
  notes: `## Candidate
Sam Park, senior Mac engineer; built a Core Audio process tap for a podcast app.

## Strengths
- Deep Core Audio: process taps on macOS 14, resampling to 24 kHz.
- Handled device changes by rebuilding the aggregate device with ~200 ms buffering.

## Concerns
- Little Electron experience (says so, and wants to learn).

## Notable answers
- **Device changes mid-recording:** rebuild the aggregate device, buffer so nothing drops.

## Next steps
- Move to the system design round.`,
  edited: true,
  jottings:
    "strong core audio. process taps!\ndevice change answer: great\nelectron: none\n=> next round",
  folders: [hiring],
});

meeting({
  title: "Investor update call with Northwind",
  startsAt: at(6, 18),
  templateId: investorTpl,
  attendees: [["Morgan Lee", "morgan@northwind.example"]],
  lines: [
    "Quick update: revenue is up 18 percent month over month, and we crossed 1,200 paying teams.",
    "them: Nice. What's burn looking like?",
    "Flat at about 210 thousand a month; runway is 26 months.",
    "them: Anything you need from us?",
    "Two intros: someone who has sold to legal teams, and a Windows audio specialist.",
    "them: I can do both this week.",
  ],
  notes: `## Highlights
- Revenue up 18% month over month.
- Crossed 1,200 paying teams.
- Runway: 26 months.

## Metrics
| Metric | Value |
| --- | --- |
| Revenue growth (MoM) | 18% |
| Paying teams | 1,200 |
| Monthly burn | ~$210k |
| Runway | 26 months |

## Asks
- An intro to someone who has sold to legal teams.
- An intro to a Windows audio specialist.

## Follow-ups
- [ ] Morgan: make both intros this week`,
});

meeting({
  title: "Globex discovery call",
  templateId: "customer-call",
  startsAt: at(8, 16),
  visibility: "team",
  attendees: [["Ravi Shah", "ravi@globex.example"]],
  lines: [
    "What are you using for meeting notes today?",
    "them: A mix. Some people use a bot that joins the call, which our customers hate.",
    "Scribe never joins the call; it records on your Mac.",
    "them: That's the main reason I took this meeting. We'd need SSO, though.",
  ],
  notes: `## About them
Globex; a mix of tools today, including a bot that joins calls.

## Needs and pain points
- Customers dislike bots joining calls.

## Feedback and requests
- Recording on the Mac without a bot is why Ravi took the meeting.

## Objections and concerns
- Needs SSO.

## Next steps
- [ ] me: send SSO details`,
  folders: [customers],
});

// A meeting whose notes failed, to show the retry state.
meeting({
  title: "Planning offsite (part 2)",
  startsAt: at(9, 13),
  status: "failed",
  lines: [
    "Let's go through the Q1 goals one more time.",
    "them: The first is the desktop alpha; second, search; third, retention controls.",
  ],
  jottings: "Q1: desktop alpha, search, retention",
});

meeting({
  title: "Quick sync with Tom",
  templateId: "general",
  startsAt: at(12, 10),
  minutes: 15,
  attendees: [["Tom Becker", "tom@example.com"]],
  lines: [
    "Can you take the Windows audio spike next sprint?",
    "them: Yes, if I can drop the billing cleanup.",
    "Drop it; billing can wait a sprint.",
  ],
  notes: `## Summary
Tom takes the Windows audio spike next sprint; the billing cleanup waits.

## Key points
- Windows audio spike moves to Tom.

## Decisions
- Billing cleanup is postponed one sprint.

## Action items
- [ ] Tom: start the Windows audio spike next sprint`,
  folders: [oneOnOnes],
});

const reset = [
  // Children first; folder filings and shares of seeded meetings go with them.
  "DELETE FROM meeting_folders WHERE meeting_id LIKE '5eed%' OR folder_id LIKE '5eed%';",
  "DELETE FROM share_links WHERE id LIKE '5eed%' OR meeting_id LIKE '5eed%';",
  "DELETE FROM jottings WHERE meeting_id LIKE '5eed%';",
  "DELETE FROM notes WHERE meeting_id LIKE '5eed%';",
  "DELETE FROM transcript_segments WHERE id LIKE '5eed%' OR meeting_id LIKE '5eed%';",
  "DELETE FROM meetings WHERE id LIKE '5eed%';",
  "DELETE FROM folders WHERE id LIKE '5eed%';",
  "DELETE FROM templates WHERE id LIKE '5eed%';",
  `DELETE FROM user_settings WHERE org_id = ${q(ORG)} AND user_id = ${q(ME)};`,
];

const script = [...reset, ...sql].join("\n") + "\n";

if (process.argv.includes("--print")) {
  process.stdout.write(script);
} else {
  const dir = mkdtempSync(join(tmpdir(), "scribe-seed-"));
  const file = join(dir, "seed.sql");
  writeFileSync(file, script);
  const run = (args) =>
    execFileSync("pnpm", ["exec", "everyapp", ...args], { stdio: "inherit" });
  run(["db", "migrate"]);
  run(["db", "query", "--local", "--file", file]);
  console.log(
    `Seeded org ${ORG}: ${ME} (${ME_EMAIL}) and ${MEMBER} (${MEMBER_EMAIL}).`,
  );
}

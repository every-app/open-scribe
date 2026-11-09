import { defineEveryApp } from "@every-app/sdk";

// defineEveryApp types the manifest; the Worker reads it back as
// env.EVERYAPP_MANIFEST.
export default defineEveryApp({
  // Still "talk", the app's old name: changing the id would make new D1/R2
  // resources and a new URL. It becomes "scribe" once the Every App gateway
  // can rename an app in place.
  id: "talk",
  name: "Scribe",
  description:
    "AI meeting notes: records meetings from your Mac, transcribes them live and writes the notes.",
  // Every member of the workspace can open it; notes are private by default.
  access: "everyone",
  resources: {
    d1: ["DB"],
    // The desktop app's private update feed: electron-builder's
    // latest-mac.yml, zips, dmgs and blockmaps under mac/, served to members
    // by /api/v1/updates/mac/:file (src/server/updates.ts). Lowercase on
    // purpose: in everyapp 0.3.0-rc.14 a production build names the bucket
    // "every-hosted--sentinel--<binding>" until deploy rewrites it, and
    // Cloudflare refuses capitals in a bucket name. The real bucket is
    // every-talk--updates either way.
    r2: ["updates"],
  },
  // A shared meeting page: anyone with the unguessable link reads it. The
  // route checks the token itself (src/server/meetings.ts, getSharedMeeting).
  //
  // The desktop app's API is a bearer route: Cloudflare Access lets it
  // through, the Gateway demands the desktop app's token on every method and
  // refuses a session cookie there (the web UI uses server functions, which
  // stay outside), and it is never served anonymously.
  public: [{ path: "/s/:token" }, { path: "/api/v1/**", bearer: true }],
  // The built CSS and JavaScript (and icons) that page loads; without them an outsider
  // gets it unstyled and it never hydrates. Only static files: the Gateway
  // forwards these with no identity and the Worker answers nothing else.
  publicAssets: ["/assets/**", "/favicon.ico", "/apple-touch-icon.png"],
  providers: [
    {
      id: "openai",
      why: "Transcribes meetings live (Realtime) and writes the notes.",
    },
  ],
  ai: {
    // The one chat model the notes are written with (the Gateway's OpenAI
    // seed); src/server/notes.ts reads it back from env.EVERYAPP_MANIFEST.
    // First the notes model, then the model of the chunked-transcription
    // fallback (/v1/audio/transcriptions, an inference route).
    models: ["gpt-6-luna", "gpt-4o-mini-transcribe"],
    // Minting a Realtime client secret for the Mac app is not an inference
    // route: the operator also allows it with
    //   echo "/v1/realtime/client_secrets" | everyapp secret set AI_PROXY_EXTRA_ROUTES
    routes: ["/v1/realtime/client_secrets"],
  },
  capabilities: {
    members: { access: "read", why: "Shows who can see team notes." },
    "google-workspace": {
      scopes: ["calendar.readonly"],
      why: "Reads your calendar so the Mac app can remind you before a meeting starts.",
    },
  },
  // A capability at the top level is required (the app stays closed until
  // it's set up); in an optional feature it isn't. Scribe opens without
  // Google; only the calendar reminders need it.
  features: {
    calendar: {
      name: "Google Calendar",
      why: "Reminds you before a meeting starts and offers to record it.",
      capabilities: ["google-workspace"],
      // Nothing of its own to set. Listed only because the SDK's
      // EveryAppWorkerManifest (cloudflare.config.ts) types a feature as
      // { secrets?, settings? }, which TypeScript refuses to match with an
      // object that has neither (rc.14).
      secrets: [],
    },
  },
});

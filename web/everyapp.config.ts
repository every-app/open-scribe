import { defineEveryApp } from "@every-app/sdk";

// defineEveryApp types the manifest; the Worker reads it back as
// env.EVERYAPP_MANIFEST.
export default defineEveryApp({
  id: "talk",
  name: "Talk",
  description:
    "Records meetings from the menu bar, transcribes them live and writes the notes.",
  // Every member of the workspace can open it; notes are private by default.
  access: "everyone",
  resources: {
    d1: ["DB"],
    // The desktop app's private update feed: electron-builder's
    // latest-mac.yml, zips, dmgs and blockmaps under mac/, served to members
    // by /api/v1/updates/mac/:file (src/server/updates.ts).
    r2: ["UPDATES"],
  },
  // A shared meeting page: anyone with the unguessable link reads it. The
  // route checks the token itself (src/server/meetings.ts, getSharedMeeting).
  public: [{ path: "/s/:token" }],
  // The built CSS and JavaScript (and icons) that page loads; without them an outsider
  // gets it unstyled and it never hydrates. Only static files: the Gateway
  // forwards these with no identity and the Worker answers nothing else.
  publicAssets: ["/assets/**", "/favicon.ico", "/apple-touch-icon.png"],
  // The paths Cloudflare Access lets through for bearer-only calls from the
  // Mac app; the perimeter still demands the token and refuses a cookie
  // there (the web UI uses server functions, which stay outside).
  bearerRoutes: {
    paths: ["/api/v1/**"],
    why: "The Mac app calls the API with a bearer token.",
  },
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
      access: "read",
      scopes: ["calendar.read"],
      optional: true,
      why: "Reads your calendar so the Mac app can remind you before a meeting starts.",
    },
  },
});

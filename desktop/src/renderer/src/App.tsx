// A placeholder that proves the bridge: sign-in, who's signed in, the helper and tray state, and
// Start/Stop against the (fake or real) helper. Lane UI replaces this with the real screens.

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HelperEvent } from "@shared/protocol";
import type { AppSnapshot } from "@shared/ipc";
import { talk, useAppState, useHelperEvents } from "./talk";

export function App() {
  const state = useAppState();
  return (
    <div className="flex h-full flex-col text-neutral-900 dark:text-neutral-100">
      <header className="drag flex h-12 shrink-0 items-center justify-center text-[13px] font-semibold text-neutral-500">
        Talk
      </header>
      <main className="flex-1 overflow-auto px-8 pb-8">
        {!state ? (
          <p className="text-neutral-500">Loading…</p>
        ) : state.auth.status === "signedIn" ? (
          <SignedIn state={state} />
        ) : (
          <SignIn state={state} />
        )}
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-black/10 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-neutral-800/60">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

const button =
  "rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900";
const secondary = "rounded-md border border-black/15 px-3 py-1.5 disabled:opacity-40 dark:border-white/20";
const input =
  "w-full rounded-md border border-black/15 bg-white/80 px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-white/15 dark:bg-neutral-900/60";

function SignIn({ state }: { state: AppSnapshot }) {
  const [appUrl, setAppUrl] = useState(state.auth.appUrl ?? "");
  const [token, setToken] = useState("");
  const [useToken, setUseToken] = useState(false);
  const auth = state.auth;
  const signingIn = auth?.status === "signingIn";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (useToken) void talk["auth:signInWithToken"](appUrl, token);
    else void talk["auth:signIn"](appUrl);
  };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <h1 className="mb-1 text-2xl font-semibold">Sign in to Talk</h1>
      <p className="mb-5 text-neutral-500">Type the Talk app URL you use in the browser.</p>
      <form onSubmit={submit} className="space-y-3">
        <input
          className={input}
          placeholder="https://talk.example.com"
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          aria-label="App URL"
          autoFocus
        />
        {useToken && (
          <input
            className={input}
            placeholder="epat_…"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-label="Access token"
          />
        )}
        <div className="flex items-center gap-2">
          <button className={button} type="submit" disabled={!appUrl || signingIn || (useToken && !token)}>
            {useToken ? "Sign in with token" : signingIn ? "Waiting for the browser…" : "Sign in with Every App"}
          </button>
          {signingIn && (
            <button className={secondary} type="button" onClick={() => void talk["auth:cancelSignIn"]()}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {auth?.error && <p className="mt-3 text-red-600 dark:text-red-400">{auth.error}</p>}
      <button className="mt-6 text-blue-600 dark:text-blue-400" type="button" onClick={() => setUseToken(!useToken)}>
        {useToken ? "Use Sign in with Every App instead" : "Use an access token instead"}
      </button>
    </div>
  );
}

function SignedIn({ state }: { state: AppSnapshot }) {
  const { auth, helper, recording, calendar } = state;
  const [lines, setLines] = useState<string[]>([]);
  // transcript.delta carries the whole turn so far: keep the latest text per itemId.
  const [live, setLive] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState({ mic: 0, system: 0 });
  const [error, setError] = useState<string>();

  const onHelper = useCallback((e: HelperEvent) => {
    if (e.event === "levels") setLevels({ mic: e.mic, system: e.system });
    if (e.event === "transcript.delta") setLive((s) => ({ ...s, [e.itemId]: e.text }));
    if (e.event === "transcript.segment") {
      setLive({});
      setLines((l) => [...l.slice(-7), `${e.speaker === "me" ? "Me" : "Them"}: ${e.text}`]);
    }
  }, []);
  useHelperEvents(onHelper);

  const meetings = useQuery({ queryKey: ["meetings"], queryFn: () => talk["api:meetings"]() });

  const run = (f: () => Promise<unknown>) => {
    setError(undefined);
    f().catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e)));
  };

  const busy = recording.state !== "idle";

  return (
    <div className="mx-auto max-w-2xl">
      <Card title="Signed in">
        <p className="text-base font-medium">{auth.email ?? "…"}</p>
        <p className="text-neutral-500">
          {auth.orgName ? `${auth.orgName} · ` : ""}
          {auth.appUrl} · {auth.method === "oauth" ? "Every App" : "access token"}
        </p>
        {auth.error && <p className="mt-2 text-red-600 dark:text-red-400">{auth.error}</p>}
        <button className={`${secondary} mt-3`} onClick={() => run(() => talk["auth:signOut"]())}>
          Sign out
        </button>
      </Card>

      <Card title="Recording">
        <div className="mb-3 flex items-center gap-3">
          <button
            className={button}
            disabled={busy || helper.status !== "ready"}
            onClick={() => {
              setLines([]);
              run(() => talk["recording:start"]({}));
            }}
          >
            Start
          </button>
          <button className={secondary} disabled={recording.state !== "recording"} onClick={() => run(() => talk["recording:stop"]())}>
            Stop
          </button>
          <span data-testid="recording-state">
            {recording.state}
            {recording.title ? `: ${recording.title}` : ""}
          </span>
        </div>
        {busy && (
          <div className="mb-2 flex gap-4 text-neutral-500">
            <Meter label="Mic" value={levels.mic} />
            <Meter label="System" value={levels.system} />
            <span>{recording.mode}</span>
          </div>
        )}
        {(lines.length > 0 || Object.keys(live).length > 0) && (
          <div className="space-y-0.5 rounded-md bg-black/5 p-2 select-text dark:bg-white/5">
            {lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
            {Object.entries(live).map(([id, text]) => (
              <p key={id} className="text-neutral-500">
                {text}
              </p>
            ))}
          </div>
        )}
        {(error ?? recording.error) && <p className="mt-2 text-red-600 dark:text-red-400">{error ?? recording.error}</p>}
      </Card>

      <Card title="Status">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          <dt className="text-neutral-500">Tray</dt>
          <dd data-testid="tray-state">{state.tray}</dd>
          <dt className="text-neutral-500">Recorder</dt>
          <dd data-testid="helper-state">
            {helper.status}
            {helper.version ? ` (${helper.version})` : ""}
            {helper.restarts ? `, ${helper.restarts} restarts` : ""}
            {helper.lastError && helper.status !== "ready" ? `: ${helper.lastError}` : ""}
          </dd>
          <dt className="text-neutral-500">Microphone</dt>
          <dd>
            {helper.permissions?.mic ?? "?"}
            {helper.permissions?.mic === "undetermined" && (
              <button className="ml-2 text-blue-600" onClick={() => run(() => talk["helper:requestPermission"]("mic"))}>
                Allow…
              </button>
            )}
          </dd>
          <dt className="text-neutral-500">System audio</dt>
          <dd>{helper.permissions?.systemAudio ?? "?"}</dd>
          <dt className="text-neutral-500">Updates</dt>
          <dd>{state.updater.enabled ? (state.updater.status ?? "on") : "off (no feed)"}</dd>
          <dt className="text-neutral-500">Version</dt>
          <dd>{state.version}</dd>
        </dl>
      </Card>

      <Card title="Coming up">
        {!calendar.connected ? (
          <button className={secondary} onClick={() => run(() => talk["calendar:connect"]())}>
            Connect Google Calendar
          </button>
        ) : calendar.events.length === 0 ? (
          <p className="text-neutral-500">{calendar.error ?? "Nothing in the next 24 hours."}</p>
        ) : (
          <ul className="space-y-1">
            {calendar.events.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span>
                  {new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} {e.title}
                </span>
                <button className="text-blue-600 dark:text-blue-400" disabled={busy} onClick={() => run(() => talk["recording:start"]({ calendarEventId: e.id }))}>
                  Take notes
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent meetings">
        {meetings.isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : meetings.error ? (
          <p className="text-red-600">{String(meetings.error)}</p>
        ) : (
          <ul className="space-y-1">
            {(meetings.data ?? []).slice(0, 10).map((m) => (
              <li key={m.id} className="flex justify-between">
                <button className="truncate text-left" onClick={() => run(() => talk["app:openInBrowser"](m.id))}>
                  {m.title}
                </button>
                <span className="text-neutral-500">{m.status}</span>
              </li>
            ))}
            {meetings.data?.length === 0 && <p className="text-neutral-500">No meetings yet.</p>}
          </ul>
        )}
        <button className={`${secondary} mt-2`} onClick={() => void meetings.refetch()}>
          Refresh
        </button>
      </Card>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1">
      {label}
      <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-black/10 dark:bg-white/10">
        <span className="block h-full bg-green-500" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  );
}

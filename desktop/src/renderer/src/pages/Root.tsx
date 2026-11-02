// The window: sign-in and first-run permissions until they're done, then the app frame around
// the routed page.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { AppSnapshot } from "@shared/ipc";
import type { NavTarget, Space } from "@talk/ui";
import { AppFrame, OnboardingScreen, TitleBar, useElapsed } from "@talk/ui";
import { Button } from "@talk/ui/components/button";
import { useCancelledStart, useStartRecording, useStopRecording } from "../actions";
import { api, cleanError, keys } from "../api";
import { asUiStatus, permissionsFrom, requestPermission } from "../desktop-settings";
import { useLevels } from "../live";
import { accountFrom, loadable } from "../map";
import { notify } from "../notice";
import { talk, useAppState } from "../talk";

const ONBOARDED_KEY = "talk.onboarded";

// Only needed when someone adds a folder: keep Base UI's dialog out of the first chunk.
const NameDialog = lazy(() => import("../dialogs").then((m) => ({ default: m.NameDialog })));

export function Root() {
  const state = useAppState();
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDED_KEY) === "1");
  if (!state) return <TitleBar />;
  if (state.auth.status !== "signedIn") return <SignIn state={state} />;
  if (!onboarded) {
    return (
      <FirstRun
        state={state}
        onDone={() => {
          localStorage.setItem(ONBOARDED_KEY, "1");
          setOnboarded(true);
        }}
      />
    );
  }
  return <Layout state={state} />;
}

function SignIn({ state }: { state: AppSnapshot }) {
  const [appUrl, setAppUrl] = useState(state.auth.appUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<void>) => {
    setError(null);
    work().catch((e: unknown) => setError(cleanError(e)));
  };
  return (
    <OnboardingScreen
      step="sign-in"
      appUrl={appUrl}
      onAppUrlChange={setAppUrl}
      signingIn={state.auth.status === "signingIn"}
      signInError={error ?? state.auth.error ?? null}
      onSignIn={() => run(() => talk["auth:signIn"](appUrl.trim()))}
      onCancelSignIn={() => void talk["auth:cancelSignIn"]()}
      onSubmitToken={(token) => run(() => talk["auth:signInWithToken"](appUrl.trim(), token))}
    />
  );
}

function FirstRun({ state, onDone }: { state: AppSnapshot; onDone: () => void }) {
  const [step, setStep] = useState<"permissions" | "done">("permissions");
  const permissions = permissionsFrom(state);
  return (
    <OnboardingScreen
      step={step}
      accountName={accountFrom(undefined, state.auth)?.name}
      permissions={{
        mic: permissions.mic,
        systemAudio: asUiStatus(permissions.systemAudio),
        notifications: permissions.notifications,
      }}
      onGrant={(kind) =>
        void requestPermission(kind, permissions[kind]).catch((e: unknown) => notify(cleanError(e), "error"))
      }
      onContinue={() => setStep("done")}
      onFinish={onDone}
    />
  );
}

function navFrom(pathname: string): NavTarget | null {
  if (pathname === "/") return { to: "home" };
  if (pathname === "/shared") return { to: "shared" };
  if (pathname === "/templates") return { to: "templates" };
  if (pathname === "/settings") return { to: "settings" };
  const folder = /^\/folders\/([^/]+)$/.exec(pathname);
  if (folder) return { to: "folder", id: decodeURIComponent(folder[1]!) };
  return null;
}

function Layout({ state }: { state: AppSnapshot }) {
  const navigate = useNavigate();
  const router = useRouter();
  const client = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const folders = useQuery({ queryKey: keys.folders, queryFn: () => api.folders().then((r) => r.folders) });
  const me = useQuery({ queryKey: keys.me, queryFn: api.me });
  const levels = useLevels();
  const start = useStartRecording();
  const stop = useStopRecording();
  const [adding, setAdding] = useState<Space | null>(null);
  const account = accountFrom(me.data, state.auth);
  const orgName = account?.orgName ?? "Team";

  const rec = state.recording;
  const onRecording = useCancelledStart();
  useEffect(() => onRecording(rec), [rec, onRecording]);
  const recordingId = rec.state !== "idle" ? rec.meetingId : undefined;
  const elapsedMs = useElapsed(rec.state === "recording" ? (rec.startedAt ?? null) : null);

  const onNavigate = (target: NavTarget) => {
    if (target.to === "home") void navigate({ to: "/" });
    else if (target.to === "shared") void navigate({ to: "/shared" });
    else if (target.to === "templates") void navigate({ to: "/templates", search: {} });
    else if (target.to === "settings") void navigate({ to: "/settings" });
    else void navigate({ to: "/folders/$id", params: { id: target.id } });
  };

  // ⌘N starts a note now, as the menu bar's "Take notes now" does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "n" && !event.shiftKey) {
        event.preventDefault();
        if (!recordingId) void start({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordingId, start]);

  const deep = pathname.startsWith("/meetings/") || pathname.startsWith("/upcoming/");

  return (
    <>
      <AppFrame
        sidebar={{
          current: navFrom(pathname),
          onNavigate,
          folders: loadable(folders),
          orgName,
          account,
          onNewFolder: setAdding,
          onNewNote: () => void start({}),
          recording: recordingId
            ? {
                live: {
                  meetingId: recordingId,
                  title: rec.title ?? "Meeting",
                  startedAt: rec.startedAt ?? new Date().toISOString(),
                  mode: rec.mode ?? "realtime",
                  mic: rec.mic ?? "ok",
                  system: rec.system ?? "ok",
                },
                levels,
                elapsedMs,
              }
            : null,
          onOpenRecording: () => recordingId && void navigate({ to: "/meetings/$id", params: { id: recordingId } }),
          onStopRecording: () => void stop(),
        }}
        titleBar={
          deep && (
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
              <ArrowLeft />
            </Button>
          )
        }
      >
        <Outlet />
      </AppFrame>
      {adding !== null && (
        <Suspense fallback={null}>
          <NameDialog
            open={adding !== null}
            onOpenChange={(open) => !open && setAdding(null)}
            title={adding === "team" ? `New folder in ${orgName}` : "New folder"}
            description={adding === "team" ? "Everyone on the team sees this folder and the notes in it." : "Only you see this folder."}
            submitLabel="Create folder"
            placeholder="Customer calls"
            onSubmit={async (name) => {
              if (!adding) return;
              try {
                const { folder } = await api.createFolder({ name, space: adding });
                setAdding(null);
                await client.invalidateQueries({ queryKey: keys.folders });
                await navigate({ to: "/folders/$id", params: { id: folder.id } });
              } catch (error) {
                notify(`Couldn't create the folder. ${cleanError(error)}`, "error");
              }
            }}
          />
        </Suspense>
      )}
    </>
  );
}

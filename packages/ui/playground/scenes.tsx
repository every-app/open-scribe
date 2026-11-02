import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../src/components/ui/button";
import type { ThemePreference } from "../src/lib/theme";
import {
  AppFrame,
  FolderScreen,
  HomeScreen,
  MeetingScreen,
  OnboardingScreen,
  SettingsScreen,
  SharedScreen,
  TemplatesScreen,
  type LiveState,
  type MeetingPhase,
  type MeetingScreenProps,
  type OnboardingScreenProps,
  type RecordingSummary,
  type SidebarProps,
  type TemplatesScreenProps,
} from "../src/screens";
import type { Levels, Loadable, MeetingDetail, NavTarget } from "../src/types";
import * as mock from "./mocks";

export interface SceneContext {
  /** Move the meters and stream text (off for screenshots). */
  animate: boolean;
}

export interface Scene {
  id: string;
  group: string;
  label: string;
  render: (ctx: SceneContext) => ReactNode;
}

const ready = <T,>(data: T): Loadable<T> => ({ status: "ready", data });
const loading = { status: "loading" } as const;
const failed = (message: string) => ({ status: "error", message }) as const;

const noop = () => {};

/* Fake live data ---------------------------------------------------------- */

const STILL: Levels = { mic: 0.55, system: 0.8 };

function useLevels(animate: boolean): Levels {
  const [levels, setLevels] = useState(STILL);
  useEffect(() => {
    if (!animate) return;
    let t = 0;
    const timer = setInterval(() => {
      t += 1;
      const speaking = Math.floor(t / 30) % 2 === 0;
      setLevels({
        mic: speaking ? 0.08 * Math.random() : 0.3 + 0.6 * Math.random(),
        system: speaking ? 0.35 + 0.6 * Math.random() : 0.05 * Math.random(),
      });
    }, 100);
    return () => clearInterval(timer);
  }, [animate]);
  return levels;
}

function useStreamingText(full: string, animate: boolean): string {
  const words = full.split(" ");
  const [count, setCount] = useState(words.length);
  useEffect(() => {
    if (!animate) return;
    setCount(1);
    const timer = setInterval(
      () => setCount((n) => (n >= words.length ? 1 : n + 1)),
      220,
    );
    return () => clearInterval(timer);
  }, [animate, words.length]);
  return words.slice(0, count).join(" ");
}

function useElapsedMock(animate: boolean): number {
  const base = mock.NOW.getTime() - new Date(mock.liveStartedAt).getTime();
  const [extra, setExtra] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setExtra((n) => n + 1000), 1000);
    return () => clearInterval(timer);
  }, [animate]);
  return base + extra;
}

function useLive(animate: boolean): LiveState {
  const levels = useLevels(animate);
  const them = useStreamingText(mock.livePartial.them, animate);
  const elapsedMs = useElapsedMock(animate);
  return {
    recording: {
      meetingId: "m-live",
      title: "Northwind onboarding call",
      startedAt: mock.liveStartedAt,
      mode: "realtime",
      mic: "ok",
      system: "ok",
    },
    levels,
    partial: { me: "", them },
    elapsedMs,
  };
}

/* Frame ------------------------------------------------------------------- */

function Frame({
  current,
  children,
  titleBar,
  recording,
  folders = ready(mock.folders),
}: {
  current: NavTarget | null;
  children: ReactNode;
  titleBar?: ReactNode;
  recording?: RecordingSummary | null;
  folders?: Loadable<typeof mock.folders>;
}) {
  const sidebar: SidebarProps = {
    current,
    onNavigate: noop,
    folders,
    orgName: mock.account.orgName,
    account: mock.account,
    onNewFolder: noop,
    onNewNote: noop,
    recording,
    onOpenRecording: noop,
    onStopRecording: noop,
  };
  return (
    <AppFrame sidebar={sidebar} titleBar={titleBar}>
      {children}
    </AppFrame>
  );
}

function Breadcrumb({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
      <Button variant="ghost" size="icon-sm" aria-label="Back">
        <ArrowLeft />
      </Button>
      <span className="truncate">{children}</span>
    </div>
  );
}

/* Meeting ----------------------------------------------------------------- */

function MeetingScene({
  phase,
  meeting = mock.meeting,
  animate,
  extra,
}: {
  phase: MeetingPhase;
  meeting?: MeetingDetail;
  animate: boolean;
  extra?: Partial<MeetingScreenProps>;
}) {
  const live = useLive(animate);
  const [jottings, setJottings] = useState(
    phase === "before"
      ? "Agenda\n- recap the pilot\n- pricing for 40 seats\n- security review: who owns it?"
      : phase === "during"
        ? "- pilot went well, inbound team daily\n- SFDC sync?? ask eng about timeline\n- "
        : (meeting.jottings?.markdown ?? ""),
  );
  const shown: MeetingDetail =
    phase === "after"
      ? meeting
      : {
          ...meeting,
          id: "m-live",
          title: "Northwind onboarding call",
          status: "recording",
          notes: null,
          segments: phase === "during" ? mock.liveSegments : [],
          startsAt: mock.events[0]!.start,
          folders: [],
          template: {
            id: "customer-call",
            name: "Customer call",
            chosen: false,
          },
        };
  const recording =
    phase === "during"
      ? { live: live.recording, levels: live.levels, elapsedMs: live.elapsedMs }
      : null;
  return (
    <Frame
      current={null}
      recording={recording}
      titleBar={
        <Breadcrumb>{phase === "after" ? "Customer calls" : "Home"}</Breadcrumb>
      }
    >
      <MeetingScreen
        meeting={shown}
        phase={phase}
        jottings={jottings}
        onJottingsChange={setJottings}
        live={phase === "during" ? live : null}
        folders={mock.folders}
        templates={mock.templates}
        orgName={mock.account.orgName}
        onRetitle={noop}
        onStart={noop}
        onStop={noop}
        onSaveNotes={noop}
        onRetryNotes={noop}
        onChangeTemplate={noop}
        onToggleFolder={noop}
        onSetVisibility={noop}
        onCreateShareLink={noop}
        onRevokeShareLink={noop}
        onCopyShareLink={noop}
        shareUrl={(id) => `https://talk.every.app/s/${id}`}
        {...extra}
      />
    </Frame>
  );
}

/* Templates --------------------------------------------------------------- */

function TemplatesScene(
  props: Partial<TemplatesScreenProps> & { initial?: string | "new" | null },
) {
  const [selectedId, setSelectedId] = useState<string | "new" | null>(
    props.initial === undefined ? "t-1" : props.initial,
  );
  return (
    <Frame current={{ to: "templates" }}>
      <TemplatesScreen
        templates={ready(mock.templates)}
        selectedId={selectedId}
        defaultTemplateId="general"
        orgName={mock.account.orgName}
        onSelect={setSelectedId}
        onNew={() => setSelectedId("new")}
        onSave={noop}
        onDelete={noop}
        onDuplicate={noop}
        onMakeDefault={noop}
        {...props}
      />
    </Frame>
  );
}

function SettingsScene() {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [launch, setLaunch] = useState(true);
  const [detect, setDetect] = useState(true);
  return (
    <SettingsScreen
      account={ready(mock.account)}
      permissions={ready(mock.permissionsMixed)}
      calendar={ready({ state: "connected", email: "ben@every.to" })}
      launchAtLogin={launch}
      detectCalls={detect}
      theme={theme}
      version="0.1.0 (alpha)"
      onSignOut={noop}
      onGrant={noop}
      onConnectCalendar={noop}
      onLaunchAtLoginChange={setLaunch}
      onDetectCallsChange={setDetect}
      onThemeChange={setTheme}
    />
  );
}

function Onboarding(props: OnboardingScreenProps) {
  return (
    <OnboardingScreen
      onSignIn={noop}
      onSubmitToken={noop}
      onGrant={noop}
      onContinue={noop}
      onFinish={noop}
      {...props}
    />
  );
}

/* Registry ---------------------------------------------------------------- */

const home = (overrides: Partial<Parameters<typeof HomeScreen>[0]> = {}) => (
  <HomeScreen
    comingUp={ready(mock.comingUp)}
    recent={ready(mock.recent)}
    onTakeNotes={noop}
    onOpenMeeting={noop}
    onConnectCalendar={noop}
    onNewNote={noop}
    onRetry={noop}
    now={mock.NOW}
    {...overrides}
  />
);

const folderScreen = (
  overrides: Partial<Parameters<typeof FolderScreen>[0]> = {},
) => (
  <FolderScreen
    folder={ready(mock.folders[0]!)}
    meetings={ready(mock.folderMeetings)}
    orgName={mock.account.orgName}
    templates={mock.templates}
    onOpenMeeting={noop}
    onRename={noop}
    onDelete={noop}
    onSetDefaultTemplate={noop}
    onRetry={noop}
    now={mock.NOW}
    {...overrides}
  />
);

function HomeRecording({ animate }: SceneContext) {
  const live = useLive(animate);
  return (
    <Frame
      current={{ to: "home" }}
      recording={{
        live: live.recording,
        levels: live.levels,
        elapsedMs: live.elapsedMs,
      }}
    >
      {home()}
    </Frame>
  );
}

export const scenes: Scene[] = [
  {
    id: "home",
    group: "Home",
    label: "Home",
    render: () => <Frame current={{ to: "home" }}>{home()}</Frame>,
  },
  {
    id: "home-recording",
    group: "Home",
    label: "Recording pill",
    render: (ctx) => <HomeRecording {...ctx} />,
  },
  {
    id: "home-empty",
    group: "Home",
    label: "Empty (no calendar)",
    render: () => (
      <Frame current={{ to: "home" }}>
        {home({
          comingUp: ready({ state: "disconnected", reconnect: false }),
          recent: ready([]),
        })}
      </Frame>
    ),
  },
  {
    id: "home-loading",
    group: "Home",
    label: "Loading",
    render: () => (
      <Frame current={{ to: "home" }} folders={loading}>
        {home({ comingUp: loading, recent: loading })}
      </Frame>
    ),
  },
  {
    id: "home-error",
    group: "Home",
    label: "Error",
    render: () => (
      <Frame current={{ to: "home" }}>
        {home({
          comingUp: ready({
            state: "error",
            message: "Google Calendar didn't answer. Try again in a minute.",
          }),
          recent: failed("Couldn't reach Talk. Check your connection."),
        })}
      </Frame>
    ),
  },

  {
    id: "meeting-before",
    group: "Meeting",
    label: "Before",
    render: (ctx) => <MeetingScene phase="before" {...ctx} />,
  },
  {
    id: "meeting-during",
    group: "Meeting",
    label: "During",
    render: (ctx) => <MeetingScene phase="during" {...ctx} />,
  },
  {
    id: "meeting-during-transcript",
    group: "Meeting",
    label: "During + transcript",
    render: (ctx) => (
      <MeetingScene
        phase="during"
        {...ctx}
        extra={{ defaultTranscriptOpen: true }}
      />
    ),
  },
  {
    id: "meeting-processing",
    group: "Meeting",
    label: "Writing notes",
    render: (ctx) => (
      <MeetingScene
        phase="after"
        {...ctx}
        meeting={{ ...mock.meeting, status: "processing", notes: null }}
      />
    ),
  },
  {
    id: "meeting-after",
    group: "Meeting",
    label: "After: notes",
    render: (ctx) => <MeetingScene phase="after" {...ctx} />,
  },
  {
    id: "meeting-after-jottings",
    group: "Meeting",
    label: "After: jottings",
    render: (ctx) => (
      <MeetingScene phase="after" {...ctx} extra={{ defaultTab: "jottings" }} />
    ),
  },
  {
    id: "meeting-after-transcript",
    group: "Meeting",
    label: "After: transcript",
    render: (ctx) => (
      <MeetingScene
        phase="after"
        {...ctx}
        extra={{ defaultTab: "transcript" }}
      />
    ),
  },
  {
    id: "meeting-after-edit",
    group: "Meeting",
    label: "After: editing notes",
    render: (ctx) => (
      <MeetingScene phase="after" {...ctx} extra={{ defaultEditing: true }} />
    ),
  },
  {
    id: "meeting-share",
    group: "Meeting",
    label: "Share",
    render: (ctx) => (
      <MeetingScene
        phase="after"
        {...ctx}
        meeting={{
          ...mock.meeting,
          visibility: "team",
          shareLinks: [
            { id: "q8Zr2kTw4pXn", createdAt: mock.NOW.toISOString() },
          ],
        }}
        extra={{ defaultShareOpen: true }}
      />
    ),
  },
  {
    id: "meeting-failed",
    group: "Meeting",
    label: "Notes failed",
    render: (ctx) => (
      <MeetingScene
        phase="after"
        {...ctx}
        meeting={{ ...mock.meeting, status: "failed", notes: null }}
      />
    ),
  },

  {
    id: "folder",
    group: "Folders",
    label: "Folder",
    render: () => (
      <Frame current={{ to: "folder", id: "f-1" }}>{folderScreen()}</Frame>
    ),
  },
  {
    id: "folder-team-empty",
    group: "Folders",
    label: "Team folder, empty",
    render: () => (
      <Frame current={{ to: "folder", id: "f-4" }}>
        {folderScreen({ folder: ready(mock.folders[3]!), meetings: ready([]) })}
      </Frame>
    ),
  },
  {
    id: "folder-loading",
    group: "Folders",
    label: "Loading",
    render: () => (
      <Frame current={{ to: "folder", id: "f-1" }}>
        {folderScreen({ folder: loading, meetings: loading })}
      </Frame>
    ),
  },
  {
    id: "folder-error",
    group: "Folders",
    label: "Error",
    render: () => (
      <Frame current={{ to: "folder", id: "f-1" }}>
        {folderScreen({
          folder: failed(
            "This folder was deleted or you no longer have access.",
          ),
        })}
      </Frame>
    ),
  },
  {
    id: "shared",
    group: "Folders",
    label: "Shared with me",
    render: () => (
      <Frame current={{ to: "shared" }}>
        <SharedScreen
          meetings={ready(mock.sharedMeetings)}
          orgName="Every"
          onOpenMeeting={noop}
          now={mock.NOW}
        />
      </Frame>
    ),
  },
  {
    id: "shared-empty",
    group: "Folders",
    label: "Shared, empty",
    render: () => (
      <Frame current={{ to: "shared" }}>
        <SharedScreen
          meetings={ready([])}
          orgName="Every"
          onOpenMeeting={noop}
          now={mock.NOW}
        />
      </Frame>
    ),
  },

  {
    id: "templates",
    group: "Templates",
    label: "Editor (mine)",
    render: () => <TemplatesScene />,
  },
  {
    id: "templates-builtin",
    group: "Templates",
    label: "Built-in",
    render: () => <TemplatesScene initial="general" />,
  },
  {
    id: "templates-new",
    group: "Templates",
    label: "New",
    render: () => <TemplatesScene initial="new" />,
  },
  {
    id: "templates-none",
    group: "Templates",
    label: "Nothing selected",
    render: () => <TemplatesScene initial={null} />,
  },
  {
    id: "templates-loading",
    group: "Templates",
    label: "Loading",
    render: () => <TemplatesScene templates={loading} />,
  },
  {
    id: "templates-error",
    group: "Templates",
    label: "Error",
    render: () => (
      <TemplatesScene
        templates={failed("Couldn't load templates. Check your connection.")}
      />
    ),
  },

  {
    id: "settings",
    group: "Settings",
    label: "Settings",
    render: () => (
      <Frame current={{ to: "settings" }}>
        <SettingsScene />
      </Frame>
    ),
  },
  {
    id: "settings-loading",
    group: "Settings",
    label: "Loading",
    render: () => (
      <Frame current={{ to: "settings" }}>
        <SettingsScreen
          account={loading}
          permissions={loading}
          calendar={loading}
          launchAtLogin={false}
          detectCalls={false}
          theme="system"
        />
      </Frame>
    ),
  },
  {
    id: "settings-disconnected",
    group: "Settings",
    label: "Calendar disconnected, errors",
    render: () => (
      <Frame current={{ to: "settings" }}>
        <SettingsScreen
          account={ready(mock.account)}
          permissions={failed("The audio helper isn't running. Restart Talk.")}
          calendar={ready({ state: "disconnected", reconnect: true })}
          launchAtLogin={false}
          detectCalls={true}
          theme="dark"
          onSignOut={noop}
          onConnectCalendar={noop}
        />
      </Frame>
    ),
  },

  {
    id: "onboarding-sign-in",
    group: "Onboarding",
    label: "Sign in",
    render: () => <Onboarding step="sign-in" />,
  },
  {
    id: "onboarding-token",
    group: "Onboarding",
    label: "Paste a token, error",
    render: () => (
      <Onboarding
        step="sign-in"
        defaultShowToken
        signInError="That token didn't work. It may have expired."
      />
    ),
  },
  {
    id: "onboarding-waiting",
    group: "Onboarding",
    label: "Waiting for browser",
    render: () => <Onboarding step="sign-in" signingIn />,
  },
  {
    id: "onboarding-permissions",
    group: "Onboarding",
    label: "Permissions",
    render: () => (
      <Onboarding step="permissions" permissions={mock.permissionsMixed} />
    ),
  },
  {
    id: "onboarding-permissions-fresh",
    group: "Onboarding",
    label: "Permissions, fresh",
    render: () => (
      <Onboarding step="permissions" permissions={mock.permissionsFresh} />
    ),
  },
  {
    id: "onboarding-done",
    group: "Onboarding",
    label: "Done",
    render: () => <Onboarding step="done" accountName={mock.account.name} />,
  },
];

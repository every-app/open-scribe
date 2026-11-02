import {
  createFileRoute,
  notFound,
  useLoaderData,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  CalendarDays,
  Copy,
  Folder,
  LayoutTemplate,
  Link2,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/client/components/Markdown";
import { ownerLabel } from "@/client/components/MeetingList";
import { Page } from "@/client/components/Page";
import { Transcript } from "@/client/components/Transcript";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Spinner } from "@/client/components/ui/spinner";
import { Switch } from "@/client/components/ui/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/client/components/ui/toggle-group";
import { shortDate, timeOfDay } from "@/client/lib/dates";
import { addToFolder, removeFromFolder } from "@/serverFunctions/folders";
import {
  createShareLink,
  deleteMeeting,
  getMeeting,
  revokeShareLink,
  setMeetingTemplate,
  updateMeeting,
} from "@/serverFunctions/meetings";
import { listTemplates } from "@/serverFunctions/templates";

export const Route = createFileRoute("/_app/meetings/$id")({
  loader: async ({ params }) => {
    const [meeting, templates] = await Promise.all([
      getMeeting({ data: { id: params.id } }),
      listTemplates(),
    ]);
    if (!meeting) throw notFound();
    return { meeting, templates: templates.templates };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.meeting.title ?? "Meeting"} · Talk` }],
  }),
  component: MeetingPage,
});

type Meeting = NonNullable<Awaited<ReturnType<typeof getMeeting>>>;

// The library's pressed color is the dark theme's background; lift it.
const pressed = "data-pressed:bg-secondary data-pressed:text-foreground";

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm text-foreground/80 transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-70";

function MeetingPage() {
  const { meeting, templates } = Route.useLoaderData();
  const router = useRouter();
  const [view, setView] = useState<"notes" | "transcript">("notes");
  const busy =
    meeting.status === "recording" || meeting.status === "processing";

  // While it records or the notes are being written, look again every few seconds.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.invalidate(), 4000);
    return () => clearInterval(timer);
  }, [busy, router]);

  async function run(work: () => Promise<unknown>, failed: string) {
    try {
      await work();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failed);
    }
  }

  return (
    <Page>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <Title meeting={meeting} run={run} />
          <div className="flex shrink-0 items-center gap-1 pt-1">
            {meeting.mine ? (
              <SharePopover meeting={meeting} run={run} />
            ) : (
              <span className="text-sm text-muted-foreground">
                Shared by {ownerLabel(meeting)}
              </span>
            )}
            {meeting.mine && <MeetingMenu meeting={meeting} />}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[view]}
            onValueChange={(next) => {
              const picked = next[0];
              if (picked === "notes" || picked === "transcript")
                setView(picked);
            }}
          >
            <ToggleGroupItem value="notes" className={pressed}>
              Notes
            </ToggleGroupItem>
            <ToggleGroupItem value="transcript" className={pressed}>
              Transcript
            </ToggleGroupItem>
          </ToggleGroup>
          <DateChip meeting={meeting} />
          <FolderChip meeting={meeting} run={run} />
          <TemplateChip meeting={meeting} templates={templates} run={run} />
        </div>
      </div>

      <article className="text-[15px]">
        {view === "transcript" ? (
          <Transcript segments={meeting.segments} />
        ) : meeting.status === "processing" ? (
          // The template being tried is pinned only once the notes are
          // written, so the chip still names the earlier one: no name here.
          <Pending>
            {meeting.notes ? "Rewriting the notes…" : "Writing the notes…"}
          </Pending>
        ) : meeting.status === "recording" ? (
          <Pending>
            Taking notes. They're written when the meeting ends.
          </Pending>
        ) : meeting.notes ? (
          <>
            {meeting.status === "failed" && (
              <p className="mb-4 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                The notes couldn't be rewritten. These are the earlier ones,
                written with {meeting.template.name}.
              </p>
            )}
            <Markdown text={meeting.notes.markdown} />
          </>
        ) : (
          <p className="text-muted-foreground">
            {meeting.status === "failed"
              ? "The notes couldn't be written. Pick a template above to try again."
              : "No notes."}
          </p>
        )}
      </article>
    </Page>
  );
}

function Pending({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <Spinner />
      {children}
    </p>
  );
}

type Run = (work: () => Promise<unknown>, failed: string) => Promise<void>;

function Title({ meeting, run }: { meeting: Meeting; run: Run }) {
  const [title, setTitle] = useState(meeting.title);
  useEffect(() => setTitle(meeting.title), [meeting.title]);
  const className =
    "w-full min-w-0 truncate bg-transparent text-3xl font-semibold tracking-tight outline-none";
  if (!meeting.mine) return <h1 className={className}>{meeting.title}</h1>;
  const save = () => {
    const next = title.trim();
    if (!next || next === meeting.title) return setTitle(meeting.title);
    void run(
      () =>
        updateMeeting({ data: { id: meeting.id, change: { title: next } } }),
      "Couldn't rename it.",
    );
  };
  return (
    <input
      // data-slot keeps app.css's 16px input rule off this heading.
      data-slot="title-input"
      aria-label="Title"
      className={`${className} rounded-md focus:ring-2 focus:ring-ring/40`}
      value={title}
      maxLength={255}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setTitle(meeting.title);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function DateChip({ meeting }: { meeting: Meeting }) {
  const guests = meeting.attendees;
  const when = (
    <>
      <CalendarDays className="size-3.5" />
      {shortDate(meeting.startsAt)}, {timeOfDay(meeting.startsAt)}
      {guests.length > 0 && (
        <>
          <Users className="ml-1 size-3.5" />
          {guests.length}
        </>
      )}
    </>
  );
  if (guests.length === 0) return <span className={chip}>{when}</span>;
  return (
    <Popover>
      <PopoverTrigger className={chip}>{when}</PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverTitle>Guests</PopoverTitle>
        <ul className="mt-2 space-y-1.5 text-sm">
          {guests.map((guest, i) => (
            <li key={i} className="truncate">
              {guest.name ?? guest.email ?? "Guest"}
              {guest.name && guest.email && (
                <span className="text-muted-foreground"> · {guest.email}</span>
              )}
              {guest.self && (
                <span className="text-muted-foreground"> (you)</span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function FolderChip({ meeting, run }: { meeting: Meeting; run: Run }) {
  const { folders, account } = useLoaderData({ from: "/_app" });
  const filed = new Set(meeting.folders.map((folder) => folder.id));
  const label =
    meeting.folders.length === 0
      ? "Add to folder"
      : meeting.folders.length === 1
        ? meeting.folders[0]!.name
        : `${meeting.folders[0]!.name} +${meeting.folders.length - 1}`;
  const groups = [
    { label: "My notes", items: folders.filter((f) => f.space === "private") },
    {
      label: account.user.orgName,
      items: folders.filter((f) => f.space === "team"),
    },
  ].filter((group) => group.items.length > 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={chip}>
        <Folder className="size-3.5" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {groups.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No folders yet. Make one with + in the sidebar.
          </p>
        )}
        {groups.map((group, i) => (
          <DropdownMenuGroup key={group.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.items.map((folder) => {
              const locked =
                folder.space === "team" &&
                meeting.visibility === "private" &&
                !meeting.mine;
              return (
                <DropdownMenuCheckboxItem
                  key={folder.id}
                  checked={filed.has(folder.id)}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    run(async () => {
                      const ids = {
                        folderId: folder.id,
                        meetingId: meeting.id,
                      };
                      if (!checked) return removeFromFolder({ data: ids });
                      const result = await addToFolder({ data: ids });
                      if (result.shared) toast("Shared with the team.");
                    }, "Couldn't change the folder.")
                  }
                >
                  {folder.name}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplateChip({
  meeting,
  templates,
  run,
}: {
  meeting: Meeting;
  templates: Awaited<ReturnType<typeof listTemplates>>["templates"];
  run: Run;
}) {
  const content = (
    <>
      <LayoutTemplate className="size-3.5" />
      {meeting.template.name}
    </>
  );
  const changeable = meeting.mine && meeting.status !== "processing";
  if (!changeable) {
    return (
      <span className={chip} title="The template the notes were written with">
        {content}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={chip}>{content}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {meeting.status === "recording"
              ? "Write the notes with"
              : "Rewrite the notes with"}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={meeting.template.id}
            onValueChange={(templateId: string) => {
              if (
                templateId === meeting.template.id &&
                meeting.status !== "failed"
              )
                return;
              void run(async () => {
                const { rewriting } = await setMeetingTemplate({
                  data: { id: meeting.id, templateId },
                });
                if (rewriting) toast("Rewriting the notes…");
              }, "Couldn't change the template.");
            }}
          >
            {templates.map((template) => (
              <DropdownMenuRadioItem key={template.id} value={template.id}>
                {template.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SharePopover({ meeting, run }: { meeting: Meeting; run: Run }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const team = meeting.visibility === "team";
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant={team ? "secondary" : "outline"} size="sm" />}
      >
        <Users />
        {team ? "Shared" : "Share"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-4">
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">
                Share with the team
              </span>
              <span className="block text-xs text-muted-foreground">
                Everyone in the workspace can read it.
                {team && meeting.folders.length > 0
                  ? " Making it private takes it out of team folders."
                  : ""}
              </span>
            </span>
            <Switch
              checked={team}
              onCheckedChange={(checked) =>
                run(
                  () =>
                    updateMeeting({
                      data: {
                        id: meeting.id,
                        change: { visibility: checked ? "team" : "private" },
                      },
                    }),
                  "Couldn't change who can see it.",
                )
              }
            />
          </label>
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-sm font-medium">Public link</span>
            <span className="text-xs text-muted-foreground">
              Anyone with the link can read the notes and transcript.
            </span>
            {meeting.shareLinks.map((link) => {
              const url = `${origin}/s/${link.id}`;
              return (
                <div key={link.id} className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 text-xs">
                    {url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy link"
                    onClick={async () => {
                      await navigator.clipboard.writeText(url);
                      toast("Link copied.");
                    }}
                  >
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      run(
                        () =>
                          revokeShareLink({
                            data: { id: meeting.id, linkId: link.id },
                          }),
                        "Couldn't turn the link off.",
                      )
                    }
                  >
                    Turn off
                  </Button>
                </div>
              );
            })}
            {meeting.shareLinks.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  run(async () => {
                    const link = await createShareLink({
                      data: { id: meeting.id },
                    });
                    if (link) {
                      await navigator.clipboard
                        .writeText(`${origin}/s/${link.id}`)
                        .then(() => toast("Link created and copied."))
                        .catch(() => toast("Link created."));
                    }
                  }, "Couldn't create a link.")
                }
              >
                <Link2 />
                Create public link
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MeetingMenu({ meeting }: { meeting: Meeting }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="More actions" />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleting(true)}
          >
            Delete meeting
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{meeting.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The notes, transcript and public links go too. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await deleteMeeting({ data: { id: meeting.id } });
                await router.invalidate();
                await navigate({ to: "/" });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

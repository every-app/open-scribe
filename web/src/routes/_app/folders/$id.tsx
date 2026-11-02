import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { FolderOpen, MoreHorizontal, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AddNotesDialog } from "@/client/components/AddNotesDialog";
import { FolderNameDialog } from "@/client/components/FolderNameDialog";
import { MeetingList } from "@/client/components/MeetingList";
import { Page, PageTitle } from "@/client/components/Page";
import { TemplateSelect } from "@/client/components/TemplateSelect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@talk/ui/components/alert-dialog";
import { Button } from "@talk/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@talk/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@talk/ui/components/empty";
import {
  deleteFolder,
  getFolder,
  removeFromFolder,
  updateFolder,
} from "@/serverFunctions/folders";
import { listMeetings } from "@/serverFunctions/meetings";
import { listTemplates } from "@/serverFunctions/templates";

export const Route = createFileRoute("/_app/folders/$id")({
  loader: async ({ params }) => {
    const [folder, meetings, templates] = await Promise.all([
      getFolder({ data: { id: params.id } }),
      listMeetings({ data: { folderId: params.id } }),
      listTemplates(),
    ]);
    if (!folder) throw notFound();
    return { folder, meetings, templates };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.folder.name ?? "Folder"} · Talk` }],
  }),
  component: FolderPage,
});

function FolderPage() {
  const { folder, meetings, templates } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);

  async function run(work: () => Promise<unknown>, failed: string) {
    try {
      await work();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failed);
    }
  }

  const team = folder.space === "team";
  // A team folder's template applies to everyone's notes: only shared ones.
  const choices = team
    ? templates.templates.filter((template) => template.visibility === "team")
    : templates.templates;
  return (
    <Page>
      <PageTitle
        description={
          team
            ? "Team folder: everyone on the team sees it and the notes in it."
            : "Private folder: only you see it."
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add notes
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Folder actions"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onClick={() => setRenaming(true)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleting(true)}
                >
                  Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        {folder.name}
      </PageTitle>

      <div className="-mt-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Notes template</span>
        <TemplateSelect
          templates={choices}
          value={
            choices.some((template) => template.id === folder.defaultTemplateId)
              ? folder.defaultTemplateId
              : null
          }
          autoLabel="Each person's default"
          onChange={(templateId) =>
            run(
              () =>
                updateFolder({
                  data: {
                    id: folder.id,
                    change: { defaultTemplateId: templateId },
                  },
                }),
              "Couldn't set the template.",
            )
          }
        />
      </div>

      {meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No notes here yet</EmptyTitle>
            <EmptyDescription>
              Add meetings to this folder to keep them together
              {team ? " and share them with the team" : ""}.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAdding(true)}>Add notes</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <MeetingList
          meetings={meetings}
          action={(meeting) => (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${meeting.title} from this folder`}
              title="Remove from folder"
              onClick={() =>
                run(
                  () =>
                    removeFromFolder({
                      data: { folderId: folder.id, meetingId: meeting.id },
                    }),
                  "Couldn't remove it.",
                )
              }
            >
              <X />
            </Button>
          )}
        />
      )}

      <AddNotesDialog
        open={adding}
        onOpenChange={setAdding}
        folder={folder}
        inFolder={new Set(meetings.map((meeting) => meeting.id))}
        onAdded={() => router.invalidate()}
      />
      <FolderNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename folder"
        submitLabel="Rename"
        initialName={folder.name}
        onSubmit={async (name) => {
          await run(
            () => updateFolder({ data: { id: folder.id, change: { name } } }),
            "Couldn't rename the folder.",
          );
          setRenaming(false);
        }}
      />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{folder.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The notes in it stay, and keep who they're shared with.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await deleteFolder({ data: { id: folder.id } });
                await router.invalidate();
                await navigate({ to: "/" });
              }}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

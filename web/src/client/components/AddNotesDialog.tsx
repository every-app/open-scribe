import { Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MeetingRow } from "@/client/components/MeetingList";
import { ownerLabel } from "@/client/components/MeetingList";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@talk/ui/components/dialog";
import { Input } from "@talk/ui/components/input";
import { Spinner } from "@talk/ui/components/spinner";
import { dayLabel } from "@talk/ui/lib/dates";
import type { Folder } from "@/api/contract";
import { addToFolder } from "@/serverFunctions/folders";
import { listMeetings } from "@/serverFunctions/meetings";

/** Pick meetings to file in a folder. */
export function AddNotesDialog({
  open,
  onOpenChange,
  folder,
  inFolder,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: Folder;
  inFolder: Set<string>;
  onAdded: () => void;
}) {
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAdded(new Set());
    listMeetings({ data: {} }).then(setMeetings, () =>
      toast.error("Couldn't load your notes."),
    );
  }, [open]);

  async function add(meeting: MeetingRow) {
    try {
      const result = await addToFolder({
        data: { folderId: folder.id, meetingId: meeting.id },
      });
      setAdded((current) => new Set(current).add(meeting.id));
      if (result.shared)
        toast(`“${meeting.title}” is now shared with the team.`);
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add it.");
    }
  }

  const needle = query.trim().toLowerCase();
  const shown = (meetings ?? []).filter(
    (meeting) => !needle || meeting.title.toLowerCase().includes(needle),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add notes to {folder.name}</DialogTitle>
          {folder.space === "team" && (
            <DialogDescription>
              Notes you add here are shared with the whole team.
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Search notes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="-mx-2 max-h-80 overflow-auto">
          {meetings === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              No notes found.
            </p>
          ) : (
            <ul>
              {shown.map((meeting) => {
                const done = inFolder.has(meeting.id) || added.has(meeting.id);
                return (
                  <li key={meeting.id}>
                    <button
                      type="button"
                      disabled={done}
                      onClick={() => add(meeting)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {meeting.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {dayLabel(new Date(meeting.startsAt))} ·{" "}
                          {ownerLabel(meeting)}
                        </span>
                      </span>
                      {done ? (
                        <Check className="size-4 text-muted-foreground" />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Add
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

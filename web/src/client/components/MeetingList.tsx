import { Link } from "@tanstack/react-router";
import { FileText, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/client/components/ui/badge";
import { dayLabel, groupByDay, timeOfDay } from "@/client/lib/dates";
import type { listMeetings } from "@/server/meetings";

export type MeetingRow = Awaited<ReturnType<typeof listMeetings>>[number];

const statusLabel = {
  recording: "Recording",
  processing: "Writing notes",
  failed: "Notes failed",
} as const;

/** "Me", or whose meeting it is. */
export function ownerLabel(meeting: MeetingRow): string {
  if (meeting.mine) return "Me";
  return meeting.ownerEmail ?? "A teammate";
}

/** Meetings grouped by day, newest first, each linking to its notes. */
export function MeetingList({
  meetings,
  action,
}: {
  meetings: MeetingRow[];
  /** Something to show at the end of each row on hover (remove from folder). */
  action?: (meeting: MeetingRow) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {groupByDay(meetings, (meeting) => meeting.startsAt).map((group) => (
        <section key={group.day}>
          <h2 className="mb-1 px-3 text-sm font-medium text-muted-foreground">
            {dayLabel(group.date)}
          </h2>
          <ul>
            {group.items.map((meeting) => (
              <li key={meeting.id} className="group relative">
                <Link
                  to="/meetings/$id"
                  params={{ id: meeting.id }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {meeting.title}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {ownerLabel(meeting)}
                    </span>
                  </span>
                  {meeting.status !== "done" && (
                    <Badge
                      variant={
                        meeting.status === "failed"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {statusLabel[meeting.status]}
                    </Badge>
                  )}
                  {meeting.visibility === "team" && (
                    <Users
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-label="Shared with the team"
                    />
                  )}
                  <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                    {timeOfDay(meeting.startsAt)}
                  </span>
                  {action && <span className="w-7 shrink-0" />}
                </Link>
                {action && (
                  <span className="reveal-on-hover absolute right-3 top-1/2 -translate-y-1/2">
                    {action(meeting)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

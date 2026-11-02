import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Users, Video } from "lucide-react";
import { useState } from "react";
import { Button } from "@talk/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@talk/ui/components/tooltip";
import { groupByDay, timeOfDay } from "@talk/ui/lib/dates";
import { takeNotesLink } from "@/client/lib/talk-link";
import type { ComingUp as ComingUpData } from "@/serverFunctions/home";

type Event = Extract<ComingUpData, { state: "ok" }>["events"][number];

const DAYS_PER_PAGE = 3;
/** "Start now" from this long before a meeting until it ends. */
const SOON_MS = 10 * 60_000;

/** The next few days of the calendar, a page of days at a time. */
export function ComingUp({ data }: { data: ComingUpData }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Coming up</h1>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Body data={data} />
      </div>
    </section>
  );
}

function Body({ data }: { data: ComingUpData }) {
  if (data.state === "unavailable") {
    return (
      <Message>
        Google Calendar isn't set up on this workspace. An admin adds Google to
        the Every App Gateway.
      </Message>
    );
  }
  if (data.state === "disconnected") {
    return (
      <Message>
        <span>See your upcoming meetings and take notes in one click.</span>
        <Button
          size="sm"
          nativeButton={false}
          render={<a href={data.connectUrl} />}
        >
          {data.reconnect ? "Reconnect" : "Connect"} Google Calendar
        </Button>
      </Message>
    );
  }
  if (data.state === "error") return <Message>{data.message}</Message>;
  return <Days events={data.events} />;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Days({ events }: { events: Event[] }) {
  const [page, setPage] = useState(0);
  const days = groupByDay(events, (event) => event.start);
  if (days.length === 0) {
    return <Message>No meetings in the next two weeks.</Message>;
  }
  const pages = Math.ceil(days.length / DAYS_PER_PAGE);
  const shown = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);
  return (
    <div className="relative">
      {pages > 1 && (
        <div className="absolute right-3 top-3 z-10 flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Earlier days"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Later days"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      <ol className="divide-y divide-dashed divide-border">
        {shown.map((day) => (
          <li key={day.day} className="flex gap-6 px-5 py-4">
            <div className="flex w-28 shrink-0 items-start gap-3 pt-1">
              <span className="text-3xl font-light leading-none tabular-nums">
                {day.date.getDate()}
              </span>
              <span className="text-sm leading-tight">
                {day.date.toLocaleDateString(undefined, { month: "long" })}
                <span className="block text-muted-foreground">
                  {day.date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
              </span>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-3 pr-16">
              {day.items.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  const live = now >= start && now < end;
  const soon = start - now <= SOON_MS && now < end;
  const guests = event.attendees.length;
  return (
    <li className="group flex items-center gap-3">
      <span className="h-9 w-0.5 shrink-0 rounded-full bg-primary/60" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{event.title}</span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {live && <span className="font-medium text-primary">Now</span>}
          <span className="tabular-nums">
            {timeOfDay(event.start)} – {timeOfDay(event.end)}
          </span>
          {guests > 1 && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {guests}
            </span>
          )}
        </span>
      </span>
      {event.conferenceUrl && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Join the call"
                nativeButton={false}
                render={
                  <a
                    href={event.conferenceUrl}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
                className="reveal-on-hover"
              />
            }
          >
            <Video />
          </TooltipTrigger>
          <TooltipContent>Join the call</TooltipContent>
        </Tooltip>
      )}
      {event.meetingId ? (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/meetings/$id" params={{ id: event.meetingId }} />}
        >
          Open notes
        </Button>
      ) : (
        <Button
          variant={soon ? "default" : "outline"}
          size="sm"
          nativeButton={false}
          className={soon ? undefined : "reveal-on-hover"}
          render={
            <a
              href={takeNotesLink({
                id: event.id,
                title: event.title,
                start: event.start,
                join: soon && Boolean(event.conferenceUrl),
              })}
            />
          }
        >
          {soon ? "Start now" : "Take notes"}
        </Button>
      )}
    </li>
  );
}

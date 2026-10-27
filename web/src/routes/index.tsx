import { createFileRoute, Link } from "@tanstack/react-router";
import { getHome } from "@/serverFunctions/home";
import { listMeetings } from "@/serverFunctions/meetings";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [home, meetings] = await Promise.all([getHome(), listMeetings()]);
    return { home, meetings };
  },
  head: () => ({ meta: [{ title: "OpenZen" }] }),
  component: Home,
});

const card = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Home() {
  const { home, meetings } = Route.useLoaderData();
  const { calendar } = home;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <a
            href={home.launcher}
            aria-label="Back to EveryApp"
            className="text-xs text-neutral-500 hover:underline"
          >
            ‹ EveryApp
          </a>
          <h1 className="text-2xl font-semibold">OpenZen</h1>
        </div>
        <span className="text-sm text-neutral-500">{home.user.email}</span>
      </header>

      <section className={card}>
        <h2 className="mb-2 font-medium">Mac app</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          In OpenZen for Mac, enter this app's URL{" "}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-900">
            {home.appUrl}
          </code>{" "}
          and choose Sign in with Every App.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Fallback: paste a Full access personal access token from{" "}
          <a href={home.tokensUrl} className="underline">
            Manage workspace → Tokens
          </a>
          .
        </p>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Calendar:{" "}
          {!calendar.available ? (
            "Google isn't set up on this Gateway."
          ) : calendar.connected ? (
            "Google Calendar connected."
          ) : (
            <a href={calendar.connectUrl} className="underline">
              {calendar.reconnect ? "Reconnect" : "Connect"} Google Calendar
            </a>
          )}
        </p>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-medium">Meetings</h2>
        {meetings.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No meetings yet. Record one from the menu bar.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {meetings.map((meeting) => (
              <li
                key={meeting.id}
                className="flex items-center justify-between py-2"
              >
                <Link
                  to="/meetings/$id"
                  params={{ id: meeting.id }}
                  className="hover:underline"
                >
                  {meeting.title}
                </Link>
                <span className="text-xs text-neutral-500">
                  {when(meeting.startsAt)} · {meeting.status}
                  {meeting.visibility === "team" ? " · team" : ""}
                  {!meeting.mine ? " · shared with you" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

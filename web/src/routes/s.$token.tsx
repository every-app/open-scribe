import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Markdown } from "@/client/components/Markdown";
import { Transcript } from "@/client/components/Transcript";
import { getSharedMeeting } from "@/serverFunctions/meetings";

// A public route (everyapp.config.ts): anyone with the link reads it. The
// token is the whole check. The page never shows an email address; the
// transcript's speakers carry the names the calendar has (the recorder's and
// the guests'), as the notes already do.
export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }) => {
    const shared = await getSharedMeeting({ data: { token: params.token } });
    if (!shared) throw notFound();
    return { shared };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? loaderData.shared.title : "Shared meeting" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Shared,
});

/**
 * The page is rendered on the server, which doesn't know the reader's time
 * zone: it shows UTC until the browser puts it in local time.
 */
function When({ iso }: { iso: string }) {
  const format = (timeZone?: "UTC") =>
    new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }) + (timeZone ? " UTC" : "");
  const [text, setText] = useState(() => format("UTC"));
  useEffect(() => setText(format()), [iso]);
  return <time dateTime={iso}>{text}</time>;
}

function Shared() {
  const { shared } = Route.useLoaderData();
  return (
    <div className="h-full overflow-auto">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <header>
          <p className="text-sm text-muted-foreground">Shared meeting notes</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {shared.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            <When iso={shared.startsAt} />
          </p>
        </header>
        <section className="text-[15px]">
          {shared.notes ? (
            <Markdown text={shared.notes.markdown} />
          ) : (
            <p className="text-muted-foreground">No notes yet.</p>
          )}
        </section>
        <section className="border-t border-border pt-6">
          <h2 className="mb-3 font-semibold">Transcript</h2>
          <Transcript segments={shared.segments} speakers={shared.speakers} />
        </section>
      </main>
    </div>
  );
}

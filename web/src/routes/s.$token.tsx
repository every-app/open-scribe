import { createFileRoute, notFound } from "@tanstack/react-router";
import { Markdown } from "@/client/components/Markdown";
import { Transcript } from "@/client/components/Transcript";
import { getSharedMeeting } from "@/serverFunctions/meetings";

// A public route (everyapp.config.ts): anyone with the link reads it. The
// token is the whole check, so the page never shows who recorded it.
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
            {new Date(shared.startsAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
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
          <Transcript segments={shared.segments} />
        </section>
      </main>
    </div>
  );
}

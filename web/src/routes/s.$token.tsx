import { createFileRoute, notFound } from "@tanstack/react-router";
import { Markdown } from "@/components/Markdown";
import { Transcript } from "@/components/Transcript";
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

const card = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";

function Shared() {
  const { shared } = Route.useLoaderData();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header>
        <p className="text-xs text-neutral-500">Shared meeting notes</p>
        <h1 className="text-2xl font-semibold">{shared.title}</h1>
        <p className="text-sm text-neutral-500">
          {new Date(shared.startsAt).toLocaleString()}
        </p>
      </header>
      <section className={card}>
        <h2 className="mb-2 font-medium">Notes</h2>
        {shared.notes ? (
          <Markdown text={shared.notes.markdown} />
        ) : (
          <p className="text-sm text-neutral-500">No notes yet.</p>
        )}
      </section>
      <section className={card}>
        <h2 className="mb-2 font-medium">Transcript</h2>
        <Transcript segments={shared.segments} />
      </section>
    </main>
  );
}

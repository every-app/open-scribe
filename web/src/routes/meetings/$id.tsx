import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Transcript } from "@/components/Transcript";
import {
  createShareLink,
  getMeeting,
  revokeShareLink,
  updateMeeting,
} from "@/serverFunctions/meetings";

export const Route = createFileRoute("/meetings/$id")({
  loader: async ({ params }) => {
    const meeting = await getMeeting({ data: { id: params.id } });
    if (!meeting) throw notFound();
    return { meeting };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? loaderData.meeting.title : "Meeting" }],
  }),
  component: Meeting,
});

const card = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";
const button =
  "rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900";

function Meeting() {
  const { meeting } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  async function change(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work.");
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header>
        <Link to="/" className="text-xs text-neutral-500 hover:underline">
          ‹ Meetings
        </Link>
        <h1 className="text-2xl font-semibold">{meeting.title}</h1>
        <p className="text-sm text-neutral-500">
          {new Date(meeting.startsAt).toLocaleString()} · {meeting.status}
        </p>
      </header>

      {meeting.mine && (
        <section
          className={`${card} flex flex-wrap items-center gap-3 text-sm`}
        >
          <span>
            Visible to:{" "}
            <strong>
              {meeting.visibility === "team" ? "the team" : "only me"}
            </strong>
          </span>
          <button
            className={button}
            onClick={() =>
              change(() =>
                updateMeeting({
                  data: {
                    id: meeting.id,
                    change: {
                      visibility:
                        meeting.visibility === "team" ? "private" : "team",
                    },
                  },
                }),
              )
            }
          >
            {meeting.visibility === "team" ? "Make private" : "Share with team"}
          </button>
          <button
            className={button}
            onClick={() =>
              change(() => createShareLink({ data: { id: meeting.id } }))
            }
          >
            New public link
          </button>
          {meeting.shareLinks.map((link) => (
            <span key={link.id} className="flex w-full items-center gap-2">
              <code className="truncate rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-900">
                {origin}/s/{link.id}
              </code>
              <button
                className={button}
                onClick={() =>
                  change(() =>
                    revokeShareLink({
                      data: { id: meeting.id, linkId: link.id },
                    }),
                  )
                }
              >
                Revoke
              </button>
            </span>
          ))}
          {error && <p className="w-full text-red-600">{error}</p>}
        </section>
      )}

      <section className={card}>
        <h2 className="mb-2 font-medium">Notes</h2>
        {meeting.notes ? (
          <Markdown text={meeting.notes.markdown} />
        ) : (
          <p className="text-sm text-neutral-500">
            {meeting.status === "recording"
              ? "Recording. Notes are written when it ends."
              : meeting.status === "processing"
                ? "Writing the notes…"
                : meeting.status === "failed"
                  ? "The notes couldn't be written."
                  : "No notes."}
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-medium">Transcript</h2>
        <Transcript segments={meeting.segments} />
      </section>
    </main>
  );
}

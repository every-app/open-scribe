import type { Segment } from "@/server/meetings";

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Transcript({ segments }: { segments: Segment[] }) {
  if (segments.length === 0) {
    return <p className="text-neutral-500">Nothing transcribed yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {segments.map((segment) => (
        <li key={segment.seq} className="flex gap-3">
          <span className="w-12 shrink-0 font-mono text-xs text-neutral-500">
            {clock(segment.startedMs)}
          </span>
          <span>
            {segment.speaker && (
              <span className="mr-1 font-medium text-neutral-600 dark:text-neutral-400">
                {segment.speaker === "me" ? "Me:" : "Them:"}
              </span>
            )}
            {segment.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

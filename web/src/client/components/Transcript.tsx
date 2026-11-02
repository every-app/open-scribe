import type { Segment } from "@/api/contract";

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function Transcript({ segments }: { segments: Segment[] }) {
  if (segments.length === 0) {
    return <p className="text-muted-foreground">Nothing transcribed yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {segments.map((segment) => (
        <li key={segment.seq} className="flex gap-3">
          <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
            {clock(segment.startedMs)}
          </span>
          <span className="leading-relaxed">
            {segment.speaker && (
              <span className="mr-1.5 font-medium text-muted-foreground">
                {segment.speaker === "me" ? "Me" : "Them"}
              </span>
            )}
            {segment.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

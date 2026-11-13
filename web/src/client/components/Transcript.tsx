import { Users } from "lucide-react";
import type { Segment, SpeakerLabels } from "@/api/contract";

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The transcript, each line under the name the server worked out for its
 * side (`speakers`: the calendar's names where it has them, else "Me" and
 * "Them"). The names are calendar text, shown as text.
 */
export function Transcript({
  segments,
  speakers,
}: {
  segments: Segment[];
  speakers: SpeakerLabels;
}) {
  if (segments.length === 0) {
    return <p className="text-muted-foreground">Nothing transcribed yet.</p>;
  }
  return (
    <>
      {speakers.guests && (
        <p className="mb-4 flex items-start gap-1.5 text-sm text-muted-foreground">
          <Users className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{speakers.guests}</span>
        </p>
      )}
      <ol className="space-y-3">
        {segments.map((segment) => (
          <li key={segment.seq} className="flex gap-3">
            <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
              {clock(segment.startedMs)}
            </span>
            <span className="leading-relaxed">
              {segment.speaker && (
                <span className="mr-1.5 font-medium text-muted-foreground">
                  {segment.speaker === "me" ? speakers.me : speakers.them}
                </span>
              )}
              {segment.text}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

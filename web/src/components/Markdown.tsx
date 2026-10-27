import type { ReactNode } from "react";

/** The notes are Markdown with headings and bullets; that is all this renders. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {bullets.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(
        bullet[1]!.replace(/^\[ \]\s*/, "☐ ").replace(/^\[x\]\s*/i, "☑ "),
      );
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <h3 key={blocks.length} className="mt-4 text-base font-semibold">
          {heading[2]}
        </h3>,
      );
    } else {
      blocks.push(<p key={blocks.length}>{line.replace(/^_|_$/g, "")}</p>);
    }
  }
  flush();
  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}

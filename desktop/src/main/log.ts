// A main-process log file (userData/logs/main.log) plus the console. Never log tokens.

import { app } from "electron";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

let file: string | undefined;

function target(): string | undefined {
  if (file) return file;
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    file = join(dir, "main.log");
    try {
      if (statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.1`);
    } catch {
      // No file yet.
    }
  } catch {
    file = undefined;
  }
  return file;
}

export function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : p instanceof Error ? p.message : JSON.stringify(p))).join(" ")}`;
  console.log(line);
  const path = target();
  if (path) {
    try {
      appendFileSync(path, `${line}\n`);
    } catch {
      // The console has it.
    }
  }
}

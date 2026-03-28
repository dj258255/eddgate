import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TraceEvent } from "../types/index.js";

/**
 * Shared trace loader -- used by analyze, test, monitor, eval.
 * Single source of truth for JSONL parsing.
 */
export async function loadAllTraces(dir: string): Promise<TraceEvent[]> {
  const files = await readdir(dir).catch(() => []);
  const events: TraceEvent[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const content = await readFile(join(dir, file), "utf-8");
    for (const line of content.split("\n").filter(Boolean)) {
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch { /* skip invalid */ }
    }
  }

  return events;
}

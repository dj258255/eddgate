import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

const MEMORY_DIR = ".eddgate/memory";
const MAX_MEMORIES = 50; // Keep last 50 entries

export interface RunMemoryEntry {
  timestamp: string;
  workflowName: string;
  traceId: string;
  status: "success" | "failed" | "partial";
  totalTokens: number;
  totalCost: number;
  durationMs: number;
  stepResults: Array<{
    stepId: string;
    status: string;
    evalScore?: number;
    error?: string;
  }>;
  // Learned insights
  insights: string[];
}

export interface RunMemoryContext {
  recentFailures: string[]; // "step X failed N times: reason"
  recentSuccesses: string[]; // "step X passed consistently"
  avgScores: Record<string, number>; // stepId -> avg eval score
  totalRuns: number;
  successRate: number;
  topIssues: string[]; // most common failure patterns
}

/**
 * Save a run result to memory.
 */
export async function saveRunMemory(entry: RunMemoryEntry): Promise<void> {
  const dir = resolve(MEMORY_DIR);
  await mkdir(dir, { recursive: true });

  const filename = `${entry.timestamp.replace(/[:.]/g, "-")}_${entry.workflowName}.json`;
  await writeFile(join(dir, filename), JSON.stringify(entry, null, 2), "utf-8");

  // Prune old entries
  await pruneMemory(dir);
}

/**
 * Load memory context for a workflow.
 * Returns aggregated insights from recent runs.
 */
export async function loadRunMemory(
  workflowName?: string,
): Promise<RunMemoryContext> {
  const dir = resolve(MEMORY_DIR);
  let files: string[];
  try {
    files = (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    return emptyContext();
  }

  const entries: RunMemoryEntry[] = [];
  for (const file of files.slice(0, MAX_MEMORIES)) {
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const entry = JSON.parse(raw) as RunMemoryEntry;
      if (!workflowName || entry.workflowName === workflowName) {
        entries.push(entry);
      }
    } catch {
      /* skip corrupt files */
    }
  }

  if (entries.length === 0) return emptyContext();

  return buildContext(entries);
}

/**
 * Build a concise context summary from memory entries.
 * This gets injected into the system prompt.
 */
export function buildMemoryPrompt(ctx: RunMemoryContext): string | undefined {
  if (ctx.totalRuns === 0) return undefined;

  const lines: string[] = [
    `## Previous Run Insights (${ctx.totalRuns} runs, ${(ctx.successRate * 100).toFixed(0)}% success rate)`,
  ];

  if (ctx.topIssues.length > 0) {
    lines.push("", "Known issues from previous runs:");
    for (const issue of ctx.topIssues.slice(0, 5)) {
      lines.push(`- ${issue}`);
    }
  }

  if (ctx.recentFailures.length > 0) {
    lines.push("", "Recent failures to avoid:");
    for (const f of ctx.recentFailures.slice(0, 3)) {
      lines.push(`- ${f}`);
    }
  }

  if (Object.keys(ctx.avgScores).length > 0) {
    lines.push("", "Average quality scores by step:");
    for (const [step, score] of Object.entries(ctx.avgScores)) {
      const indicator =
        score >= 0.7 ? "good" : score >= 0.4 ? "needs attention" : "problematic";
      lines.push(`- ${step}: ${score.toFixed(2)} (${indicator})`);
    }
  }

  return lines.join("\n");
}

function buildContext(entries: RunMemoryEntry[]): RunMemoryContext {
  const successCount = entries.filter((e) => e.status === "success").length;

  // Aggregate step failures
  const stepFailures = new Map<string, { count: number; errors: string[] }>();
  const stepScores = new Map<string, number[]>();

  for (const entry of entries) {
    for (const step of entry.stepResults) {
      if (step.status === "failed" && step.error) {
        const existing = stepFailures.get(step.stepId) ?? {
          count: 0,
          errors: [],
        };
        existing.count++;
        if (existing.errors.length < 5) existing.errors.push(step.error);
        stepFailures.set(step.stepId, existing);
      }
      if (step.evalScore !== undefined) {
        const scores = stepScores.get(step.stepId) ?? [];
        scores.push(step.evalScore);
        stepScores.set(step.stepId, scores);
      }
    }
  }

  const recentFailures: string[] = [];
  for (const [stepId, info] of stepFailures) {
    const uniqueErrors = [...new Set(info.errors)].slice(0, 2);
    recentFailures.push(
      `${stepId} failed ${info.count}x: ${uniqueErrors.join("; ")}`,
    );
  }

  const recentSuccesses: string[] = [];
  for (const entry of entries.slice(0, 3)) {
    if (entry.status === "success") {
      recentSuccesses.push(
        `${entry.workflowName} succeeded (${entry.durationMs}ms, $${entry.totalCost.toFixed(4)})`,
      );
    }
  }

  const avgScores: Record<string, number> = {};
  for (const [stepId, scores] of stepScores) {
    avgScores[stepId] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Top issues by frequency
  const topIssues = [...stepFailures.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(
      ([stepId, info]) =>
        `${stepId}: ${info.count} failures (${info.errors[0]?.slice(0, 80)})`,
    );

  return {
    recentFailures,
    recentSuccesses,
    avgScores,
    totalRuns: entries.length,
    successRate: entries.length > 0 ? successCount / entries.length : 0,
    topIssues,
  };
}

function emptyContext(): RunMemoryContext {
  return {
    recentFailures: [],
    recentSuccesses: [],
    avgScores: {},
    totalRuns: 0,
    successRate: 0,
    topIssues: [],
  };
}

async function pruneMemory(dir: string): Promise<void> {
  try {
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length > MAX_MEMORIES) {
      const toDelete = files.slice(0, files.length - MAX_MEMORIES);
      for (const f of toDelete) {
        await unlink(join(dir, f));
      }
    }
  } catch {
    /* ignore */
  }
}

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import type { TraceEvent, EvaluationResult, ValidationResult } from "../../types/index.js";

interface TestOptions {
  dir: string;
  scenarios?: string;
  snapshotDir?: string;
}

// ─── Snapshot ────────────────────────────────────────────────

interface BehaviorSnapshot {
  timestamp: string;
  traceId: string;
  steps: StepBehavior[];
}

interface StepBehavior {
  stepId: string;
  status: string;
  tokens: number;
  durationMs: number;
  validationPassed?: boolean;
  evalScore?: number;
  outputHash: string;    // hash of output for diff
  outputPreview: string; // first 200 chars
}

// ─── Diff ────────────────────────────────────────────────────

interface BehaviorDiff {
  stepId: string;
  field: string;
  before: string;
  after: string;
  severity: "regression" | "improvement" | "change";
}

// ─── Main ────────────────────────────────────────────────────

export async function testCommand(
  action: string,
  options: TestOptions,
): Promise<void> {
  switch (action) {
    case "snapshot":
      await takeSnapshot(options);
      break;
    case "diff":
      await runDiff(options);
      break;
    case "list":
      await listSnapshots(options);
      break;
    default:
      console.error(chalk.red(`Unknown action: ${action}. Use: snapshot, diff, list`));
      process.exit(1);
  }
}

// ─── Snapshot: Capture current behavior ──────────────────────

async function takeSnapshot(options: TestOptions): Promise<void> {
  const tracesDir = resolve(options.dir);
  const snapshotDir = resolve(options.snapshotDir ?? "./.eddgate/snapshots");
  await mkdir(snapshotDir, { recursive: true });

  const events = await loadAllTraces(tracesDir);
  if (events.length === 0) {
    console.log(chalk.dim("\nNo traces to snapshot. Run a workflow first.\n"));
    return;
  }

  // Group by traceId
  const byTrace = groupByTraceId(events);

  const snapshots: BehaviorSnapshot[] = [];

  for (const [traceId, traceEvents] of byTrace) {
    const snapshot = buildSnapshot(traceId, traceEvents);
    snapshots.push(snapshot);
  }

  const filename = `snapshot_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  const filepath = join(snapshotDir, filename);

  await writeFile(filepath, JSON.stringify(snapshots, null, 2), "utf-8");

  console.log(chalk.bold("\neddgate test snapshot\n"));
  console.log(`  Captured ${snapshots.length} workflow run(s)`);
  console.log(`  Saved: ${filepath}`);
  console.log(chalk.dim(`\n  After making changes, run: eddgate test diff\n`));
}

// ─── Diff: Compare current traces against latest snapshot ────

async function runDiff(options: TestOptions): Promise<void> {
  const tracesDir = resolve(options.dir);
  const snapshotDir = resolve(options.snapshotDir ?? "./.eddgate/snapshots");

  // Load latest snapshot
  const snapshotFiles = await readdir(snapshotDir).catch(() => []);
  const sorted = snapshotFiles.filter((f) => f.endsWith(".json")).sort().reverse();

  if (sorted.length === 0) {
    console.log(chalk.red("\nNo snapshots found. Run: eddgate test snapshot\n"));
    process.exit(1);
  }

  const latestPath = join(snapshotDir, sorted[0]);
  const baseline: BehaviorSnapshot[] = JSON.parse(
    await readFile(latestPath, "utf-8"),
  );

  // Load current traces
  const events = await loadAllTraces(tracesDir);
  const byTrace = groupByTraceId(events);

  const current: BehaviorSnapshot[] = [];
  for (const [traceId, traceEvents] of byTrace) {
    // Skip traces that are in the snapshot (only diff new ones)
    if (!baseline.some((s) => s.traceId === traceId)) {
      current.push(buildSnapshot(traceId, traceEvents));
    }
  }

  if (current.length === 0) {
    console.log(chalk.dim("\nNo new traces since last snapshot. Run a workflow first.\n"));
    return;
  }

  console.log(chalk.bold("\neddgate test diff\n"));
  console.log(chalk.dim(`  Baseline: ${sorted[0]} (${baseline.length} runs)`));
  console.log(chalk.dim(`  Current:  ${current.length} new run(s)\n`));

  // Compare behavior
  const diffs = compareBehavior(baseline, current);

  if (diffs.length === 0) {
    console.log(chalk.green("  No behavioral changes detected.\n"));
    return;
  }

  const regressions = diffs.filter((d) => d.severity === "regression");
  const improvements = diffs.filter((d) => d.severity === "improvement");
  const changes = diffs.filter((d) => d.severity === "change");

  if (regressions.length > 0) {
    console.log(chalk.red(`  REGRESSIONS (${regressions.length}):\n`));
    for (const d of regressions) {
      console.log(chalk.red(`    ${d.stepId}.${d.field}`));
      console.log(chalk.red(`      before: ${d.before}`));
      console.log(chalk.red(`      after:  ${d.after}`));
      console.log();
    }
  }

  if (improvements.length > 0) {
    console.log(chalk.green(`  IMPROVEMENTS (${improvements.length}):\n`));
    for (const d of improvements) {
      console.log(chalk.green(`    ${d.stepId}.${d.field}`));
      console.log(chalk.green(`      before: ${d.before}`));
      console.log(chalk.green(`      after:  ${d.after}`));
      console.log();
    }
  }

  if (changes.length > 0) {
    console.log(chalk.yellow(`  CHANGES (${changes.length}):\n`));
    for (const d of changes) {
      console.log(chalk.yellow(`    ${d.stepId}.${d.field}`));
      console.log(chalk.dim(`      before: ${d.before}`));
      console.log(chalk.dim(`      after:  ${d.after}`));
      console.log();
    }
  }

  // Summary
  console.log(chalk.bold("  Summary:"));
  console.log(`    Regressions:  ${regressions.length}`);
  console.log(`    Improvements: ${improvements.length}`);
  console.log(`    Changes:      ${changes.length}`);

  // Show split view if TTY
  if (process.stdout.isTTY && diffs.length > 0) {
    try {
      const { showDiffView } = await import("../split-view.js");
      await showDiffView(diffs);
    } catch { /* split view not available */ }
  }

  if (regressions.length > 0) {
    console.log(chalk.red("\n  FAIL: Regressions detected.\n"));
    process.exit(1);
  } else {
    console.log(chalk.green("\n  PASS: No regressions.\n"));
  }
}

// ─── List Snapshots ──────────────────────────────────────────

async function listSnapshots(options: TestOptions): Promise<void> {
  const snapshotDir = resolve(options.snapshotDir ?? "./.eddgate/snapshots");
  const files = await readdir(snapshotDir).catch(() => []);
  const snapshots = files.filter((f) => f.endsWith(".json")).sort().reverse();

  if (snapshots.length === 0) {
    console.log(chalk.dim("\nNo snapshots found.\n"));
    return;
  }

  console.log(chalk.bold(`\nSnapshots (${snapshotDir}):\n`));
  for (const file of snapshots) {
    try {
      const content = JSON.parse(await readFile(join(snapshotDir, file), "utf-8"));
      const count = Array.isArray(content) ? content.length : 0;
      console.log(`  ${file} (${count} runs)`);
    } catch {
      console.log(`  ${file}`);
    }
  }
  console.log();
}

// ─── Behavior Comparison ─────────────────────────────────────

function compareBehavior(
  baseline: BehaviorSnapshot[],
  current: BehaviorSnapshot[],
): BehaviorDiff[] {
  const diffs: BehaviorDiff[] = [];

  // Aggregate baseline behavior per step
  const baselineByStep = aggregateByStep(baseline);
  const currentByStep = aggregateByStep(current);

  for (const [stepId, currAvg] of currentByStep) {
    const baseAvg = baselineByStep.get(stepId);
    if (!baseAvg) continue; // New step, not a regression

    // Compare eval scores
    if (currAvg.avgEvalScore !== undefined && baseAvg.avgEvalScore !== undefined) {
      const delta = currAvg.avgEvalScore - baseAvg.avgEvalScore;
      if (Math.abs(delta) > 0.05) {
        diffs.push({
          stepId,
          field: "evalScore",
          before: baseAvg.avgEvalScore.toFixed(2),
          after: currAvg.avgEvalScore.toFixed(2),
          severity: delta < -0.05 ? "regression" : "improvement",
        });
      }
    }

    // Compare validation pass rate
    if (baseAvg.validationPassRate !== undefined && currAvg.validationPassRate !== undefined) {
      const delta = currAvg.validationPassRate - baseAvg.validationPassRate;
      if (Math.abs(delta) > 0.1) {
        diffs.push({
          stepId,
          field: "validationPassRate",
          before: `${(baseAvg.validationPassRate * 100).toFixed(0)}%`,
          after: `${(currAvg.validationPassRate * 100).toFixed(0)}%`,
          severity: delta < -0.1 ? "regression" : "improvement",
        });
      }
    }

    // Compare token usage (>30% change)
    if (baseAvg.avgTokens > 0) {
      const ratio = currAvg.avgTokens / baseAvg.avgTokens;
      if (ratio > 1.3 || ratio < 0.7) {
        diffs.push({
          stepId,
          field: "tokens",
          before: baseAvg.avgTokens.toLocaleString(),
          after: currAvg.avgTokens.toLocaleString(),
          severity: ratio > 1.5 ? "regression" : "change",
        });
      }
    }

    // Compare output content (hash change)
    if (currAvg.outputHash !== baseAvg.outputHash) {
      diffs.push({
        stepId,
        field: "output",
        before: baseAvg.outputPreview,
        after: currAvg.outputPreview,
        severity: "change",
      });
    }
  }

  return diffs;
}

interface StepAggregate {
  avgEvalScore?: number;
  validationPassRate?: number;
  avgTokens: number;
  outputHash: string;
  outputPreview: string;
}

function aggregateByStep(snapshots: BehaviorSnapshot[]): Map<string, StepAggregate> {
  const result = new Map<string, StepAggregate>();
  const stepData = new Map<string, StepBehavior[]>();

  for (const snap of snapshots) {
    for (const step of snap.steps) {
      const arr = stepData.get(step.stepId) ?? [];
      arr.push(step);
      stepData.set(step.stepId, arr);
    }
  }

  for (const [stepId, behaviors] of stepData) {
    const evalScores = behaviors.filter((b) => b.evalScore !== undefined).map((b) => b.evalScore!);
    const validations = behaviors.filter((b) => b.validationPassed !== undefined);
    const tokens = behaviors.map((b) => b.tokens);

    result.set(stepId, {
      avgEvalScore: evalScores.length > 0
        ? evalScores.reduce((s, x) => s + x, 0) / evalScores.length
        : undefined,
      validationPassRate: validations.length > 0
        ? validations.filter((b) => b.validationPassed).length / validations.length
        : undefined,
      avgTokens: tokens.reduce((s, x) => s + x, 0) / Math.max(1, tokens.length),
      outputHash: behaviors[behaviors.length - 1]?.outputHash ?? "",
      outputPreview: behaviors[behaviors.length - 1]?.outputPreview ?? "",
    });
  }

  return result;
}

// ─── Snapshot Builder ────────────────────────────────────────

function buildSnapshot(traceId: string, events: TraceEvent[]): BehaviorSnapshot {
  const steps: StepBehavior[] = [];
  const stepEnds = events.filter((e) => e.type === "step_end" && e.stepId !== "__workflow__");
  const evals = events.filter((e) => e.type === "evaluation");
  const validations = events.filter((e) => e.type === "validation");
  const llmCalls = events.filter((e) => e.type === "llm_call");

  for (const stepEnd of stepEnds) {
    const stepEval = evals.find((e) => e.stepId === stepEnd.stepId);
    const stepVal = validations.find((e) => e.stepId === stepEnd.stepId);
    const stepLlm = llmCalls.filter((e) => e.stepId === stepEnd.stepId);

    const tokens = stepLlm.reduce(
      (s, e) => s + (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0), 0,
    );

    const output = stepEnd.data.output ?? "";
    const outputStr = typeof output === "string" ? output : JSON.stringify(output);

    steps.push({
      stepId: stepEnd.stepId,
      status: "completed",
      tokens,
      durationMs: stepEnd.data.latencyMs ?? 0,
      validationPassed: stepVal?.data.validationResult
        ? (stepVal.data.validationResult as ValidationResult).passed
        : undefined,
      evalScore: stepEval?.data.evaluationResult
        ? (stepEval.data.evaluationResult as EvaluationResult).score
        : undefined,
      outputHash: simpleHash(outputStr),
      outputPreview: outputStr.slice(0, 200),
    });
  }

  return {
    timestamp: new Date().toISOString(),
    traceId,
    steps,
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

// ─── Helpers ─────────────────────────────────────────────────

function groupByTraceId(events: TraceEvent[]): Map<string, TraceEvent[]> {
  const map = new Map<string, TraceEvent[]>();
  for (const e of events) {
    const arr = map.get(e.traceId) ?? [];
    arr.push(e);
    map.set(e.traceId, arr);
  }
  return map;
}

async function loadAllTraces(dir: string): Promise<TraceEvent[]> {
  const files = await readdir(dir).catch(() => []);
  const events: TraceEvent[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const content = await readFile(join(dir, file), "utf-8");
    for (const line of content.split("\n").filter(Boolean)) {
      try { events.push(JSON.parse(line) as TraceEvent); } catch { /* skip */ }
    }
  }
  return events;
}

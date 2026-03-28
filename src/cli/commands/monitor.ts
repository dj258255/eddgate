import { loadAllTraces } from "../../trace/trace-loader.js";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import type { TraceEvent } from "../../types/index.js";

interface MonitorOptions {
  dir: string;
  period: string;
}

export async function monitorCommand(
  action: string,
  options: MonitorOptions,
): Promise<void> {
  const tracesDir = resolve(options.dir);
  const events = await loadAllTraces(tracesDir);

  if (events.length === 0) {
    console.log(chalk.dim("\nNo traces found. Run a workflow first.\n"));
    return;
  }

  const periodMs = parsePeriod(options.period);
  const cutoff = Date.now() - periodMs;
  const filtered = events.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoff,
  );

  switch (action) {
    case "status":
      renderStatus(filtered, options.period);
      break;
    case "cost":
      renderCost(filtered, options.period);
      break;
    case "quality":
      renderQuality(filtered, options.period);
      break;
    default:
      console.error(chalk.red(`Unknown action: ${action}. Use: status, cost, quality`));
      process.exit(1);
  }
}

function renderStatus(events: TraceEvent[], period: string): void {
  const workflows = events.filter((e) => e.type === "workflow_end");
  const steps = events.filter((e) => e.type === "step_end");
  const llmCalls = events.filter((e) => e.type === "llm_call");
  const errors = events.filter((e) => e.type === "error");
  const evals = events.filter((e) => e.type === "evaluation");

  const totalWorkflows = workflows.length;
  const successWorkflows = workflows.filter(
    (w) => w.data.output === "success",
  ).length;
  const successRate =
    totalWorkflows > 0
      ? ((successWorkflows / totalWorkflows) * 100).toFixed(1)
      : "N/A";

  const totalTokens = llmCalls.reduce(
    (s, e) => s + (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0),
    0,
  );
  const totalCost = llmCalls.reduce((s, e) => s + (e.data.cost ?? 0), 0);

  const latencies = workflows
    .map((w) => w.data.latencyMs ?? 0)
    .filter((l) => l > 0)
    .sort((a, b) => a - b);

  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  console.log(chalk.bold(`\neddgate monitor status (${period})\n`));

  console.log(`  Workflows:    ${totalWorkflows}`);
  console.log(`  Success rate: ${successRate}%`);
  console.log(`  Steps:        ${steps.length}`);
  console.log(`  LLM calls:    ${llmCalls.length}`);
  console.log(`  Errors:       ${errors.length}`);
  console.log(`  Evaluations:  ${evals.length}`);
  console.log();
  console.log(`  Tokens:       ${totalTokens.toLocaleString()}`);
  console.log(`  Cost:         $${totalCost.toFixed(4)}`);
  console.log(`  Latency p50:  ${formatMs(p50)}`);
  console.log(`  Latency p95:  ${formatMs(p95)}`);
  console.log();
}

function renderCost(events: TraceEvent[], period: string): void {
  const llmCalls = events.filter((e) => e.type === "llm_call");

  // Group by model
  const byModel = new Map<string, { calls: number; tokens: number; cost: number }>();
  for (const e of llmCalls) {
    const model = e.data.model ?? "unknown";
    const existing = byModel.get(model) ?? { calls: 0, tokens: 0, cost: 0 };
    existing.calls++;
    existing.tokens += (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0);
    existing.cost += e.data.cost ?? 0;
    byModel.set(model, existing);
  }

  // Group by step
  const byStep = new Map<string, { calls: number; tokens: number; cost: number }>();
  for (const e of llmCalls) {
    const existing = byStep.get(e.stepId) ?? { calls: 0, tokens: 0, cost: 0 };
    existing.calls++;
    existing.tokens += (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0);
    existing.cost += e.data.cost ?? 0;
    byStep.set(e.stepId, existing);
  }

  console.log(chalk.bold(`\neddgate monitor cost (${period})\n`));

  console.log(chalk.dim("  By model:"));
  console.log(
    `  ${"Model".padEnd(20)} ${"Calls".padEnd(8)} ${"Tokens".padEnd(12)} ${"Cost"}`,
  );
  console.log(`  ${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(10)}`);
  for (const [model, data] of byModel) {
    console.log(
      `  ${model.padEnd(20)} ${String(data.calls).padEnd(8)} ${data.tokens.toLocaleString().padEnd(12)} $${data.cost.toFixed(4)}`,
    );
  }

  console.log(chalk.dim("\n  By step:"));
  console.log(
    `  ${"Step".padEnd(25)} ${"Calls".padEnd(8)} ${"Tokens".padEnd(12)} ${"Cost"}`,
  );
  console.log(`  ${"─".repeat(25)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(10)}`);
  for (const [step, data] of byStep) {
    console.log(
      `  ${step.padEnd(25)} ${String(data.calls).padEnd(8)} ${data.tokens.toLocaleString().padEnd(12)} $${data.cost.toFixed(4)}`,
    );
  }
  console.log();
}

function renderQuality(events: TraceEvent[], period: string): void {
  const evals = events.filter(
    (e) => e.type === "evaluation" && e.data.evaluationResult,
  );

  if (evals.length === 0) {
    console.log(chalk.dim("\nNo evaluation data found.\n"));
    return;
  }

  // Group by step
  const byStep = new Map<string, number[]>();
  for (const e of evals) {
    const scores = byStep.get(e.stepId) ?? [];
    scores.push(e.data.evaluationResult!.score);
    byStep.set(e.stepId, scores);
  }

  console.log(chalk.bold(`\neddgate monitor quality (${period})\n`));

  console.log(
    `  ${"Step".padEnd(25)} ${"Avg".padEnd(8)} ${"Min".padEnd(8)} ${"Max".padEnd(8)} ${"Runs"}`,
  );
  console.log(`  ${"─".repeat(25)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(8)} ${"─".repeat(5)}`);

  for (const [step, scores] of byStep) {
    const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const color = avg >= 0.7 ? chalk.green : avg >= 0.4 ? chalk.yellow : chalk.red;

    console.log(
      `  ${step.padEnd(25)} ${color(avg.toFixed(2).padEnd(8))} ${min.toFixed(2).padEnd(8)} ${max.toFixed(2).padEnd(8)} ${scores.length}`,
    );
  }
  console.log();
}

// Helpers

function parsePeriod(period: string): number {
  const match = period.match(/^(\d+)([dhwm])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d

  const value = parseInt(match[1]);
  switch (match[2]) {
    case "d": return value * 24 * 60 * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "w": return value * 7 * 24 * 60 * 60 * 1000;
    case "m": return value * 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}


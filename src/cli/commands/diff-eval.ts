import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import type { TraceEvent } from "../../types/index.js";

interface DiffEvalOptions {
  before: string;
  after: string;
  dir: string;
}

interface StepScore {
  stepId: string;
  score: number;
  evalType: string;
}

export async function diffEvalCommand(
  workflow: string,
  options: DiffEvalOptions,
): Promise<void> {
  try {
    console.log(chalk.bold(`\neddgate diff-eval: ${workflow}\n`));
    console.log(chalk.dim(`  before: ${options.before}`));
    console.log(chalk.dim(`  after:  ${options.after}`));
    console.log();

    // Get changed files between commits
    const changedFiles = getChangedFiles(options.before, options.after);
    const promptChanges = changedFiles.filter(
      (f) => f.includes("prompts/") || f.includes("workflows/"),
    );

    if (promptChanges.length === 0) {
      console.log(chalk.dim("No prompt or workflow changes detected between commits."));
      return;
    }

    console.log(chalk.bold("Changed files:"));
    for (const f of promptChanges) {
      console.log(`  ${f}`);
    }
    console.log();

    // Load traces from before and after
    const tracesDir = resolve(options.dir);
    const allTraces = await loadAllTraces(tracesDir);

    if (allTraces.length === 0) {
      console.log(
        chalk.yellow("No traces found. Run the workflow first to generate traces."),
      );
      return;
    }

    // Extract evaluation scores
    const scores = extractEvalScores(allTraces);

    if (scores.length === 0) {
      console.log(
        chalk.dim("No evaluation scores found in traces."),
      );
      return;
    }

    // Group by step and show summary
    const byStep = new Map<string, StepScore[]>();
    for (const s of scores) {
      const arr = byStep.get(s.stepId) ?? [];
      arr.push(s);
      byStep.set(s.stepId, arr);
    }

    console.log(chalk.bold("Evaluation scores from traces:\n"));
    console.log(
      `  ${"Step".padEnd(25)} ${"Type".padEnd(15)} ${"Avg Score".padEnd(12)} ${"Runs"}`,
    );
    console.log(`  ${"─".repeat(25)} ${"─".repeat(15)} ${"─".repeat(12)} ${"─".repeat(5)}`);

    for (const [stepId, stepScores] of byStep) {
      const avg =
        stepScores.reduce((s, x) => s + x.score, 0) / stepScores.length;
      const evalType = stepScores[0].evalType;

      const scoreStr = avg.toFixed(2);
      const color = avg >= 0.7 ? chalk.green : avg >= 0.4 ? chalk.yellow : chalk.red;

      console.log(
        `  ${stepId.padEnd(25)} ${evalType.padEnd(15)} ${color(scoreStr.padEnd(12))} ${stepScores.length}`,
      );
    }

    console.log(
      chalk.dim(
        "\nTip: Run the workflow again after prompt changes, then compare traces.",
      ),
    );
  } catch (err) {
    console.error(
      chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }
}

function getChangedFiles(before: string, after: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", before, after],
      { encoding: "utf-8", timeout: 5000 },
    );
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function loadAllTraces(dir: string): Promise<TraceEvent[]> {
  const files = await readdir(dir).catch(() => []);
  const events: TraceEvent[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const content = await readFile(join(dir, file), "utf-8");
    for (const line of content.split("\n").filter(Boolean)) {
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch {
        // skip invalid lines
      }
    }
  }

  return events;
}

function extractEvalScores(events: TraceEvent[]): StepScore[] {
  const scores: StepScore[] = [];

  for (const event of events) {
    if (event.type === "evaluation" && event.data.evaluationResult) {
      scores.push({
        stepId: event.stepId,
        score: event.data.evaluationResult.score,
        evalType: event.data.evaluationResult.action ?? "unknown",
      });
    }
  }

  return scores;
}

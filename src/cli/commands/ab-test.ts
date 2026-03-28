import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import { loadWorkflow, loadPrompt } from "../../config/loader.js";
import { executeWorkflow } from "../../core/workflow-engine.js";
import { TraceEmitter } from "../../trace/emitter.js";
import type {
  ABVariant,
  ABTestResult,
  ABComparison,
  WorkflowResult,
} from "../../types/index.js";

interface ABTestOptions {
  workflow: string;
  promptA: string;
  promptB: string;
  input: string;
  iterations: number;
  model?: string;
  workflowsDir: string;
  promptsDir: string;
}

export async function abTestCommand(options: ABTestOptions): Promise<void> {
  const workflowPath = resolve(options.workflowsDir, `${options.workflow}.yaml`);
  const workflow = await loadWorkflow(workflowPath);

  let inputText: string;
  try {
    inputText = await readFile(resolve(options.input), "utf-8");
  } catch {
    inputText = options.input;
  }

  if (options.model) {
    workflow.config.defaultModel = options.model;
  }

  console.log(chalk.bold(`\nA/B Prompt Test: ${workflow.name}`));
  console.log(chalk.dim(`  Variant A: ${options.promptA}`));
  console.log(chalk.dim(`  Variant B: ${options.promptB}`));
  console.log(chalk.dim(`  Iterations: ${options.iterations}`));
  console.log();

  // Run variant A
  console.log(chalk.cyan("--- Variant A ---\n"));
  const resultA = await runVariant(
    "A",
    workflow,
    options.promptA,
    options.promptsDir,
    inputText,
    options.iterations,
  );

  // Run variant B
  console.log(chalk.yellow("\n--- Variant B ---\n"));
  const resultB = await runVariant(
    "B",
    workflow,
    options.promptB,
    options.promptsDir,
    inputText,
    options.iterations,
  );

  // Compare
  const comparison = compare(options, resultA, resultB);
  printComparison(comparison);
}

async function runVariant(
  variant: ABVariant,
  workflow: any,
  promptFile: string,
  promptsDir: string,
  input: string,
  iterations: number,
): Promise<ABTestResult> {
  const runs: ABTestResult["runs"] = [];

  for (let i = 0; i < iterations; i++) {
    console.log(chalk.dim(`  [${variant}] iteration ${i + 1}/${iterations}...`));

    // Load role prompts with the variant prompt file overriding the first role
    const rolePrompts = new Map<string, string>();
    for (const step of workflow.steps) {
      const role = step.context.identity.role;
      if (!rolePrompts.has(role)) {
        try {
          const promptPath = join(resolve(promptsDir), `${role}.md`);
          rolePrompts.set(role, await loadPrompt(promptPath));
        } catch { /* */ }
      }
    }

    // Override with the variant prompt (applies to the first role or specified file)
    try {
      const variantPrompt = await readFile(resolve(promptFile), "utf-8");
      // Extract role name from filename (e.g., "link_researcher.v1.md" -> "link_researcher")
      const roleName = promptFile.replace(/\.v[0-9]+\.md$/, "").replace(/\.md$/, "").split("/").pop()!;
      rolePrompts.set(roleName, variantPrompt);
    } catch (err) {
      console.log(chalk.red(`  Cannot load prompt: ${promptFile} -- ${err}`));
    }

    const tracer = new TraceEmitter();
    let result: WorkflowResult;
    try {
      result = await executeWorkflow({
        workflow: { ...workflow },
        input,
        rolePrompts,
        tracer,
      });
    } catch {
      runs.push({
        iteration: i + 1,
        status: "error",
        evalScores: {},
        totalTokens: 0,
        totalCost: 0,
        durationMs: 0,
      });
      continue;
    }

    // Extract eval scores per step
    const evalScores: Record<string, number> = {};
    for (const step of result.steps) {
      if (step.evaluation) {
        evalScores[step.stepId] = step.evaluation.score;
      }
    }

    runs.push({
      iteration: i + 1,
      status: result.status,
      evalScores,
      totalTokens: result.totalTokens.input + result.totalTokens.output,
      totalCost: result.totalCostEstimate,
      durationMs: result.totalDurationMs,
    });

    const avgScore = Object.values(evalScores).length > 0
      ? Object.values(evalScores).reduce((a, b) => a + b, 0) / Object.values(evalScores).length
      : 0;
    console.log(
      `  [${variant}] #${i + 1}: ${result.status} score=${avgScore.toFixed(2)} ` +
      `tokens=${(result.totalTokens.input + result.totalTokens.output).toLocaleString()} ` +
      `cost=$${result.totalCostEstimate.toFixed(4)} ` +
      `time=${(result.totalDurationMs / 1000).toFixed(1)}s`,
    );
  }

  // Aggregate
  const successRuns = runs.filter((r) => r.status === "success" || r.status === "partial");
  const allScores = successRuns.flatMap((r) => Object.values(r.evalScores));
  const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
  const avgTokens = successRuns.length > 0
    ? successRuns.reduce((s, r) => s + r.totalTokens, 0) / successRuns.length : 0;
  const avgCost = successRuns.length > 0
    ? successRuns.reduce((s, r) => s + r.totalCost, 0) / successRuns.length : 0;
  const avgDuration = successRuns.length > 0
    ? successRuns.reduce((s, r) => s + r.durationMs, 0) / successRuns.length : 0;

  return { variant, runs, avgScore, avgTokens: Math.round(avgTokens), avgCost, avgDurationMs: avgDuration };
}

function compare(options: ABTestOptions, a: ABTestResult, b: ABTestResult): ABComparison {
  const scoreDelta = b.avgScore - a.avgScore;
  const costDelta = b.avgCost - a.avgCost;
  const tokenDelta = b.avgTokens - a.avgTokens;

  // Winner: higher score wins. If scores within 0.02, check cost.
  let winner: ABVariant | "tie" = "tie";
  if (Math.abs(scoreDelta) > 0.02) {
    winner = scoreDelta > 0 ? "B" : "A";
  } else if (Math.abs(costDelta) > 0.001) {
    winner = costDelta < 0 ? "B" : "A"; // lower cost wins when scores are close
  }

  return {
    config: {
      workflow: options.workflow,
      promptA: options.promptA,
      promptB: options.promptB,
      input: options.input,
      iterations: options.iterations,
    },
    resultA: a,
    resultB: b,
    winner,
    scoreDelta,
    costDelta,
    tokenDelta,
  };
}

function printComparison(c: ABComparison): void {
  console.log(chalk.bold("\n===== A/B Test Results =====\n"));

  const header = `  ${"Metric".padEnd(20)} ${"Variant A".padEnd(14)} ${"Variant B".padEnd(14)} ${"Delta"}`;
  const sep = `  ${"─".repeat(20)} ${"─".repeat(14)} ${"─".repeat(14)} ${"─".repeat(14)}`;

  console.log(header);
  console.log(sep);

  const rows = [
    ["Avg Score", c.resultA.avgScore.toFixed(3), c.resultB.avgScore.toFixed(3), fmtDelta(c.scoreDelta, true)],
    ["Avg Tokens", c.resultA.avgTokens.toLocaleString(), c.resultB.avgTokens.toLocaleString(), fmtDelta(c.tokenDelta, false)],
    ["Avg Cost", `$${c.resultA.avgCost.toFixed(4)}`, `$${c.resultB.avgCost.toFixed(4)}`, fmtDelta(c.costDelta, false)],
    ["Avg Time", `${(c.resultA.avgDurationMs / 1000).toFixed(1)}s`, `${(c.resultB.avgDurationMs / 1000).toFixed(1)}s`, fmtDelta((c.resultB.avgDurationMs - c.resultA.avgDurationMs) / 1000, false) + "s"],
    ["Runs", String(c.resultA.runs.length), String(c.resultB.runs.length), "-"],
    ["Success", String(c.resultA.runs.filter((r) => r.status === "success").length), String(c.resultB.runs.filter((r) => r.status === "success").length), "-"],
  ];

  for (const [metric, a, b, delta] of rows) {
    console.log(`  ${metric.padEnd(20)} ${a.padEnd(14)} ${b.padEnd(14)} ${delta}`);
  }

  console.log();

  if (c.winner === "tie") {
    console.log(chalk.yellow("  Result: TIE (scores within 0.02 margin, similar cost)"));
  } else {
    const winColor = c.winner === "A" ? chalk.cyan : chalk.yellow;
    console.log(winColor(`  Winner: Variant ${c.winner}`));
    if (c.scoreDelta !== 0) {
      console.log(chalk.dim(`  Score advantage: ${Math.abs(c.scoreDelta).toFixed(3)}`));
    }
  }
  console.log();
}

function fmtDelta(delta: number, higherIsBetter: boolean): string {
  const sign = delta > 0 ? "+" : "";
  const formatted = `${sign}${delta.toFixed(3)}`;
  if (Math.abs(delta) < 0.001) return chalk.gray(formatted);
  if ((delta > 0 && higherIsBetter) || (delta < 0 && !higherIsBetter)) {
    return chalk.green(formatted);
  }
  return chalk.red(formatted);
}

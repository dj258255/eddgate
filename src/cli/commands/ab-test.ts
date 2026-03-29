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

/* ------------------------------------------------------------------ */
/*  Welch's t-test helpers (no external dependency)                    */
/* ------------------------------------------------------------------ */

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** Welch's t-test -- returns { t, df, pValue } */
function welchTTest(
  a: number[],
  b: number[],
): { t: number; df: number; pValue: number } {
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 || nB < 2) return { t: 0, df: 0, pValue: 1 };

  const mA = mean(a);
  const mB = mean(b);
  const vA = variance(a);
  const vB = variance(b);

  const seA = vA / nA;
  const seB = vB / nB;
  const seDiff = Math.sqrt(seA + seB);

  if (seDiff === 0) return { t: 0, df: nA + nB - 2, pValue: 1 };

  const t = (mB - mA) / seDiff;

  // Welch-Satterthwaite degrees of freedom
  const df = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));

  // Two-tailed p-value via regularized incomplete beta function approximation
  const pValue = tDistPValue(Math.abs(t), df);

  return { t, df, pValue };
}

/**
 * Approximate two-tailed p-value for Student's t distribution.
 * Uses the regularized incomplete beta function approximation.
 */
function tDistPValue(absT: number, df: number): number {
  // Transform to beta distribution: x = df / (df + t^2)
  const x = df / (df + absT * absT);
  // P(|T| > t) = I_x(df/2, 1/2)  (regularized incomplete beta)
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

/**
 * Regularized incomplete beta function I_x(a, b) via continued fraction
 * (Lentz's method). Accurate enough for p-value estimation.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry relation when x > (a+1)/(a+b+2) for better convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(
    Math.log(x) * a + Math.log(1 - x) * b - lnBeta,
  ) / a;

  // Lentz continued fraction
  let f = 1;
  let c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= 200; m++) {
    // even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    // odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return front * f;
}

/** Lanczos approximation for ln(Gamma(x)) */
function lnGamma(x: number): number {
  const coef = [
    76.18009172947146, -86.50532032941678, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of coef) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Confidence interval for difference of means (Welch) */
function confidenceInterval(
  a: number[],
  b: number[],
  confidence: number = 0.95,
): [number, number] {
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 || nB < 2) return [0, 0];

  const diff = mean(b) - mean(a);
  const se = Math.sqrt(variance(a) / nA + variance(b) / nB);

  // Use t critical value approximation for the given confidence level
  const df = welchTTest(a, b).df;
  const alpha = 1 - confidence;
  // Approximate t critical value using normal approximation for large df,
  // or a simple lookup for common case (95% CI)
  const tCrit = tCriticalValue(alpha / 2, df);

  return [diff - tCrit * se, diff + tCrit * se];
}

/**
 * Approximate inverse t-distribution (t critical value) via
 * Abramowitz & Stegun normal approximation adjusted for df.
 */
function tCriticalValue(alpha: number, df: number): number {
  // Normal quantile approximation (Beasley-Springer-Moro for alpha)
  const z = normalQuantile(alpha);
  // Cornish-Fisher expansion to approximate t from z
  const g1 = (z ** 3 + z) / 4;
  const g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
  const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
  return z + g1 / df + g2 / (df ** 2) + g3 / (df ** 3);
}

/** Rational approximation of the normal quantile (Abramowitz & Stegun 26.2.23) */
function normalQuantile(p: number): number {
  if (p >= 0.5) return -normalQuantile(1 - p);
  const t = Math.sqrt(-2 * Math.log(p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  return -(t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t));
}

/* ------------------------------------------------------------------ */
/*  Main command                                                       */
/* ------------------------------------------------------------------ */

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

  // Build interleaved schedule: ABABAB... to avoid systematic ordering bias
  const schedule: ABVariant[] = [];
  for (let i = 0; i < options.iterations; i++) {
    schedule.push("A", "B");
  }
  // Shuffle within pairs to further reduce ordering effects (Fisher-Yates on pairs)
  for (let i = schedule.length - 2; i > 0; i -= 2) {
    const j = 2 * Math.floor(Math.random() * (i / 2 + 1));
    [schedule[i], schedule[j]] = [schedule[j], schedule[i]];
    [schedule[i + 1], schedule[j + 1]] = [schedule[j + 1], schedule[i + 1]];
  }

  // Collect all workflow role names for validation
  const workflowRoles = new Set(
    workflow.steps.map((s: any) => s.context.identity.role as string),
  );

  const runsA: ABTestResult["runs"] = [];
  const runsB: ABTestResult["runs"] = [];

  for (let idx = 0; idx < schedule.length; idx++) {
    const variant = schedule[idx];
    const iterNum = variant === "A" ? runsA.length + 1 : runsB.length + 1;

    console.log(chalk.dim(`  [${variant}] iteration ${iterNum}/${options.iterations}...`));

    const promptFile = variant === "A" ? options.promptA : options.promptB;

    // Deep copy workflow to avoid cross-run mutation
    const workflowCopy = structuredClone(workflow);

    // Load role prompts with the variant prompt file overriding the matched role
    const rolePrompts = new Map<string, string>();
    for (const step of workflowCopy.steps) {
      const role = step.context.identity.role;
      if (!rolePrompts.has(role)) {
        try {
          const promptPath = join(resolve(options.promptsDir), `${role}.md`);
          rolePrompts.set(role, await loadPrompt(promptPath));
        } catch { /* */ }
      }
    }

    // Override with the variant prompt
    try {
      const variantPrompt = await readFile(resolve(promptFile), "utf-8");
      // Extract role name from filename (e.g., "link_researcher.v1.md" -> "link_researcher")
      const roleName = promptFile
        .replace(/\.v[0-9]+\.md$/, "")
        .replace(/\.md$/, "")
        .split("/")
        .pop()!;

      // Verify the extracted role name exists in the workflow
      if (!workflowRoles.has(roleName)) {
        console.log(
          chalk.yellow(
            `  WARNING: extracted role "${roleName}" from "${promptFile}" ` +
            `does not match any workflow role. Available roles: ${Array.from(workflowRoles).join(", ")}`,
          ),
        );
      }

      rolePrompts.set(roleName, variantPrompt);
    } catch (err) {
      console.log(chalk.red(`  Cannot load prompt: ${promptFile} -- ${err}`));
    }

    const tracer = new TraceEmitter();
    let result: WorkflowResult;
    try {
      result = await executeWorkflow({
        workflow: workflowCopy,
        input: inputText,
        rolePrompts,
        tracer,
      });
    } catch {
      const run = {
        iteration: iterNum,
        status: "error" as const,
        evalScores: {} as Record<string, number>,
        totalTokens: 0,
        totalCost: 0,
        durationMs: 0,
      };
      (variant === "A" ? runsA : runsB).push(run);
      continue;
    }

    // Extract eval scores per step
    const evalScores: Record<string, number> = {};
    for (const step of result.steps) {
      if (step.evaluation) {
        evalScores[step.stepId] = step.evaluation.score;
      }
    }

    const run = {
      iteration: iterNum,
      status: result.status,
      evalScores,
      totalTokens: result.totalTokens.input + result.totalTokens.output,
      totalCost: result.totalCostEstimate,
      durationMs: result.totalDurationMs,
    };
    (variant === "A" ? runsA : runsB).push(run);

    const avgScore = Object.values(evalScores).length > 0
      ? Object.values(evalScores).reduce((a, b) => a + b, 0) / Object.values(evalScores).length
      : 0;
    const varColor = variant === "A" ? chalk.cyan : chalk.yellow;
    console.log(
      varColor(
        `  [${variant}] #${iterNum}: ${result.status} score=${avgScore.toFixed(2)} ` +
        `tokens=${(result.totalTokens.input + result.totalTokens.output).toLocaleString()} ` +
        `cost=$${result.totalCostEstimate.toFixed(4)} ` +
        `time=${(result.totalDurationMs / 1000).toFixed(1)}s`,
      ),
    );
  }

  const resultA = aggregateResult("A", runsA);
  const resultB = aggregateResult("B", runsB);

  // Compare
  const comparison = compare(options, resultA, resultB);
  printComparison(comparison);
}

function aggregateResult(variant: ABVariant, runs: ABTestResult["runs"]): ABTestResult {
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

  // Gather per-run average scores for statistical testing
  const scoresA = a.runs
    .filter((r) => r.status === "success" || r.status === "partial")
    .map((r) => {
      const vals = Object.values(r.evalScores);
      return vals.length > 0 ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
    });
  const scoresB = b.runs
    .filter((r) => r.status === "success" || r.status === "partial")
    .map((r) => {
      const vals = Object.values(r.evalScores);
      return vals.length > 0 ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
    });

  // Welch's t-test
  const { pValue } = welchTTest(scoresA, scoresB);
  const ci = confidenceInterval(scoresA, scoresB);
  const statisticallySignificant = pValue < 0.05;

  // Only declare a winner when the difference is statistically significant
  let winner: ABVariant | "tie" = "tie";
  if (statisticallySignificant) {
    winner = scoreDelta > 0 ? "B" : "A";
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
    pValue,
    confidenceInterval: ci,
    statisticallySignificant,
  };
}

function printComparison(c: ABComparison): void {
  console.log(chalk.bold("\n===== A/B Test Results =====\n"));

  const header = `  ${"Metric".padEnd(20)} ${"Variant A".padEnd(14)} ${"Variant B".padEnd(14)} ${"Delta"}`;
  const sep = `  ${"---".repeat(20)} ${"---".repeat(14)} ${"---".repeat(14)} ${"---".repeat(14)}`;

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

  // Statistical significance section
  console.log();
  console.log(chalk.bold("  --- Statistical Analysis ---"));

  if (c.pValue !== undefined) {
    const pStr = c.pValue < 0.001 ? "< 0.001" : c.pValue.toFixed(4);
    const pColor = c.statisticallySignificant ? chalk.green : chalk.yellow;
    console.log(`  p-value:              ${pColor(pStr)}`);
  }

  if (c.confidenceInterval) {
    const [lo, hi] = c.confidenceInterval;
    console.log(
      chalk.dim(`  95% CI (B - A):       [${lo.toFixed(4)}, ${hi.toFixed(4)}]`),
    );
  }

  if (c.statisticallySignificant !== undefined) {
    const sigStr = c.statisticallySignificant
      ? chalk.green("YES (p < 0.05)")
      : chalk.yellow("NO (p >= 0.05)");
    console.log(`  Significant:          ${sigStr}`);
  }

  console.log();

  if (c.winner === "tie") {
    console.log(chalk.yellow("  Result: TIE (no statistically significant difference)"));
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

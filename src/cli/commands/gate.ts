import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import chalk from "chalk";

interface GateOptions {
  results: string;
  rules: string;
}

interface GateRule {
  metric: string;
  condition: string;
  message?: string;
}

interface EvalResult {
  stepId: string;
  score: number;
  evalType: string;
  passed: boolean;
}

export async function gateCommand(options: GateOptions): Promise<void> {
  try {
    // Load eval results
    const resultsPath = resolve(options.results);
    const resultsRaw = await readFile(resultsPath, "utf-8");
    const results: EvalResult[] = JSON.parse(resultsRaw);

    // Load gate rules
    const rulesPath = resolve(options.rules);
    const rulesRaw = await readFile(rulesPath, "utf-8");
    const config = parseYaml(rulesRaw) as { rules: GateRule[] };

    if (!config.rules?.length) {
      console.log(chalk.yellow("\nNo gate rules defined. Passing by default.\n"));
      return;
    }

    console.log(chalk.bold(`\neddgate gate\n`));
    console.log(chalk.dim(`  results: ${resultsPath}`));
    console.log(chalk.dim(`  rules:   ${rulesPath}\n`));

    // Compute aggregate metrics from results
    const metrics = computeMetrics(results);

    let allPassed = true;

    for (const rule of config.rules) {
      const value = metrics.get(rule.metric);
      if (value === undefined) {
        console.log(
          chalk.yellow(`  SKIP  ${rule.metric}: no data`),
        );
        continue;
      }

      const passed = evaluateCondition(value, rule.condition);

      if (passed) {
        console.log(
          chalk.green(`  PASS  ${rule.metric} = ${value.toFixed(3)} (${rule.condition})`),
        );
      } else {
        console.log(
          chalk.red(`  FAIL  ${rule.metric} = ${value.toFixed(3)} (${rule.condition}) ${rule.message ?? ""}`),
        );
        allPassed = false;
      }
    }

    console.log();
    if (allPassed) {
      console.log(chalk.green("Gate: PASSED. Deploy allowed."));
    } else {
      console.log(chalk.red("Gate: FAILED. Deploy blocked."));
      process.exit(1);
    }
  } catch (err) {
    console.error(
      chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }
}

function computeMetrics(results: EvalResult[]): Map<string, number> {
  const metrics = new Map<string, number>();

  if (results.length === 0) return metrics;

  // Overall metrics
  const scores = results.map((r) => r.score);
  const avgScore = scores.reduce((s, x) => s + x, 0) / scores.length;
  const minScore = Math.min(...scores);
  const passRate = results.filter((r) => r.passed).length / results.length;

  metrics.set("avg_score", avgScore);
  metrics.set("min_score", minScore);
  metrics.set("pass_rate", passRate);

  // Per eval-type metrics
  const byType = new Map<string, number[]>();
  for (const r of results) {
    const arr = byType.get(r.evalType) ?? [];
    arr.push(r.score);
    byType.set(r.evalType, arr);
  }

  for (const [type, typeScores] of byType) {
    const avg = typeScores.reduce((s, x) => s + x, 0) / typeScores.length;
    metrics.set(`${type}_avg`, avg);
    metrics.set(`${type}_min`, Math.min(...typeScores));
  }

  // Per step metrics
  const byStep = new Map<string, number[]>();
  for (const r of results) {
    const arr = byStep.get(r.stepId) ?? [];
    arr.push(r.score);
    byStep.set(r.stepId, arr);
  }

  for (const [step, stepScores] of byStep) {
    const avg = stepScores.reduce((s, x) => s + x, 0) / stepScores.length;
    metrics.set(`${step}_avg`, avg);
  }

  return metrics;
}

function evaluateCondition(value: number, condition: string): boolean {
  // Supports: ">= 0.85", "<= 5000", "== 0", "> 0.7"
  const match = condition.match(/^\s*(>=|<=|>|<|==|!=)\s*([\d.]+)\s*$/);
  if (!match) return true; // Can't parse = pass

  const op = match[1];
  const threshold = parseFloat(match[2]);

  switch (op) {
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    case ">": return value > threshold;
    case "<": return value < threshold;
    case "==": return value === threshold;
    case "!=": return value !== threshold;
    default: return true;
  }
}

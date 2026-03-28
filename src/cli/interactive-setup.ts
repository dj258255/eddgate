import { createInterface } from "node:readline";
import chalk from "chalk";

export interface SetupResult {
  model: string;
  effort: string;
  maxBudgetUsd?: number;
  outputReport?: string;
  traceJsonl?: string;
  confirmed: boolean;
}

const MODELS = [
  { key: "1", name: "sonnet", desc: "Balanced (default)" },
  { key: "2", name: "opus", desc: "Most capable, slower" },
  { key: "3", name: "haiku", desc: "Fast and cheap" },
];

const EFFORTS = [
  { key: "1", name: "low", desc: "Quick, simple tasks" },
  { key: "2", name: "medium", desc: "Standard (default)" },
  { key: "3", name: "high", desc: "Thorough, detailed" },
  { key: "4", name: "max", desc: "Maximum quality" },
];

export async function interactiveSetup(
  workflowName: string,
  stepCount: number,
): Promise<SetupResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log(chalk.bold(`\n  eddgate run: ${workflowName}`));
  console.log(chalk.dim(`  ${stepCount} steps\n`));

  // Model
  console.log(chalk.bold("  Model:"));
  for (const m of MODELS) {
    console.log(`    ${chalk.cyan(m.key)}) ${m.name} -- ${chalk.dim(m.desc)}`);
  }
  const modelChoice = await ask("\n  Select model [1]: ");
  const selectedModel = MODELS.find((m) => m.key === modelChoice.trim())?.name ?? "sonnet";
  console.log(chalk.dim(`  -> ${selectedModel}\n`));

  // Effort
  console.log(chalk.bold("  Effort:"));
  for (const e of EFFORTS) {
    console.log(`    ${chalk.cyan(e.key)}) ${e.name} -- ${chalk.dim(e.desc)}`);
  }
  const effortChoice = await ask("\n  Select effort [2]: ");
  const selectedEffort = EFFORTS.find((e) => e.key === effortChoice.trim())?.name ?? "medium";
  console.log(chalk.dim(`  -> ${selectedEffort}\n`));

  // Budget
  const budgetInput = await ask("  Max budget in USD (enter to skip): ");
  const maxBudgetUsd = budgetInput.trim() ? parseFloat(budgetInput) : undefined;
  if (maxBudgetUsd) {
    console.log(chalk.dim(`  -> $${maxBudgetUsd}\n`));
  }

  // Report
  const reportInput = await ask("  HTML report path (enter to skip): ");
  const outputReport = reportInput.trim() || undefined;

  // Trace
  const traceInput = await ask("  JSONL trace path (enter to skip): ");
  const traceJsonl = traceInput.trim() || undefined;

  // Summary
  console.log(chalk.bold("\n  Summary:"));
  console.log(`    Workflow: ${workflowName}`);
  console.log(`    Model:    ${selectedModel}`);
  console.log(`    Effort:   ${selectedEffort}`);
  if (maxBudgetUsd) console.log(`    Budget:   $${maxBudgetUsd}`);
  if (outputReport) console.log(`    Report:   ${outputReport}`);
  if (traceJsonl) console.log(`    Trace:    ${traceJsonl}`);

  const confirm = await ask("\n  Run? [Y/n]: ");
  const confirmed = !confirm.trim() || confirm.trim().toLowerCase().startsWith("y");

  rl.close();

  return {
    model: selectedModel,
    effort: selectedEffort,
    maxBudgetUsd,
    outputReport,
    traceJsonl,
    confirmed,
  };
}

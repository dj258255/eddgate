import { createInterface } from "node:readline";
import chalk from "chalk";

interface SetupResult {
  model: string;
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

export async function interactiveSetup(
  workflowName: string,
  stepCount: number,
): Promise<SetupResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log(chalk.bold(`\n  eddgate run: ${workflowName}`));
  console.log(chalk.dim(`  ${stepCount} steps\n`));

  // Model selection
  console.log(chalk.bold("  Model:"));
  for (const m of MODELS) {
    console.log(`    ${chalk.cyan(m.key)}) ${m.name} -- ${chalk.dim(m.desc)}`);
  }
  const modelChoice = await ask("\n  Select model [1]: ");
  const selectedModel = MODELS.find((m) => m.key === modelChoice.trim())?.name ?? "sonnet";
  console.log(chalk.dim(`  -> ${selectedModel}\n`));

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

  // Confirm
  console.log(chalk.bold("\n  Summary:"));
  console.log(`    Workflow: ${workflowName}`);
  console.log(`    Model:    ${selectedModel}`);
  if (maxBudgetUsd) console.log(`    Budget:   $${maxBudgetUsd}`);
  if (outputReport) console.log(`    Report:   ${outputReport}`);
  if (traceJsonl) console.log(`    Trace:    ${traceJsonl}`);

  const confirm = await ask("\n  Run? [Y/n]: ");
  const confirmed = !confirm.trim() || confirm.trim().toLowerCase().startsWith("y");

  rl.close();

  return {
    model: selectedModel,
    maxBudgetUsd,
    outputReport,
    traceJsonl,
    confirmed,
  };
}

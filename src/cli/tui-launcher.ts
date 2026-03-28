import { createInterface } from "node:readline";
import { readdir } from "node:fs/promises";
import { resolve, join, extname, basename } from "node:path";
import chalk from "chalk";

export interface LaunchResult {
  workflow: string;
  input: string;
  model: string;
  effort: string;
  maxBudgetUsd?: number;
  report?: string;
  traceJsonl?: string;
  workflowsDir: string;
  promptsDir: string;
  cancelled: boolean;
}

const MODELS = [
  { key: "1", name: "sonnet", desc: "Balanced (default)" },
  { key: "2", name: "opus", desc: "Most capable, slower" },
  { key: "3", name: "haiku", desc: "Fast and cheap" },
];

const EFFORTS = [
  { key: "1", name: "low", desc: "Quick" },
  { key: "2", name: "medium", desc: "Standard (default)" },
  { key: "3", name: "high", desc: "Thorough" },
  { key: "4", name: "max", desc: "Maximum" },
];

export async function tuilauncher(): Promise<LaunchResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log(chalk.bold("\n  eddgate\n"));
  console.log(chalk.dim("  Evaluation-gated workflow engine\n"));

  // Find workflows
  const workflowsDir = resolve("./workflows");
  const templateDir = resolve("./templates/workflows");
  let wfDir = workflowsDir;
  let workflows = await findWorkflows(workflowsDir);

  if (workflows.length === 0) {
    workflows = await findWorkflows(templateDir);
    wfDir = templateDir;
  }

  if (workflows.length === 0) {
    console.log(chalk.red("  No workflows found. Run: eddgate init"));
    rl.close();
    return { workflow: "", input: "", model: "sonnet", effort: "medium", workflowsDir: wfDir, promptsDir: "./prompts", cancelled: true };
  }

  // Workflow selection
  console.log(chalk.bold("  Workflow:"));
  workflows.forEach((wf, i) => {
    console.log(`    ${chalk.cyan(String(i + 1))}) ${wf}`);
  });
  const wfChoice = await ask(`\n  Select [1]: `);
  const wfIndex = parseInt(wfChoice.trim() || "1") - 1;
  const selectedWf = workflows[Math.max(0, Math.min(wfIndex, workflows.length - 1))];
  console.log(chalk.dim(`  -> ${selectedWf}\n`));

  // Input
  const inputText = await ask("  Input (text or file path): ");
  if (!inputText.trim()) {
    console.log(chalk.red("  Input required."));
    rl.close();
    return { workflow: selectedWf, input: "", model: "sonnet", effort: "medium", workflowsDir: wfDir, promptsDir: "./prompts", cancelled: true };
  }
  console.log();

  // Model
  console.log(chalk.bold("  Model:"));
  MODELS.forEach((m) => console.log(`    ${chalk.cyan(m.key)}) ${m.name} -- ${chalk.dim(m.desc)}`));
  const modelChoice = await ask("\n  Select [1]: ");
  const model = MODELS.find((m) => m.key === modelChoice.trim())?.name ?? "sonnet";
  console.log(chalk.dim(`  -> ${model}\n`));

  // Effort
  console.log(chalk.bold("  Effort:"));
  EFFORTS.forEach((e) => console.log(`    ${chalk.cyan(e.key)}) ${e.name} -- ${chalk.dim(e.desc)}`));
  const effortChoice = await ask("\n  Select [2]: ");
  const effort = EFFORTS.find((e) => e.key === effortChoice.trim())?.name ?? "medium";
  console.log(chalk.dim(`  -> ${effort}\n`));

  // Budget
  const budgetInput = await ask("  Max budget USD (enter to skip): ");
  const maxBudgetUsd = budgetInput.trim() ? parseFloat(budgetInput) : undefined;

  // Report
  const reportInput = await ask("  HTML report path (enter to skip): ");
  const report = reportInput.trim() || undefined;

  // Trace
  const traceInput = await ask("  JSONL trace path (enter to skip): ");
  const traceJsonl = traceInput.trim() || undefined;

  // Confirm
  console.log(chalk.bold("\n  Summary:"));
  console.log(`    Workflow: ${selectedWf}`);
  console.log(`    Model:    ${model}`);
  console.log(`    Effort:   ${effort}`);
  if (maxBudgetUsd) console.log(`    Budget:   $${maxBudgetUsd}`);
  if (report) console.log(`    Report:   ${report}`);
  if (traceJsonl) console.log(`    Trace:    ${traceJsonl}`);

  const confirm = await ask("\n  Run? [Y/n]: ");
  const cancelled = confirm.trim().toLowerCase() === "n";

  rl.close();

  // Prompts dir
  let promptsDir = resolve("./prompts");
  try {
    await readdir(promptsDir);
  } catch {
    promptsDir = resolve("./templates/prompts");
  }

  return {
    workflow: selectedWf,
    input: inputText.trim(),
    model,
    effort,
    maxBudgetUsd,
    report,
    traceJsonl,
    workflowsDir: wfDir,
    promptsDir,
    cancelled,
  };
}

async function findWorkflows(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
      .map((f) => basename(f, extname(f)));
  } catch {
    return [];
  }
}

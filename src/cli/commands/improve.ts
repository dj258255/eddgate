import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { loadAllTraces } from "../../trace/trace-loader.js";
import { suggestPromptImprovements, type PromptPatch } from "../../core/prompt-improver.js";
import { extractFailures, clusterFailures } from "./analyze.js";
import { initLang, t } from "../../i18n/index.js";

interface ImproveOptions {
  dir: string;
  promptsDir: string;
  apply?: boolean;  // auto-apply without review (for CI)
  dryRun?: boolean;
}

export async function improveCommand(options: ImproveOptions): Promise<void> {
  initLang();
  const tracesDir = resolve(options.dir);
  const events = await loadAllTraces(tracesDir);

  if (events.length === 0) {
    console.log(chalk.dim("\nNo traces found. Run a workflow first.\n"));
    return;
  }

  const failures = extractFailures(events);
  if (failures.length === 0) {
    console.log(chalk.green("\nNo failures found. Prompts look good!\n"));
    return;
  }

  const clusters = clusterFailures(failures);
  console.log(chalk.bold("\nAnalyzing failures and generating prompt improvements...\n"));

  const result = await suggestPromptImprovements({
    clusters: clusters.map(c => ({
      stepId: c.stepId,
      failureType: c.failureType,
      description: c.description,
      count: c.count,
      fix: c.fix,
      avgScore: c.avgScore,
      instances: c.instances,
    })),
    promptsDir: options.promptsDir,
  });

  if (result.patches.length === 0) {
    console.log(chalk.dim("No prompt improvements suggested.\n"));
    return;
  }

  console.log(chalk.bold(`${result.patches.length} prompt improvement(s) suggested:\n`));

  for (const patch of result.patches) {
    console.log(chalk.cyan(`  ${patch.role} (${patch.promptFile})`));
    console.log(chalk.dim(`  Reason: ${patch.reason}`));
    console.log(chalk.dim(`  Confidence: ${patch.confidence}`));
    console.log(chalk.dim(`  Pattern: ${patch.failurePattern}`));

    if (options.apply && !options.dryRun) {
      await writeFile(patch.promptFile, patch.suggestedContent, "utf-8");
      console.log(chalk.green(`  Applied!\n`));
    } else if (options.dryRun) {
      console.log(chalk.yellow(`  [dry-run] Would write to ${patch.promptFile}\n`));
    } else {
      console.log(chalk.dim(`  Use --apply to auto-apply, or review in TUI\n`));
    }
  }

  console.log(chalk.dim(`Analysis used ${result.analysisTokens.toLocaleString()} tokens\n`));
}

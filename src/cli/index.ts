#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { stepCommand } from "./commands/step.js";
import { traceCommand } from "./commands/trace.js";
import { evalCommand } from "./commands/eval.js";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { diffEvalCommand } from "./commands/diff-eval.js";
import { mcpCommand } from "./commands/mcp.js";
import { vizCommand } from "./commands/viz.js";
import { monitorCommand } from "./commands/monitor.js";
import { gateCommand } from "./commands/gate.js";
import { versionDiffCommand } from "./commands/version-diff.js";
import { analyzeCommand } from "./commands/analyze.js";
import { testCommand } from "./commands/test.js";
import { tuilauncher } from "./tui-launcher.js";
import { setEffort } from "../core/agent-runner.js";

// No args = TUI mode
if (process.argv.length <= 2) {
  launchTUI();
} else {
  launchCLI();
}

async function launchTUI(): Promise<void> {
  const result = await tuilauncher();

  if (result.cancelled) {
    process.exit(0);
  }

  if (result.effort && result.effort !== "medium") {
    setEffort(result.effort);
  }

  // Build args for run command
  await runCommand(result.workflow, {
    input: result.input,
    model: result.model,
    config: "./eddgate.config.yaml",
    workflowsDir: result.workflowsDir,
    rolesDir: "./roles",
    promptsDir: result.promptsDir,
    report: result.report,
    traceJsonl: result.traceJsonl,
    maxBudgetUsd: result.maxBudgetUsd,
    tui: true, // Show TUI dashboard after completion
    interactive: false,
    quiet: false,
    json: false,
    dryRun: false,
  });
}

function launchCLI(): void {
  const program = new Command();

  program
    .name("eddgate")
    .description("Evaluation-gated workflow engine. Run without arguments for TUI mode.")
    .version("0.1.0");

  program
    .command("init")
    .description("Create a new eddgate project")
    .option("-d, --dir <path>", "Project directory", ".")
    .action(initCommand);

  program
    .command("doctor")
    .description("Check if everything is set up correctly")
    .option("-c, --config <path>", "Config file", "./eddgate.config.yaml")
    .option("-w, --workflows-dir <path>", "Workflows directory", "./workflows")
    .option("--ci", "CI mode")
    .action(doctorCommand);

  program
    .command("run <workflow>")
    .description("Run a workflow")
    .option("-i, --input <file>", "Input file or text")
    .option("-m, --model <model>", "Override model (sonnet, opus, haiku)")
    .option("-e, --effort <level>", "Effort level (low, medium, high, max)")
    .option("-c, --config <path>", "Config file", "./eddgate.config.yaml")
    .option("-w, --workflows-dir <path>", "Workflows directory", "./workflows")
    .option("-p, --prompts-dir <path>", "Prompts directory", "./prompts")
    .option("-o, --output <path>", "Save result to file")
    .option("--report <path>", "Generate HTML report")
    .option("--trace-jsonl <path>", "Save JSONL trace")
    .option("--tui", "Interactive TUI dashboard after completion")
    .option("--max-budget-usd <n>", "Cost limit in USD", parseFloat)
    .option("--interactive", "Interactive setup before running")
    .option("--quiet", "Errors only")
    .option("--json", "JSON output")
    .option("--dry-run", "Preview without executing")
    .action(runCommand);

  program
    .command("analyze")
    .description("Analyze failure patterns and generate rules from traces")
    .option("-d, --dir <path>", "Traces directory", "./traces")
    .option("--context", "Context window profiler mode")
    .option("--generate-rules", "Auto-generate validation rules from patterns")
    .option("-o, --output <path>", "Rules output directory", "./eval/rules")
    .action(analyzeCommand);

  program
    .command("test <action>")
    .description("Regression testing: snapshot | diff | list")
    .option("-d, --dir <path>", "Traces directory", "./traces")
    .option("-s, --snapshot-dir <path>", "Snapshots directory", "./.eddgate/snapshots")
    .action(testCommand);

  program
    .command("list <type>")
    .description("List workflows or roles")
    .option("-d, --dir <path>", "Directory")
    .action(listCommand);

  // Advanced
  const advanced = program
    .command("advanced")
    .description("Advanced commands")
    .alias("adv");

  advanced.command("step <workflow> <step-id>")
    .description("Run a single step")
    .option("-i, --input <file>", "Input")
    .option("-w, --workflows-dir <path>", "Workflows dir", "./workflows")
    .option("-p, --prompts-dir <path>", "Prompts dir", "./prompts")
    .action(stepCommand);

  advanced.command("trace <file>")
    .description("View a trace file")
    .option("-f, --format <fmt>", "summary | json", "summary")
    .option("-d, --dir <path>", "Traces dir", "./traces")
    .action(traceCommand);

  advanced.command("eval <workflow>")
    .description("Offline evaluation on saved traces")
    .option("-d, --dataset <path>", "Traces dir", "./traces")
    .option("-o, --output <path>", "Save results")
    .option("-w, --workflows-dir <path>", "Workflows dir", "./workflows")
    .option("-m, --model <model>", "Eval model", "sonnet")
    .action(evalCommand);

  advanced.command("diff-eval <workflow>")
    .description("Compare scores between commits")
    .option("-b, --before <commit>", "Before", "HEAD~1")
    .option("-a, --after <commit>", "After", "HEAD")
    .option("-d, --dir <path>", "Traces dir", "./traces")
    .action(diffEvalCommand);

  advanced.command("gate")
    .description("Deployment gate check")
    .requiredOption("-r, --results <path>", "Eval results JSON")
    .requiredOption("--rules <path>", "Gate rules YAML")
    .action(gateCommand);

  advanced.command("monitor <action>")
    .description("Metrics: status | cost | quality")
    .option("-d, --dir <path>", "Traces dir", "./traces")
    .option("-p, --period <period>", "Period (7d, 24h, 30d)", "7d")
    .action(monitorCommand);

  advanced.command("version-diff")
    .description("Prompt/workflow version changes")
    .option("-c, --commit <hash>", "Compare against", "HEAD~1")
    .option("--paths <paths>", "Tracked paths", "templates/prompts,templates/workflows")
    .action(versionDiffCommand);

  advanced.command("mcp <action> [args...]")
    .description("MCP servers: list | add | remove")
    .option("-c, --config <path>", "Config", "./eddgate.config.yaml")
    .action((action: string, args: string[], opts) => mcpCommand(action, opts, args));

  advanced.command("viz <workflow>")
    .description("Workflow diagram (mermaid | ascii)")
    .option("-w, --workflows-dir <path>", "Workflows dir", "./workflows")
    .option("-f, --format <fmt>", "mermaid | ascii", "mermaid")
    .action(vizCommand);

  program.parse();
}

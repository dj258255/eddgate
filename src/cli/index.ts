#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { stepCommand } from "./commands/step.js";
import { traceCommand } from "./commands/trace.js";
import { evalCommand } from "./commands/eval.js";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";

const program = new Command();

program
  .name("eddgate")
  .description("Evaluation-driven multi-agent workflow engine")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize eddgate project structure")
  .option("-d, --dir <path>", "Project directory", ".")
  .action(initCommand);

program
  .command("doctor")
  .description("Check environment and config health")
  .option("-c, --config <path>", "Config file", "./eddgate.config.yaml")
  .option("-w, --workflows-dir <path>", "Workflows directory", "./workflows")
  .action(doctorCommand);

program
  .command("run <workflow>")
  .description("Run a workflow")
  .option("-i, --input <file>", "Input file or text")
  .option("-c, --config <path>", "Project config file", "./eddgate.config.yaml")
  .option("-w, --workflows-dir <path>", "Workflows directory", "./workflows")
  .option("-r, --roles-dir <path>", "Roles directory", "./roles")
  .option("-p, --prompts-dir <path>", "Prompts directory", "./prompts")
  .option("-o, --output <path>", "Save result to file")
  .option("--report <path>", "Generate HTML report")
  .option("--trace-jsonl <path>", "Save JSONL trace")
  .option("--tui", "Show interactive TUI dashboard after completion")
  .option("--max-budget-usd <amount>", "Maximum cost budget in USD", parseFloat)
  .option("--verbose", "Verbose output")
  .option("--quiet", "Minimal output (errors only)")
  .option("--json", "Machine-readable JSON output")
  .option("--dry-run", "Preview workflow structure without executing")
  .action(runCommand);

program
  .command("step <workflow> <step-id>")
  .description("Run a single step (for debugging)")
  .option("-i, --input <file>", "Input file or text")
  .option("-w, --workflows-dir <path>", "Workflows directory", "./workflows")
  .option("-p, --prompts-dir <path>", "Prompts directory", "./prompts")
  .action(stepCommand);

program
  .command("trace <trace-id-or-file>")
  .description("View a trace (JSONL file or trace ID)")
  .option("-f, --format <format>", "Output format: summary | json", "summary")
  .option("-d, --dir <path>", "Traces directory", "./traces")
  .action(traceCommand);

program
  .command("eval <workflow>")
  .description("Run offline evaluation on saved traces")
  .option("-d, --dataset <path>", "Traces directory", "./traces")
  .option("-o, --output <path>", "Save evaluation results")
  .option("-w, --workflows-dir <path>", "Workflows directory", "./workflows")
  .option("-m, --model <model>", "Model for evaluation", "sonnet")
  .action(evalCommand);

program
  .command("list <type>")
  .description("List workflows or roles (type: workflows | roles)")
  .option("-d, --dir <path>", "Search directory")
  .action(listCommand);

program.parse();

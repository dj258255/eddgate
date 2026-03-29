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
import { ragIndexCommand, ragSearchCommand } from "./commands/rag.js";
import { abTestCommand } from "./commands/ab-test.js";

// No args = blessed TUI mode
if (process.argv.length <= 2) {
  import("./blessed-tui.js")
    .then((m) => m.launchBlessedTUI())
    .catch((err) => {
      console.error("TUI failed to launch:", err.message);
      process.exit(1);
    });
} else {
  launchCLI();
}

function launchCLI(): void {
  const program = new Command();

  program
    .name("eddgate")
    .description("Evaluation-gated workflow engine. Run without arguments for TUI mode.")
    .version("0.1.0");

  // Core
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
    .option("--max-budget-usd <n>", "Cost limit in USD", parseFloat)
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

  // RAG
  const rag = advanced.command("rag").description("RAG pipeline: index | search");

  rag.command("index")
    .description("Index documents to Pinecone")
    .requiredOption("-d, --dir <path>", "Documents directory")
    .requiredOption("--index <name>", "Pinecone index name")
    .option("-n, --namespace <ns>", "Namespace")
    .option("--chunk-size <n>", "Chunk size in chars", "1000")
    .option("--chunk-overlap <n>", "Overlap between chunks", "200")
    .action((opts) => ragIndexCommand({
      dir: opts.dir, index: opts.index, namespace: opts.namespace,
      chunkSize: parseInt(opts.chunkSize), chunkOverlap: parseInt(opts.chunkOverlap),
    }));

  rag.command("search <query>")
    .description("Search Pinecone index")
    .requiredOption("--index <name>", "Pinecone index name")
    .option("-n, --namespace <ns>", "Namespace")
    .option("-k, --top-k <n>", "Top K results", "5")
    .option("-t, --threshold <n>", "Score threshold")
    .action((query, opts) => ragSearchCommand(query, {
      index: opts.index, namespace: opts.namespace,
      topK: parseInt(opts.topK), threshold: opts.threshold ? parseFloat(opts.threshold) : undefined,
    }));

  // Prompt Improve
  advanced.command("improve")
    .description("Auto-suggest prompt improvements from failure analysis")
    .option("-d, --dir <path>", "Traces directory", "./traces")
    .option("--prompts <path>", "Prompts directory", "./templates/prompts")
    .option("--apply", "Auto-apply without review")
    .option("--dry-run", "Show suggestions without applying")
    .action(async (opts) => {
      const { improveCommand } = await import("./commands/improve.js");
      await improveCommand({
        dir: opts.dir,
        promptsDir: opts.prompts,
        apply: opts.apply,
        dryRun: opts.dryRun,
      });
    });

  // A/B Test
  advanced.command("ab-test")
    .description("A/B prompt comparison test")
    .requiredOption("--workflow <name>", "Workflow name")
    .requiredOption("--prompt-a <path>", "Prompt variant A file")
    .requiredOption("--prompt-b <path>", "Prompt variant B file")
    .requiredOption("-i, --input <file>", "Input file or text")
    .option("-n, --iterations <n>", "Runs per variant", "3")
    .option("-m, --model <model>", "Model override")
    .option("-w, --workflows-dir <path>", "Workflows dir", "./templates/workflows")
    .option("-p, --prompts-dir <path>", "Prompts dir", "./templates/prompts")
    .action((opts) => abTestCommand({
      workflow: opts.workflow, promptA: opts.promptA, promptB: opts.promptB,
      input: opts.input, iterations: parseInt(opts.iterations), model: opts.model,
      workflowsDir: opts.workflowsDir, promptsDir: opts.promptsDir,
    }));

  program
    .command("serve")
    .description("Start API server for workflow execution")
    .option("-p, --port <number>", "port", "3000")
    .option("--host <host>", "host", "127.0.0.1")
    .option("-w, --workflows-dir <path>", "workflows directory", "./templates/workflows")
    .option("--prompts <path>", "prompts directory", "./templates/prompts")
    .action(async (opts) => {
      const { serveCommand } = await import("./commands/serve.js");
      await serveCommand({
        port: parseInt(opts.port, 10),
        host: opts.host,
        workflowsDir: opts.workflowsDir,
        promptsDir: opts.prompts,
      });
    });

  program.parse();
}

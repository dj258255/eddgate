#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
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
  const p = await import("@clack/prompts");

  p.intro(chalk.yellow("<|>") + " " + chalk.bold("eddgate"));

  const mode = await p.select({
    message: "What do you want to do?",
    options: [
      { value: "run", label: "Run a workflow", hint: "execute with eval gates" },
      { value: "analyze", label: "Analyze failures", hint: "find patterns, generate rules" },
      { value: "test", label: "Regression test", hint: "snapshot/diff behavior" },
      { value: "mcp", label: "MCP servers", hint: "add, remove, list" },
      { value: "config", label: "Settings", hint: "model, traces, budget" },
    ],
  });

  if (p.isCancel(mode)) { p.cancel("Cancelled."); process.exit(0); }

  if (mode === "analyze") {
    const contextMode = await p.confirm({ message: "Context window profiler mode?" });
    if (p.isCancel(contextMode)) { p.cancel("Cancelled."); process.exit(0); }

    const genRules = await p.confirm({ message: "Auto-generate validation rules?" });
    if (p.isCancel(genRules)) { p.cancel("Cancelled."); process.exit(0); }

    await analyzeCommand({
      dir: "./traces",
      context: !!contextMode,
      generateRules: !!genRules,
      output: "./eval/rules",
    });
    process.exit(0);
  }

  if (mode === "test") {
    const action = await p.select({
      message: "Test action",
      options: [
        { value: "snapshot", label: "Save snapshot", hint: "capture current behavior as baseline" },
        { value: "diff", label: "Run diff", hint: "compare against baseline" },
        { value: "list", label: "List snapshots" },
      ],
    });
    if (p.isCancel(action)) { p.cancel("Cancelled."); process.exit(0); }

    await testCommand(action as string, { dir: "./traces" });
    process.exit(0);
  }

  if (mode === "mcp") {
    await tuiMcpManager(p);
    process.exit(0);
  }

  if (mode === "config") {
    await tuiConfigManager(p);
    process.exit(0);
  }

  // mode === "run" -> launch workflow selector
  const result = await tuilauncher();

  if (result.cancelled) {
    process.exit(0);
  }

  if (result.effort && result.effort !== "medium") {
    setEffort(result.effort);
  }

  if (result.thinking && result.thinking !== "disabled") {
    const { setThinking } = await import("../core/agent-runner.js");
    setThinking(result.thinking);
  }

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
    tui: true,
    interactive: false,
    quiet: false,
    json: false,
    dryRun: false,
  });
}

// ─── TUI: MCP Server Manager ────────────────────────────────

async function tuiMcpManager(p: typeof import("@clack/prompts")): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { parse: parseYaml, stringify: stringifyYaml } = await import("yaml");

  const configPath = resolve("./eddgate.config.yaml");

  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf-8");
    config = (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch { /* no config */ }

  const mcp = (config.mcp as { servers?: Array<Record<string, unknown>> }) ?? { servers: [] };
  if (!mcp.servers) mcp.servers = [];

  const action = await p.select({
    message: "MCP servers",
    options: [
      { value: "list", label: `List servers (${mcp.servers.length})` },
      { value: "add", label: "Add new server" },
      { value: "remove", label: "Remove server" },
    ],
  });
  if (p.isCancel(action)) return;

  if (action === "list") {
    if (mcp.servers.length === 0) {
      p.log.info("No MCP servers configured.");
    } else {
      for (const s of mcp.servers) {
        p.log.info(`${s.name} (${s.transport}) -- ${s.command ?? s.url ?? ""}`);
      }
    }
    return;
  }

  if (action === "add") {
    const name = await p.text({ message: "Server name" });
    if (p.isCancel(name)) return;

    const transport = await p.select({
      message: "Transport",
      options: [
        { value: "stdio", label: "stdio", hint: "local command" },
        { value: "http", label: "http", hint: "remote URL" },
        { value: "sse", label: "sse", hint: "server-sent events" },
      ],
    });
    if (p.isCancel(transport)) return;

    let target: string | symbol;
    if (transport === "stdio") {
      target = await p.text({ message: "Command (e.g., npx -y @pinecone-database/mcp)" });
    } else {
      target = await p.text({ message: "URL (e.g., https://mcp.example.com)" });
    }
    if (p.isCancel(target)) return;

    const server: Record<string, unknown> = {
      name: name as string,
      transport: transport as string,
    };
    if (transport === "stdio") server.command = target as string;
    else server.url = target as string;

    mcp.servers.push(server);
    config.mcp = mcp;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(`Added: ${name as string} (${transport as string})`);
    return;
  }

  if (action === "remove") {
    if (mcp.servers.length === 0) {
      p.log.info("No servers to remove.");
      return;
    }

    const toRemove = await p.select({
      message: "Remove which server?",
      options: mcp.servers.map((s) => ({
        value: s.name as string,
        label: `${s.name} (${s.transport})`,
      })),
    });
    if (p.isCancel(toRemove)) return;

    mcp.servers = mcp.servers.filter((s) => s.name !== toRemove);
    config.mcp = mcp;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(`Removed: ${toRemove as string}`);
  }
}

// ─── TUI: Config/Settings Manager ────────────────────────────

async function tuiConfigManager(p: typeof import("@clack/prompts")): Promise<void> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const { parse: parseYaml, stringify: stringifyYaml } = await import("yaml");

  const configPath = resolve("./eddgate.config.yaml");

  let config: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, "utf-8");
    config = (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch {
    p.log.warn("No config file found. Run: eddgate init");
    return;
  }

  const model = (config.model as Record<string, unknown>) ?? { default: "sonnet" };

  const setting = await p.select({
    message: "Settings",
    options: [
      { value: "model", label: `Default model: ${model.default ?? "sonnet"}` },
      { value: "traces", label: "Trace output settings" },
      { value: "view", label: "View current config" },
    ],
  });
  if (p.isCancel(setting)) return;

  if (setting === "model") {
    const { MODELS: modelList } = await import("./models.js");
    const newModel = await p.select({
      message: "Default model",
      options: modelList.map((m) => ({ value: m.value, label: m.label, hint: m.hint })),
      initialValue: (model.default as string) ?? "sonnet",
    });
    if (p.isCancel(newModel)) return;

    model.default = newModel as string;
    config.model = model;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    p.log.success(`Default model set to: ${newModel as string}`);
    return;
  }

  if (setting === "traces") {
    const traceAction = await p.select({
      message: "Trace settings",
      options: [
        { value: "stdout", label: "Toggle stdout output" },
        { value: "jsonl", label: "Set JSONL trace directory" },
        { value: "langfuse", label: "Configure Langfuse" },
      ],
    });
    if (p.isCancel(traceAction)) return;

    if (traceAction === "jsonl") {
      const dir = await p.text({ message: "JSONL traces directory", defaultValue: "./traces/" });
      if (p.isCancel(dir)) return;

      if (!config.trace) config.trace = { outputs: [] };
      const trace = config.trace as { outputs: Array<Record<string, unknown>> };
      // Remove existing jsonl, add new
      trace.outputs = trace.outputs.filter((o) => o.type !== "jsonl");
      trace.outputs.push({ type: "jsonl", config: { path: dir as string } });
      await writeFile(configPath, stringifyYaml(config), "utf-8");
      p.log.success(`JSONL traces: ${dir as string}`);
    }

    if (traceAction === "langfuse") {
      const publicKey = await p.text({ message: "LANGFUSE_PUBLIC_KEY" });
      if (p.isCancel(publicKey)) return;
      const secretKey = await p.text({ message: "LANGFUSE_SECRET_KEY" });
      if (p.isCancel(secretKey)) return;

      if (!config.trace) config.trace = { outputs: [] };
      const trace = config.trace as { outputs: Array<Record<string, unknown>> };
      trace.outputs = trace.outputs.filter((o) => o.type !== "langfuse");
      trace.outputs.push({
        type: "langfuse",
        config: { publicKey: publicKey as string, secretKey: secretKey as string },
      });
      await writeFile(configPath, stringifyYaml(config), "utf-8");
      p.log.success("Langfuse configured.");
    }

    return;
  }

  if (setting === "view") {
    const raw = await readFile(configPath, "utf-8");
    p.log.info(raw);
  }
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

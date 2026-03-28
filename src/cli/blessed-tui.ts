import blessed from "neo-blessed";
import { readdir, readFile } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { initLang, t } from "../i18n/index.js";
import { parse as parseYaml } from "yaml";

/**
 * Blessed TUI -- Ralph TUI / Orchestration Dashboard style.
 *
 * Main view: menu with preview
 * Run view: step progress + agent output + status bar
 * Results view: summary with blessed-contrib charts
 */

export async function launchBlessedTUI(): Promise<void> {
  initLang();

  const screen = blessed.screen({
    smartCSR: true,
    title: "eddgate",
    fullUnicode: true,
  });

  // ─── Header ────────────────────────────────────────

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { bg: "black", fg: "white" },
    content: " {yellow-fg}<|>{/yellow-fg} {bold}eddgate{/bold}  {gray-fg}Self-improving evaluation loop{/gray-fg}",
  });

  // ─── Left: Menu ────────────────────────────────────

  const menuBox = blessed.list({
    parent: screen,
    label: ` {bold}Menu{/bold} `,
    tags: true,
    top: 1,
    left: 0,
    width: "25%",
    height: "100%-2",
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
      selected: { bg: "cyan", fg: "black", bold: true },
      item: { fg: "white" },
    },
    keys: true,
    vi: true,
    mouse: true,
    items: [
      `  ${t("menu.run")}`,
      `  ${t("menu.analyze")}`,
      `  ${t("menu.test")}`,
      `  ${t("menu.mcp")}`,
      `  ${t("menu.config")}`,
      `  ${t("menu.exit")}`,
    ],
    padding: { top: 1 },
  });

  // ─── Right: Content ────────────────────────────────

  const contentBox = blessed.box({
    parent: screen,
    tags: true,
    top: 1,
    left: "25%",
    width: "75%",
    height: "100%-2",
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "cyan" } },
    keys: true,
    vi: true,
    mouse: true,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
  });

  // ─── Status Bar ────────────────────────────────────

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { bg: "black" },
    content: " {cyan-fg}↑↓{/cyan-fg} navigate  {cyan-fg}Enter{/cyan-fg} select  {cyan-fg}Tab{/cyan-fg} switch panel  {cyan-fg}q{/cyan-fg} quit",
  });

  // ─── Content Renderers ─────────────────────────────

  async function updateContent(index: number): Promise<void> {
    const labels = [
      ` ${t("menu.run")} `,
      ` ${t("menu.analyze")} `,
      ` ${t("menu.test")} `,
      ` ${t("menu.mcp")} `,
      ` ${t("menu.config")} `,
    ];
    contentBox.setLabel(labels[index] ?? "");

    switch (index) {
      case 0: contentBox.setContent(await renderRunPanel()); break;
      case 1: contentBox.setContent(await renderAnalyzePanel()); break;
      case 2: contentBox.setContent(await renderTestPanel()); break;
      case 3: contentBox.setContent(await renderMcpPanel()); break;
      case 4: contentBox.setContent(await renderSettingsPanel()); break;
    }
    screen.render();
  }

  // ─── Events ────────────────────────────────────────

  let currentIndex = 0;

  menuBox.on("select item", async (_item: unknown, index: number) => {
    currentIndex = index;
    await updateContent(index);
  });

  menuBox.on("select", async (_item: unknown, index: number) => {
    if (index === 5) {
      screen.destroy();
      console.log(`\n${t("menu.bye")}\n`);
      process.exit(0);
    }

    // Destroy screen, run clack-based flow, then re-launch
    screen.destroy();
    await handleAction(index);
    await launchBlessedTUI();
  });

  screen.key(["q", "C-c"], () => {
    screen.destroy();
    console.log(`\n${t("menu.bye")}\n`);
    process.exit(0);
  });

  screen.key(["tab"], () => {
    if ((menuBox as any).focused) {
      contentBox.focus();
    } else {
      menuBox.focus();
    }
    screen.render();
  });

  // Init
  menuBox.focus();
  menuBox.select(0);
  await updateContent(0);
  screen.render();
}

// ─── Action Handler ──────────────────────────────────

async function handleAction(index: number): Promise<void> {
  const p = await import("@clack/prompts");

  if (index === 0) {
    // Run
    const { tuilauncher } = await import("./tui-launcher.js");
    const { setEffort, setThinking } = await import("../core/agent-runner.js");
    const { runCommand } = await import("./commands/run.js");

    const result = await tuilauncher();
    if (result.cancelled) return;

    if (result.effort !== "medium") setEffort(result.effort);
    if (result.thinking !== "disabled") setThinking(result.thinking);

    await runCommand(result.workflow, {
      input: result.input,
      model: result.model,
      effort: result.effort,
      config: "./eddgate.config.yaml",
      workflowsDir: result.workflowsDir,
      rolesDir: "./roles",
      promptsDir: result.promptsDir,
      report: result.report,
      traceJsonl: result.traceJsonl,
      maxBudgetUsd: result.maxBudgetUsd,
      tui: false,
      interactive: false,
      quiet: false,
      json: false,
      dryRun: false,
    });

    console.log("\nPress any key to return...");
    await waitKey();
  }

  if (index === 1) {
    // Analyze
    const { analyzeCommand } = await import("./commands/analyze.js");

    const ctx = await p.confirm({ message: t("analyze.contextMode") });
    if (p.isCancel(ctx)) return;
    const gen = await p.confirm({ message: t("analyze.generateRules") });
    if (p.isCancel(gen)) return;

    await analyzeCommand({ dir: "./traces", context: !!ctx, generateRules: !!gen, output: "./eval/rules" });

    console.log("\nPress any key to return...");
    await waitKey();
  }

  if (index === 2) {
    // Test
    const { testCommand } = await import("./commands/test.js");

    const action = await p.select({
      message: t("test.action"),
      options: [
        { value: "snapshot", label: t("test.snapshot") },
        { value: "diff", label: t("test.diff") },
        { value: "list", label: t("test.listSnapshots") },
      ],
    });
    if (p.isCancel(action)) return;

    await testCommand(action as string, { dir: "./traces" });

    console.log("\nPress any key to return...");
    await waitKey();
  }

  if (index === 3) {
    const { tuiMcpManager } = await import("./blessed-tui-helpers.js");
    await tuiMcpManager(p);
  }

  if (index === 4) {
    const { tuiConfigManager } = await import("./blessed-tui-helpers.js");
    await tuiConfigManager(p);
  }
}

// ─── Panel Renderers ─────────────────────────────────

async function renderRunPanel(): Promise<string> {
  const workflows = await findWorkflows("./workflows")
    .then((w) => w.length > 0 ? w : findWorkflows("./templates/workflows"));

  const lines = [
    "",
    "  {bold}{cyan-fg}Run a Workflow{/cyan-fg}{/bold}",
    "",
    "  {gray-fg}The self-improving loop:{/gray-fg}",
    "  {cyan-fg}run{/cyan-fg} -> {yellow-fg}analyze{/yellow-fg} -> {green-fg}test{/green-fg} -> {cyan-fg}run{/cyan-fg} (improved)",
    "",
    "  {bold}Workflows:{/bold}",
  ];

  for (const wf of workflows) {
    const steps = await getWorkflowStepCount(wf);
    lines.push(`    {cyan-fg}>{/cyan-fg} ${wf}  {gray-fg}(${steps} steps){/gray-fg}`);
  }

  lines.push(
    "",
    "  {bold}Validation gates:{/bold}",
    "    Tier 1: Zod schema  {green-fg}(0% false positive, 5ms){/green-fg}",
    "    Tier 2: LLM judge   {yellow-fg}(key transitions only){/yellow-fg}",
    "",
    "  {gray-fg}Press Enter to configure and run.{/gray-fg}",
  );

  return lines.join("\n");
}

async function renderAnalyzePanel(): Promise<string> {
  let traceCount = 0;
  let eventCount = 0;
  try {
    const files = await readdir(resolve("./traces"));
    const jsonls = files.filter((f) => f.endsWith(".jsonl"));
    traceCount = jsonls.length;
    for (const f of jsonls) {
      const content = await readFile(resolve("./traces", f), "utf-8");
      eventCount += content.split("\n").filter(Boolean).length;
    }
  } catch { /* */ }

  return [
    "",
    "  {bold}{yellow-fg}Analyze Failures{/yellow-fg}{/bold}",
    "",
    `  {bold}Traces:{/bold}  ${traceCount} file(s), ${eventCount} events`,
    "",
    "  {bold}Features:{/bold}",
    "    {yellow-fg}>{/yellow-fg} Cluster failure patterns by step + type",
    "    {yellow-fg}>{/yellow-fg} Auto-generate validation rules",
    "    {yellow-fg}>{/yellow-fg} Context window profiler",
    "",
    "  {bold}Loop connection:{/bold}",
    "    Generated rules -> {cyan-fg}eval/rules/{/cyan-fg}",
    "    Auto-loaded on next {cyan-fg}eddgate run{/cyan-fg}",
    "",
    "  {gray-fg}Press Enter to analyze.{/gray-fg}",
  ].join("\n");
}

async function renderTestPanel(): Promise<string> {
  let snapCount = 0;
  try {
    const files = await readdir(resolve("./.eddgate/snapshots"));
    snapCount = files.filter((f) => f.endsWith(".json")).length;
  } catch { /* */ }

  return [
    "",
    "  {bold}{green-fg}Regression Testing{/green-fg}{/bold}",
    "",
    `  {bold}Snapshots:{/bold}  ${snapCount}`,
    "",
    "  {bold}Actions:{/bold}",
    "    {green-fg}snapshot{/green-fg}  Save current behavior as baseline",
    "    {green-fg}diff{/green-fg}      Compare new traces against baseline",
    "    {green-fg}list{/green-fg}      Show saved snapshots",
    "",
    "  {bold}CI integration:{/bold}",
    "    {red-fg}exit 1{/red-fg} on regression detected",
    "",
    "  {gray-fg}Press Enter to manage tests.{/gray-fg}",
  ].join("\n");
}

async function renderMcpPanel(): Promise<string> {
  let servers: Array<{ name: string; transport: string }> = [];
  try {
    const raw = await readFile(resolve("./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    const mcp = config.mcp as { servers?: Array<Record<string, unknown>> } | undefined;
    servers = (mcp?.servers ?? []).map((s) => ({
      name: String(s.name ?? ""),
      transport: String(s.transport ?? ""),
    }));
  } catch { /* */ }

  const lines = [
    "",
    "  {bold}{magenta-fg}MCP Servers{/magenta-fg}{/bold}",
    "",
    `  {bold}Configured:{/bold}  ${servers.length}`,
    "",
  ];

  if (servers.length > 0) {
    for (const s of servers) {
      lines.push(`    {magenta-fg}>{/magenta-fg} ${s.name}  {gray-fg}(${s.transport}){/gray-fg}`);
    }
  } else {
    lines.push("    {gray-fg}No servers configured.{/gray-fg}");
  }

  lines.push(
    "",
    "  {bold}Actions:{/bold}  list, add, remove",
    "",
    "  {gray-fg}Press Enter to manage.{/gray-fg}",
  );

  return lines.join("\n");
}

async function renderSettingsPanel(): Promise<string> {
  let model = "sonnet";
  let lang = "en";
  let traceOutputs = 0;
  try {
    const raw = await readFile(resolve("./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    model = ((config.model as Record<string, unknown>)?.default as string) ?? "sonnet";
    lang = (config.language as string) ?? "en";
    const trace = config.trace as { outputs?: unknown[] } | undefined;
    traceOutputs = trace?.outputs?.length ?? 0;
  } catch { /* */ }

  return [
    "",
    "  {bold}{blue-fg}Settings{/blue-fg}{/bold}",
    "",
    `  {bold}Model:{/bold}     ${model}`,
    `  {bold}Language:{/bold}  ${lang === "ko" ? "한국어" : "English"}`,
    `  {bold}Traces:{/bold}   ${traceOutputs} output(s)`,
    "",
    "  {bold}Options:{/bold}",
    "    {blue-fg}>{/blue-fg} Default model  (sonnet/opus/haiku)",
    "    {blue-fg}>{/blue-fg} Language       (ko/en)",
    "    {blue-fg}>{/blue-fg} Trace config   (JSONL, Langfuse)",
    "",
    "  {gray-fg}Press Enter to modify.{/gray-fg}",
  ].join("\n");
}

// ─── Helpers ─────────────────────────────────────────

async function findWorkflows(dir: string): Promise<string[]> {
  try {
    const files = await readdir(resolve(dir));
    return files
      .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
      .map((f) => basename(f, extname(f)));
  } catch { return []; }
}

async function getWorkflowStepCount(name: string): Promise<number> {
  for (const dir of ["./workflows", "./templates/workflows"]) {
    try {
      const raw = await readFile(resolve(dir, `${name}.yaml`), "utf-8");
      const wf = parseYaml(raw) as { steps?: unknown[] };
      return wf.steps?.length ?? 0;
    } catch { continue; }
  }
  return 0;
}

function waitKey(): Promise<void> {
  return new Promise((res) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      res();
    });
  });
}

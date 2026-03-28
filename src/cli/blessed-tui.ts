import blessed from "neo-blessed";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { initLang, t } from "../i18n/index.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { blessedSelect, blessedInput, blessedConfirm, blessedMessage } from "./blessed-prompts.js";
import { MODELS, EFFORTS, THINKING_OPTIONS } from "./models.js";

/**
 * Full blessed TUI -- orchestration dashboard + all interactions stay in blessed.
 * No clack fallback. Everything inside blessed.
 */

let screen: any;
let menuBox: any;
let contentBox: any;

export async function launchBlessedTUI(): Promise<void> {
  initLang();

  screen = blessed.screen({
    smartCSR: true,
    title: "eddgate",
    fullUnicode: true,
  });

  // Header
  blessed.box({
    parent: screen,
    top: 0, left: 0, width: "100%", height: 1,
    tags: true,
    style: { bg: "black" },
    content: " {yellow-fg}<|>{/yellow-fg} {bold}eddgate{/bold}  {gray-fg}Self-improving evaluation loop{/gray-fg}",
  });

  // Menu
  menuBox = blessed.list({
    parent: screen,
    label: ` {bold}Menu{/bold} `,
    tags: true,
    top: 1, left: 0, width: "25%", height: "100%-2",
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
      selected: { bg: "cyan", fg: "black", bold: true },
      item: { fg: "white" },
    },
    keys: true, vi: true, mouse: true,
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

  // Content
  contentBox = blessed.box({
    parent: screen,
    tags: true,
    top: 1, left: "25%", width: "75%", height: "100%-2",
    border: { type: "line" },
    style: { border: { fg: "gray" } },
    scrollable: true, alwaysScroll: true,
    scrollbar: { style: { bg: "cyan" } },
    keys: true, vi: true, mouse: true,
    padding: { left: 1, right: 1 },
  });

  // Status bar
  blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: "100%", height: 1,
    tags: true, style: { bg: "black" },
    content: " {cyan-fg}↑↓{/cyan-fg} navigate  {cyan-fg}Enter{/cyan-fg} select  {cyan-fg}Tab{/cyan-fg} switch  {cyan-fg}q{/cyan-fg} quit",
  });

  // Events
  menuBox.on("select item", async (_: unknown, i: number) => { await updateContent(i); });

  menuBox.on("select", async (_: unknown, i: number) => {
    if (i === 5) { quit(); return; }
    await handleInBlessed(i);
  });

  screen.key(["q", "C-c"], () => quit());
  screen.key(["tab"], () => {
    if ((menuBox as any).focused) contentBox.focus(); else menuBox.focus();
    screen.render();
  });

  menuBox.focus();
  menuBox.select(0);
  await updateContent(0);
  screen.render();
}

function quit(): void {
  screen.destroy();
  console.log(`\n${t("menu.bye")}\n`);
  process.exit(0);
}

// ─── Handle All Actions Inside Blessed ───────────────

async function handleInBlessed(index: number): Promise<void> {
  if (index === 0) await handleRun();
  if (index === 1) await handleAnalyze();
  if (index === 2) await handleTest();
  if (index === 3) await handleMcp();
  if (index === 4) await handleSettings();
}

async function handleRun(): Promise<void> {
  const workflows = await findWorkflows("./workflows")
    .then((w) => w.length > 0 ? w : findWorkflows("./templates/workflows"));

  if (workflows.length === 0) {
    await blessedMessage(screen, "No workflows found.\nRun: eddgate init", { label: "Error" });
    return;
  }

  const wf = await blessedSelect(screen, {
    message: t("run.workflow"),
    items: workflows.map((w) => ({ value: w, label: w })),
  });
  if (!wf) return;

  const input = await blessedInput(screen, { message: t("run.input") });
  if (!input) return;

  const lang = (await import("../i18n/index.js")).getLang();
  const isKo = lang === "ko";

  const model = await blessedSelect(screen, {
    message: t("run.model"),
    items: MODELS.map((m) => ({ value: m.value, label: m.label, hint: isKo ? m.hintKo : m.hint })),
  });
  if (!model) return;

  const effort = await blessedSelect(screen, {
    message: t("run.effort"),
    items: EFFORTS.map((e) => ({ value: e.value, label: e.label, hint: isKo ? e.hintKo : e.hint })),
  });
  if (!effort) return;

  const thinking = await blessedSelect(screen, {
    message: t("run.thinking"),
    items: THINKING_OPTIONS.map((t) => ({ value: t.value, label: t.label, hint: isKo ? t.hintKo : t.hint })),
  });
  if (!thinking) return;

  const confirmed = await blessedConfirm(screen, { message: `Run ${wf} with ${model}?` });
  if (!confirmed) return;

  // Clear main panels for dashboard
  menuBox.hide();
  contentBox.hide();

  const { setEffort, setThinking } = await import("../core/agent-runner.js");
  if (effort !== "medium") setEffort(effort);
  if (thinking !== "disabled") setThinking(thinking);

  let wfDir = resolve("./workflows");
  try { await readdir(wfDir); } catch { wfDir = resolve("./templates/workflows"); }
  let promptsDir = resolve("./prompts");
  try { await readdir(promptsDir); } catch { promptsDir = resolve("./templates/prompts"); }

  // Load workflow to get step IDs
  const { loadWorkflow, loadPrompt } = await import("../config/loader.js");
  const workflow = await loadWorkflow(resolve(wfDir, `${wf}.yaml`));
  workflow.config.defaultModel = model;

  // Load role prompts
  const rolePrompts = new Map<string, string>();
  for (const step of workflow.steps) {
    const role = step.context.identity.role;
    if (!rolePrompts.has(role)) {
      try { rolePrompts.set(role, await loadPrompt(resolve(promptsDir, `${role}.md`))); } catch { /* */ }
    }
  }

  // Create blessed execution dashboard
  const { createRunDashboard } = await import("./blessed-runner.js");
  const dashboard = createRunDashboard({
    screen,
    workflowName: workflow.name,
    stepIds: workflow.steps.map((s) => s.id),
    model,
  });

  // Run with tracer connected to dashboard
  const { TraceEmitter } = await import("../trace/emitter.js");
  const tracer = new TraceEmitter();
  tracer.onEvent(dashboard.onEvent);

  const { executeWorkflow } = await import("../core/workflow-engine.js");

  await executeWorkflow({ workflow, input, rolePrompts, tracer });

  // Wait for key, then return to main menu
  await new Promise<void>((res) => {
    screen.onceKey(["escape", "q", "enter", "space"], () => res());
  });

  dashboard.destroy();
  menuBox.show();
  contentBox.show();
  menuBox.focus();
  await updateContent(0);
  screen.render();
}

async function handleAnalyze(): Promise<void> {
  const ctx = await blessedConfirm(screen, { message: t("analyze.contextMode") });
  const gen = await blessedConfirm(screen, { message: t("analyze.generateRules") });

  // Run analyze and capture output
  menuBox.hide();
  contentBox.hide();

  const outputBox = blessed.log({
    parent: screen,
    top: 1, left: 0, width: "100%", height: "100%-2",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "yellow" } },
    label: ` ${t("menu.analyze")} `,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "yellow" } },
    mouse: true,
    padding: { left: 1 },
  });

  // Capture console.log
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    outputBox.log(args.map(String).join(" "));
    screen.render();
  };

  const { analyzeCommand } = await import("./commands/analyze.js");
  await analyzeCommand({ dir: "./traces", context: ctx, generateRules: gen, output: "./eval/rules" });

  console.log = origLog;
  outputBox.log("\n{gray-fg}Press any key to return...{/gray-fg}");
  screen.render();

  await new Promise<void>((res) => {
    screen.onceKey(["escape", "q", "enter", "space"], () => res());
  });

  outputBox.destroy();
  menuBox.show();
  contentBox.show();
  menuBox.focus();
  await updateContent(1);
  screen.render();
}

async function handleTest(): Promise<void> {
  const action = await blessedSelect(screen, {
    message: t("test.action"),
    items: [
      { value: "snapshot", label: t("test.snapshot") },
      { value: "diff", label: t("test.diff") },
      { value: "list", label: t("test.listSnapshots") },
    ],
  });
  if (!action) return;

  menuBox.hide();
  contentBox.hide();

  const outputBox = blessed.log({
    parent: screen,
    top: 1, left: 0, width: "100%", height: "100%-2",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "green" } },
    label: ` ${t("menu.test")} `,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "green" } },
    mouse: true,
    padding: { left: 1 },
  });

  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    outputBox.log(args.map(String).join(" "));
    screen.render();
  };
  console.error = console.log;

  // Override process.exit so test diff doesn't kill us
  const origExit = process.exit;
  let exitCalled = false;
  (process as any).exit = (code?: number) => { exitCalled = true; };

  const { testCommand } = await import("./commands/test.js");
  await testCommand(action, { dir: "./traces" });

  console.log = origLog;
  console.error = origError;
  (process as any).exit = origExit;

  outputBox.log("\n{gray-fg}Press any key to return...{/gray-fg}");
  screen.render();

  await new Promise<void>((res) => {
    screen.onceKey(["escape", "q", "enter", "space"], () => res());
  });

  outputBox.destroy();
  menuBox.show();
  contentBox.show();
  menuBox.focus();
  await updateContent(2);
  screen.render();
}

async function handleMcp(): Promise<void> {
  const configPath = resolve("./eddgate.config.yaml");
  let config: Record<string, unknown> = {};
  try {
    config = parseYaml(await readFile(configPath, "utf-8")) as Record<string, unknown> ?? {};
  } catch { /* */ }

  const mcp = (config.mcp as { servers?: Array<Record<string, unknown>> }) ?? { servers: [] };
  if (!mcp.servers) mcp.servers = [];

  const action = await blessedSelect(screen, {
    message: t("mcp.title"),
    items: [
      { value: "list", label: `${t("mcp.list")} (${mcp.servers.length})` },
      { value: "add", label: t("mcp.add") },
      { value: "remove", label: t("mcp.remove") },
    ],
  });
  if (!action) return;

  if (action === "list") {
    if (mcp.servers.length === 0) {
      await blessedMessage(screen, t("mcp.noServers"), { label: "MCP" });
    } else {
      const content = mcp.servers.map((s) =>
        `{cyan-fg}${s.name}{/cyan-fg} (${s.transport})\n  ${s.command ?? s.url ?? ""}`
      ).join("\n\n");
      await blessedMessage(screen, content, { label: "MCP Servers" });
    }
    return;
  }

  if (action === "add") {
    const name = await blessedInput(screen, { message: t("mcp.serverName") });
    if (!name) return;

    const transport = await blessedSelect(screen, {
      message: t("mcp.transport"),
      items: [
        { value: "stdio", label: "stdio" },
        { value: "http", label: "http" },
        { value: "sse", label: "sse" },
      ],
    });
    if (!transport) return;

    const target = await blessedInput(screen, {
      message: transport === "stdio" ? t("mcp.command") : t("mcp.url"),
    });
    if (!target) return;

    const server: Record<string, unknown> = { name, transport };
    if (transport === "stdio") server.command = target; else server.url = target;

    mcp.servers.push(server);
    config.mcp = mcp;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    await blessedMessage(screen, `{green-fg}${t("mcp.added")}: ${name}{/green-fg}`, { label: "MCP", height: 5 });
    await updateContent(3);
    return;
  }

  if (action === "remove") {
    if (mcp.servers.length === 0) {
      await blessedMessage(screen, t("mcp.noServers"), { label: "MCP", height: 5 });
      return;
    }
    const toRemove = await blessedSelect(screen, {
      message: t("mcp.remove"),
      items: mcp.servers.map((s) => ({ value: s.name as string, label: `${s.name} (${s.transport})` })),
    });
    if (!toRemove) return;

    mcp.servers = mcp.servers.filter((s) => s.name !== toRemove);
    config.mcp = mcp;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    await blessedMessage(screen, `{green-fg}${t("mcp.removed")}: ${toRemove}{/green-fg}`, { label: "MCP", height: 5 });
    await updateContent(3);
  }
}

async function handleSettings(): Promise<void> {
  const configPath = resolve("./eddgate.config.yaml");
  let config: Record<string, unknown> = {};
  try {
    config = parseYaml(await readFile(configPath, "utf-8")) as Record<string, unknown> ?? {};
  } catch {
    await blessedMessage(screen, "No config found. Run: eddgate init", { label: "Error" });
    return;
  }

  const model = (config.model as Record<string, unknown>) ?? { default: "sonnet" };
  const currentLang = (config.language as string) ?? "en";

  const setting = await blessedSelect(screen, {
    message: t("settings.title"),
    items: [
      { value: "model", label: `${t("settings.defaultModel")}: ${model.default}` },
      { value: "language", label: `${t("settings.language")}: ${currentLang === "ko" ? "한국어" : "English"}` },
      { value: "view", label: t("settings.viewConfig") },
    ],
  });
  if (!setting) return;

  if (setting === "model") {
    const lang = (await import("../i18n/index.js")).getLang();
    const isKo = lang === "ko";
    const newModel = await blessedSelect(screen, {
      message: t("settings.defaultModel"),
      items: MODELS.map((m) => ({ value: m.value, label: m.label, hint: isKo ? m.hintKo : m.hint })),
    });
    if (!newModel) return;

    model.default = newModel;
    config.model = model;
    await writeFile(configPath, stringifyYaml(config), "utf-8");
    await blessedMessage(screen, `{green-fg}Model: ${newModel}{/green-fg}`, { label: "Settings", height: 5 });
    await updateContent(4);
    return;
  }

  if (setting === "language") {
    const newLang = await blessedSelect(screen, {
      message: t("settings.language"),
      items: [
        { value: "ko", label: "한국어" },
        { value: "en", label: "English" },
      ],
    });
    if (!newLang) return;

    config.language = newLang;
    await writeFile(configPath, stringifyYaml(config), "utf-8");

    // Reload i18n and re-render
    const { setLang } = await import("../i18n/index.js");
    setLang(newLang as "ko" | "en");

    await blessedMessage(screen, `{green-fg}${t("settings.languageSet")}{/green-fg}`, { label: "Settings", height: 5 });

    // Re-launch to apply language everywhere
    screen.destroy();
    await launchBlessedTUI();
    return;
  }

  if (setting === "view") {
    try {
      const raw = await readFile(configPath, "utf-8");
      await blessedMessage(screen, raw, { label: "eddgate.config.yaml" });
    } catch { /* */ }
  }
}

// ─── Content Panels ──────────────────────────────────

async function updateContent(index: number): Promise<void> {
  const labels = [
    ` ${t("menu.run")} `, ` ${t("menu.analyze")} `, ` ${t("menu.test")} `,
    ` ${t("menu.mcp")} `, ` ${t("menu.config")} `,
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

async function renderRunPanel(): Promise<string> {
  const wfs = await findWorkflows("./workflows").then((w) => w.length > 0 ? w : findWorkflows("./templates/workflows"));
  const lines = [
    "", "  {bold}{cyan-fg}Run a Workflow{/cyan-fg}{/bold}", "",
    "  {gray-fg}The self-improving loop:{/gray-fg}",
    "  {cyan-fg}run{/cyan-fg} -> {yellow-fg}analyze{/yellow-fg} -> {green-fg}test{/green-fg} -> {cyan-fg}run{/cyan-fg} (improved)", "",
    "  {bold}Workflows:{/bold}",
  ];
  for (const wf of wfs) {
    const steps = await getStepCount(wf);
    lines.push(`    {cyan-fg}>{/cyan-fg} ${wf}  {gray-fg}(${steps} steps){/gray-fg}`);
  }
  lines.push("", "  {gray-fg}Press Enter to configure and run.{/gray-fg}");
  return lines.join("\n");
}

async function renderAnalyzePanel(): Promise<string> {
  let count = 0;
  try {
    const files = await readdir(resolve("./traces"));
    count = files.filter((f) => f.endsWith(".jsonl")).length;
  } catch { /* */ }
  return [
    "", "  {bold}{yellow-fg}Analyze Failures{/yellow-fg}{/bold}", "",
    `  {bold}Traces:{/bold}  ${count} file(s)`, "",
    "  {bold}Features:{/bold}",
    "    {yellow-fg}>{/yellow-fg} Cluster failure patterns",
    "    {yellow-fg}>{/yellow-fg} Auto-generate validation rules",
    "    {yellow-fg}>{/yellow-fg} Context window profiler", "",
    "  {gray-fg}Press Enter to analyze.{/gray-fg}",
  ].join("\n");
}

async function renderTestPanel(): Promise<string> {
  let count = 0;
  try {
    const files = await readdir(resolve("./.eddgate/snapshots"));
    count = files.filter((f) => f.endsWith(".json")).length;
  } catch { /* */ }
  return [
    "", "  {bold}{green-fg}Regression Testing{/green-fg}{/bold}", "",
    `  {bold}Snapshots:{/bold}  ${count}`, "",
    "  {green-fg}snapshot{/green-fg}  Save baseline",
    "  {green-fg}diff{/green-fg}      Compare against baseline",
    "  {green-fg}list{/green-fg}      Show snapshots", "",
    "  {gray-fg}Press Enter to manage.{/gray-fg}",
  ].join("\n");
}

async function renderMcpPanel(): Promise<string> {
  let servers: string[] = [];
  try {
    const raw = await readFile(resolve("./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    const mcp = config.mcp as { servers?: Array<Record<string, unknown>> } | undefined;
    servers = (mcp?.servers ?? []).map((s) => `${s.name} (${s.transport})`);
  } catch { /* */ }
  const lines = [
    "", "  {bold}{magenta-fg}MCP Servers{/magenta-fg}{/bold}", "",
    `  {bold}Configured:{/bold}  ${servers.length}`, "",
  ];
  if (servers.length > 0) {
    for (const s of servers) lines.push(`    {magenta-fg}>{/magenta-fg} ${s}`);
  } else {
    lines.push("    {gray-fg}No servers.{/gray-fg}");
  }
  lines.push("", "  {gray-fg}Press Enter to manage.{/gray-fg}");
  return lines.join("\n");
}

async function renderSettingsPanel(): Promise<string> {
  let model = "sonnet", lang = "en";
  try {
    const raw = await readFile(resolve("./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    model = ((config.model as Record<string, unknown>)?.default as string) ?? "sonnet";
    lang = (config.language as string) ?? "en";
  } catch { /* */ }
  return [
    "", "  {bold}{blue-fg}Settings{/blue-fg}{/bold}", "",
    `  {bold}Model:{/bold}     ${model}`,
    `  {bold}Language:{/bold}  ${lang === "ko" ? "한국어" : "English"}`, "",
    "  {gray-fg}Press Enter to modify.{/gray-fg}",
  ].join("\n");
}

// ─── Helpers ─────────────────────────────────────────

async function findWorkflows(dir: string): Promise<string[]> {
  try {
    return (await readdir(resolve(dir)))
      .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
      .map((f) => basename(f, extname(f)));
  } catch { return []; }
}

async function getStepCount(name: string): Promise<number> {
  for (const dir of ["./workflows", "./templates/workflows"]) {
    try {
      const raw = await readFile(resolve(dir, `${name}.yaml`), "utf-8");
      return (parseYaml(raw) as { steps?: unknown[] }).steps?.length ?? 0;
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

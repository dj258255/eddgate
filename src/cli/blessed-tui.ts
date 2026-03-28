import blessed from "neo-blessed";
import { readdir } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { initLang, t, getLang } from "../i18n/index.js";

/**
 * Blessed full-screen TUI -- lazydocker style.
 *
 * Layout:
 * +------ Menu ------+------------ Content -----------+
 * | > Run            | [depends on selected menu]     |
 * |   Analyze        |                                |
 * |   Test           |                                |
 * |   MCP            |                                |
 * |   Settings       |                                |
 * |   Exit           |                                |
 * +------------------+--------------------------------+
 * | Status bar: keys, hints                           |
 * +---------------------------------------------------+
 */

export async function launchBlessedTUI(): Promise<void> {
  initLang();

  const screen = blessed.screen({
    smartCSR: true,
    title: "eddgate",
    fullUnicode: true,
  });

  // ─── Menu Panel (left) ─────────────────────────────

  const menuBox = blessed.list({
    parent: screen,
    label: " {bold}{cyan-fg}eddgate{/cyan-fg}{/bold} ",
    tags: true,
    top: 0,
    left: 0,
    width: "30%",
    height: "100%-1",
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
      selected: { bg: "cyan", fg: "black", bold: true },
      item: { fg: "white" },
      label: { fg: "cyan" },
    },
    keys: true,
    vi: true,
    mouse: true,
    items: [
      ` ${t("menu.run")}`,
      ` ${t("menu.analyze")}`,
      ` ${t("menu.test")}`,
      ` ${t("menu.mcp")}`,
      ` ${t("menu.config")}`,
      ` ${t("menu.exit")}`,
    ],
  });

  // ─── Content Panel (right) ─────────────────────────

  const contentBox = blessed.box({
    parent: screen,
    label: " Info ",
    tags: true,
    top: 0,
    left: "30%",
    width: "70%",
    height: "100%-1",
    border: { type: "line" },
    style: {
      border: { fg: "gray" },
      label: { fg: "yellow" },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      style: { bg: "cyan" },
    },
    keys: true,
    vi: true,
    mouse: true,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
  });

  // ─── Status Bar (bottom) ───────────────────────────

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { bg: "black", fg: "white" },
    content: " {cyan-fg}↑↓{/cyan-fg}: navigate  {cyan-fg}Enter{/cyan-fg}: select  {cyan-fg}q{/cyan-fg}: quit  {cyan-fg}Tab{/cyan-fg}: switch panel",
  });

  // ─── Content Renderers ─────────────────────────────

  const contentRenderers: Record<number, () => Promise<string>> = {
    0: renderRunInfo,
    1: renderAnalyzeInfo,
    2: renderTestInfo,
    3: renderMcpInfo,
    4: renderSettingsInfo,
    5: async () => "",
  };

  async function updateContent(index: number): Promise<void> {
    const labels = [
      ` ${t("menu.run")} `,
      ` ${t("menu.analyze")} `,
      ` ${t("menu.test")} `,
      ` ${t("menu.mcp")} `,
      ` ${t("menu.config")} `,
      " Exit ",
    ];
    contentBox.setLabel(labels[index] ?? " Info ");

    const renderer = contentRenderers[index];
    if (renderer) {
      const text = await renderer();
      contentBox.setContent(text);
    }
    screen.render();
  }

  // ─── Events ────────────────────────────────────────

  menuBox.on("select item", async (_item: unknown, index: number) => {
    await updateContent(index);
  });

  menuBox.on("select", async (_item: unknown, index: number) => {
    if (index === 5) {
      // Exit
      screen.destroy();
      console.log(`\n${t("menu.bye")}\n`);
      process.exit(0);
    }

    if (index === 0) {
      // Run -- switch to clack for workflow selection, then come back
      screen.destroy();
      const { tuilauncher } = await import("./tui-launcher.js");
      const { setEffort, setThinking } = await import("../core/agent-runner.js");
      const { runCommand } = await import("./commands/run.js");

      const result = await tuilauncher();
      if (result.cancelled) {
        // Relaunch blessed TUI
        await launchBlessedTUI();
        return;
      }

      if (result.effort !== "medium") setEffort(result.effort);
      if (result.thinking !== "disabled") setThinking(result.thinking);

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
        tui: false,
        interactive: false,
        quiet: false,
        json: false,
        dryRun: false,
      });

      // After run, relaunch blessed
      await launchBlessedTUI();
      return;
    }

    if (index === 1) {
      // Analyze
      screen.destroy();
      const { analyzeCommand } = await import("./commands/analyze.js");
      const p = await import("@clack/prompts");

      const contextMode = await p.confirm({ message: t("analyze.contextMode") });
      if (p.isCancel(contextMode)) { await launchBlessedTUI(); return; }

      const genRules = await p.confirm({ message: t("analyze.generateRules") });
      if (p.isCancel(genRules)) { await launchBlessedTUI(); return; }

      await analyzeCommand({
        dir: "./traces",
        context: !!contextMode,
        generateRules: !!genRules,
        output: "./eval/rules",
      });

      console.log("\nPress any key to return...");
      await waitForKey();
      await launchBlessedTUI();
      return;
    }

    if (index === 2) {
      // Test
      screen.destroy();
      const { testCommand } = await import("./commands/test.js");
      const p = await import("@clack/prompts");

      const action = await p.select({
        message: t("test.action"),
        options: [
          { value: "snapshot", label: t("test.snapshot") },
          { value: "diff", label: t("test.diff") },
          { value: "list", label: t("test.listSnapshots") },
        ],
      });
      if (p.isCancel(action)) { await launchBlessedTUI(); return; }

      await testCommand(action as string, { dir: "./traces" });

      console.log("\nPress any key to return...");
      await waitForKey();
      await launchBlessedTUI();
      return;
    }

    if (index === 3 || index === 4) {
      // MCP / Settings -- use clack
      screen.destroy();
      const p = await import("@clack/prompts");

      if (index === 3) {
        const { tuiMcpManager } = await import("./blessed-tui-helpers.js");
        await tuiMcpManager(p);
      } else {
        const { tuiConfigManager } = await import("./blessed-tui-helpers.js");
        await tuiConfigManager(p);
      }

      await launchBlessedTUI();
      return;
    }
  });

  // Keyboard shortcuts
  screen.key(["q", "C-c"], () => {
    screen.destroy();
    console.log(`\n${t("menu.bye")}\n`);
    process.exit(0);
  });

  screen.key(["tab"], () => {
    if (menuBox.focused) {
      contentBox.focus();
    } else {
      menuBox.focus();
    }
    screen.render();
  });

  // Initial render
  menuBox.focus();
  menuBox.select(0);
  await updateContent(0);
  screen.render();
}

// ─── Content Renderers ───────────────────────────────

async function renderRunInfo(): Promise<string> {
  const workflows = await findWorkflows("./workflows")
    .then((wfs) => wfs.length > 0 ? wfs : findWorkflows("./templates/workflows"));

  return [
    "{bold}{cyan-fg}Run a Workflow{/cyan-fg}{/bold}",
    "",
    "Press Enter to start the workflow runner.",
    "",
    "{bold}Available workflows:{/bold}",
    ...workflows.map((wf, i) => `  ${i + 1}. ${wf}`),
    "",
    "{bold}The loop:{/bold}",
    "  run -> analyze -> test -> run (improved)",
    "",
    "{gray-fg}Each step passes through validation gates.",
    "Tier 1: Zod schema (deterministic, 0% false positive)",
    "Tier 2: LLM judge (key transitions only){/gray-fg}",
  ].join("\n");
}

async function renderAnalyzeInfo(): Promise<string> {
  // Count traces
  let traceCount = 0;
  try {
    const files = await readdir(resolve("./traces"));
    traceCount = files.filter((f) => f.endsWith(".jsonl")).length;
  } catch { /* no traces */ }

  return [
    "{bold}{yellow-fg}Analyze Failures{/yellow-fg}{/bold}",
    "",
    "Press Enter to analyze failure patterns.",
    "",
    `{bold}Traces found:{/bold} ${traceCount} file(s)`,
    "",
    "{bold}Features:{/bold}",
    "  - Cluster failure patterns by step + type",
    "  - Auto-generate validation rules",
    "  - Context window profiler",
    "",
    "{bold}Generated rules are auto-loaded{/bold}",
    "{gray-fg}on next eddgate run.{/gray-fg}",
  ].join("\n");
}

async function renderTestInfo(): Promise<string> {
  let snapshotCount = 0;
  try {
    const files = await readdir(resolve("./.eddgate/snapshots"));
    snapshotCount = files.filter((f) => f.endsWith(".json")).length;
  } catch { /* no snapshots */ }

  return [
    "{bold}{green-fg}Regression Testing{/green-fg}{/bold}",
    "",
    "Press Enter to manage behavioral snapshots.",
    "",
    `{bold}Snapshots:{/bold} ${snapshotCount}`,
    "",
    "{bold}Actions:{/bold}",
    "  snapshot  - Save current behavior as baseline",
    "  diff      - Compare new traces against baseline",
    "  list      - Show saved snapshots",
    "",
    "{gray-fg}test diff exits 1 on regression (CI-friendly).{/gray-fg}",
  ].join("\n");
}

async function renderMcpInfo(): Promise<string> {
  let serverCount = 0;
  try {
    const { readFile } = await import("node:fs/promises");
    const { parse: parseYaml } = await import("yaml");
    const raw = await readFile(resolve("./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    const mcp = config.mcp as { servers?: unknown[] } | undefined;
    serverCount = mcp?.servers?.length ?? 0;
  } catch { /* no config */ }

  return [
    "{bold}{magenta-fg}MCP Servers{/magenta-fg}{/bold}",
    "",
    "Press Enter to manage MCP servers.",
    "",
    `{bold}Configured:{/bold} ${serverCount} server(s)`,
    "",
    "{bold}Actions:{/bold}",
    "  list    - Show configured servers",
    "  add     - Add new server (stdio/http/sse)",
    "  remove  - Remove a server",
    "",
    "{gray-fg}MCP servers provide tools like",
    "web search, file ops, vector search.{/gray-fg}",
  ].join("\n");
}

async function renderSettingsInfo(): Promise<string> {
  let model = "sonnet";
  let lang = "en";
  try {
    const { readFile } = await import("node:fs/promises");
    const { parse: parseYaml } = await import("yaml");
    const raw = await readFile(resolve("./eddgate.config.yaml"), "utf-8");
    const config = parseYaml(raw) as Record<string, unknown>;
    const m = config.model as Record<string, unknown> | undefined;
    model = (m?.default as string) ?? "sonnet";
    lang = (config.language as string) ?? "en";
  } catch { /* no config */ }

  return [
    "{bold}{blue-fg}Settings{/blue-fg}{/bold}",
    "",
    "Press Enter to modify settings.",
    "",
    `{bold}Model:{/bold}    ${model}`,
    `{bold}Language:{/bold} ${lang === "ko" ? "한국어" : "English"}`,
    "",
    "{bold}Options:{/bold}",
    "  model     - Default LLM model",
    "  language  - UI language (ko/en)",
    "  traces    - Trace output config",
    "  view      - Show full config",
  ].join("\n");
}

// ─── Helpers ─────────────────────────────────────────

async function findWorkflows(dir: string): Promise<string[]> {
  try {
    const files = await readdir(resolve(dir));
    return files
      .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
      .map((f) => basename(f, extname(f)));
  } catch {
    return [];
  }
}

function waitForKey(): Promise<void> {
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

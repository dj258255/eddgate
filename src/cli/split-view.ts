import blessed from "neo-blessed";

/**
 * Split View -- before/after comparison (test diff) + rule preview (analyze)
 *
 * Layout:
 * +--------- Left ----------+--------- Right ----------+
 * | Before / Pattern List   | After / Rule YAML        |
 * |                         |                          |
 * +-------------------------+--------------------------+
 * | Status bar                                         |
 * +---------------------------------------------------+
 */

interface SplitViewOptions {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftContent: string;
  rightContent: string;
  statusHint?: string;
}

export function showSplitView(options: SplitViewOptions): Promise<void> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: options.title,
      fullUnicode: true,
    });

    // Header
    blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { bg: "black" },
      content: ` {yellow-fg}<|>{/yellow-fg} {bold}eddgate{/bold}  {gray-fg}${options.title}{/gray-fg}`,
    });

    // Left panel
    const leftBox = blessed.box({
      parent: screen,
      label: ` {bold}${options.leftLabel}{/bold} `,
      tags: true,
      top: 1,
      left: 0,
      width: "50%",
      height: "100%-2",
      border: { type: "line" },
      style: {
        border: { fg: "red" },
        label: { fg: "red" },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: "red" } },
      keys: true,
      vi: true,
      mouse: true,
      padding: { left: 1, right: 1 },
      content: options.leftContent,
    });

    // Right panel
    const rightBox = blessed.box({
      parent: screen,
      label: ` {bold}${options.rightLabel}{/bold} `,
      tags: true,
      top: 1,
      left: "50%",
      width: "50%",
      height: "100%-2",
      border: { type: "line" },
      style: {
        border: { fg: "green" },
        label: { fg: "green" },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: "green" } },
      keys: true,
      vi: true,
      mouse: true,
      padding: { left: 1, right: 1 },
      content: options.rightContent,
    });

    // Status bar
    blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { bg: "black" },
      content: ` {cyan-fg}Tab{/cyan-fg} switch panel  {cyan-fg}↑↓{/cyan-fg} scroll  {cyan-fg}q{/cyan-fg} close  ${options.statusHint ?? ""}`,
    });

    // Focus management
    let focusLeft = true;
    leftBox.focus();

    screen.key(["tab"], () => {
      focusLeft = !focusLeft;
      if (focusLeft) {
        leftBox.focus();
        (leftBox as any).style.border.fg = "red";
        (rightBox as any).style.border.fg = "gray";
      } else {
        rightBox.focus();
        (rightBox as any).style.border.fg = "gray";
        (leftBox as any).style.border.fg = "green";
      }
      screen.render();
    });

    screen.key(["q", "escape", "C-c"], () => {
      screen.destroy();
      resolve();
    });

    screen.render();
  });
}

/**
 * Show test diff results in split view.
 * Left: baseline behavior, Right: current behavior with changes highlighted.
 */
export function showDiffView(diffs: Array<{
  stepId: string;
  field: string;
  before: string;
  after: string;
  severity: string;
}>): Promise<void> {
  let leftLines = "{bold}Baseline{/bold}\n\n";
  let rightLines = "{bold}Current{/bold}\n\n";

  if (diffs.length === 0) {
    leftLines += "{green-fg}No changes detected.{/green-fg}";
    rightLines += "{green-fg}No changes detected.{/green-fg}";
  } else {
    for (const d of diffs) {
      const color = d.severity === "regression" ? "red" : d.severity === "improvement" ? "green" : "yellow";

      leftLines += `{gray-fg}${d.stepId}.${d.field}{/gray-fg}\n`;
      leftLines += `  ${d.before}\n\n`;

      rightLines += `{${color}-fg}${d.stepId}.${d.field}{/${color}-fg}\n`;
      rightLines += `  {${color}-fg}${d.after}{/${color}-fg}\n\n`;
    }
  }

  const regressions = diffs.filter((d) => d.severity === "regression").length;
  const improvements = diffs.filter((d) => d.severity === "improvement").length;

  return showSplitView({
    title: "Test Diff",
    leftLabel: "Before",
    rightLabel: "After",
    leftContent: leftLines,
    rightContent: rightLines,
    statusHint: `{red-fg}${regressions} regression(s){/red-fg}  {green-fg}${improvements} improvement(s){/green-fg}`,
  });
}

/**
 * Show generated rules in split view.
 * Left: failure patterns, Right: generated rule YAML.
 */
export function showRulePreview(clusters: Array<{
  id: string;
  description: string;
  count: number;
  percentage: number;
  fix: string;
  ruleYaml: string;
}>): Promise<void> {
  let leftLines = "{bold}Failure Patterns{/bold}\n\n";
  let rightLines = "{bold}Generated Rules{/bold}\n\n";

  for (const c of clusters) {
    leftLines += `{red-fg}${c.id}{/red-fg} ${c.description}\n`;
    leftLines += `  {gray-fg}${c.count} occurrences (${c.percentage.toFixed(0)}%){/gray-fg}\n`;
    leftLines += `  {cyan-fg}Fix:{/cyan-fg} ${c.fix}\n\n`;

    if (c.ruleYaml) {
      rightLines += `{yellow-fg}# ${c.id}{/yellow-fg}\n`;
      rightLines += `${c.ruleYaml}\n\n`;
    }
  }

  return showSplitView({
    title: "Analyze: Patterns + Rules",
    leftLabel: "Patterns",
    rightLabel: "Rules (YAML)",
    leftContent: leftLines,
    rightContent: rightLines,
    statusHint: `{yellow-fg}${clusters.length} pattern(s){/yellow-fg}`,
  });
}

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
      style: { bg: "#0a0e14", fg: "#7ec8e3" },
      content: ` {#fbbf24-fg}\u25C6{/#fbbf24-fg} {bold}eddgate{/bold}  {#546478-fg}${options.title}{/#546478-fg}`,
    });

    // Left panel (baseline / before)
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
        border: { fg: "#f87171" },
        label: { fg: "#f87171" },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: "#3d5066" } },
      keys: true,
      vi: true,
      mouse: true,
      padding: { left: 1, right: 1 },
      content: options.leftContent,
    });

    // Right panel (current / after)
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
        border: { fg: "#4ade80" },
        label: { fg: "#4ade80" },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: "#3d5066" } },
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
      style: { bg: "#0a0e14", fg: "#546478" },
      content: ` {#7ec8e3-fg}Tab{/#7ec8e3-fg} switch panel  {#7ec8e3-fg}\u2191\u2193{/#7ec8e3-fg} scroll  {#7ec8e3-fg}q{/#7ec8e3-fg} close  ${options.statusHint ?? ""}`,
    });

    // Focus management
    let focusLeft = true;
    leftBox.focus();

    screen.key(["tab"], () => {
      focusLeft = !focusLeft;
      if (focusLeft) {
        leftBox.focus();
        (leftBox as any).style.border.fg = "#f87171";
        (rightBox as any).style.border.fg = "#2a3a4a";
      } else {
        rightBox.focus();
        (rightBox as any).style.border.fg = "#2a3a4a";
        (leftBox as any).style.border.fg = "#4ade80";
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
    leftLines += "{#4ade80-fg}\u2713 No changes detected.{/#4ade80-fg}";
    rightLines += "{#4ade80-fg}\u2713 No changes detected.{/#4ade80-fg}";
  } else {
    for (const d of diffs) {
      const color = d.severity === "regression" ? "#f87171" : d.severity === "improvement" ? "#4ade80" : "#fbbf24";

      leftLines += `{#546478-fg}${d.stepId}.${d.field}{/#546478-fg}\n`;
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
    statusHint: `{#f87171-fg}\u2717 ${regressions} regression(s){/#f87171-fg}  {#4ade80-fg}\u2713 ${improvements} improvement(s){/#4ade80-fg}`,
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
    leftLines += `{#f87171-fg}\u2022 ${c.id}{/#f87171-fg} ${c.description}\n`;
    leftLines += `  {#546478-fg}${c.count} occurrences (${c.percentage.toFixed(0)}%){/#546478-fg}\n`;
    leftLines += `  {#7ec8e3-fg}Fix:{/#7ec8e3-fg} ${c.fix}\n\n`;

    if (c.ruleYaml) {
      rightLines += `{#fbbf24-fg}# ${c.id}{/#fbbf24-fg}\n`;
      rightLines += `${c.ruleYaml}\n\n`;
    }
  }

  return showSplitView({
    title: "Analyze: Patterns + Rules",
    leftLabel: "Patterns",
    rightLabel: "Rules (YAML)",
    leftContent: leftLines,
    rightContent: rightLines,
    statusHint: `{#fbbf24-fg}\u26A0 ${clusters.length} pattern(s){/#fbbf24-fg}`,
  });
}

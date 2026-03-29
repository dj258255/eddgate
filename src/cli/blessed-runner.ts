import blessed from "neo-blessed";
import type { TraceEvent } from "../types/index.js";
import type { TraceEmitter } from "../trace/emitter.js";

/**
 * Blessed execution dashboard -- Liquid Glass themed.
 *
 * Layout:
 * +--- Header: workflow | model | elapsed | tokens | cost ---+
 * +--- Steps --------+--- Log ------------------------------+
 * | [ok] classify     | [start] classify -> problem_analyzer |
 * | [>>] retrieve     | [llm]   sonnet (935->3655)          |
 * | [  ] taxonomy     | [gate]  retrieve PASS                |
 * | [  ] flow         | [done]  retrieve (57.3s)             |
 * +------------------+--------------------------------------+
 * | Status: Running...                                       |
 * +---------------------------------------------------------+
 */

interface RunDashboardOptions {
  screen: any;
  workflowName: string;
  stepIds: string[];
  model: string;
}

export function createRunDashboard(options: RunDashboardOptions): {
  onEvent: (event: TraceEvent) => void;
  destroy: () => void;
} {
  const { screen, workflowName, stepIds, model } = options;

  const startTime = Date.now();
  let totalTokens = 0;
  let totalCost = 0;
  const stepStatus = new Map<string, string>(stepIds.map((id) => [id, "    "]));

  // Header -- Liquid Glass: deep bg with accent text
  const headerBox = blessed.box({
    parent: screen,
    top: 0, left: 0, width: "100%", height: 1,
    tags: true,
    style: { bg: "#0a0e14", fg: "#7ec8e3" },
  });

  function updateHeader(): void {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    headerBox.setContent(
      ` {bold}\u25C6 ${workflowName}{/bold}` +
      `  {#5b8fb9-fg}${model}{/#5b8fb9-fg}` +
      `  {#546478-fg}\u2502{/#546478-fg}` +
      `  {#8b9bb4-fg}${min}:${sec.toString().padStart(2, "0")}{/#8b9bb4-fg}` +
      `  {#546478-fg}\u2502{/#546478-fg}` +
      `  {#8b9bb4-fg}${totalTokens.toLocaleString()} tok{/#8b9bb4-fg}` +
      `  {#4ade80-fg}$${totalCost.toFixed(4)}{/#4ade80-fg}`,
    );
  }

  // Steps panel (left) -- Liquid Glass: frosted surface
  const stepsBox = blessed.box({
    parent: screen,
    label: ` {#5b8fb9-fg}Steps{/#5b8fb9-fg} `,
    tags: true,
    top: 1, left: 0, width: "30%", height: "100%-2",
    border: { type: "line" },
    style: {
      border: { fg: "#2a3a4a" },
      bg: "#111820",
      fg: "#e8edf3",
    },
    padding: { left: 1, top: 0 },
  });

  function updateSteps(): void {
    const lines: string[] = [];
    for (let i = 0; i < stepIds.length; i++) {
      const id = stepIds[i];
      const status = stepStatus.get(id) ?? "    ";

      let color = "#546478";  // muted gray for pending
      let icon = "\u25CB ";   // circle for pending
      if (status === "running") { color = "#22d3ee"; icon = "\u25B6 "; }      // cyan play
      else if (status === "done") { color = "#4ade80"; icon = "\u2713 "; }     // green check
      else if (status === "fail") { color = "#f87171"; icon = "\u2717 "; }     // red x
      else if (status === "flag") { color = "#fbbf24"; icon = "\u26A0 "; }     // yellow warn

      const num = `${i + 1}`.padStart(2, " ");
      lines.push(`{${color}-fg}${icon}${num}. ${id}{/${color}-fg}`);
    }
    stepsBox.setContent(lines.join("\n"));
  }

  // Log panel (right) -- Liquid Glass: deep bg, accent scrollbar
  const logBox = blessed.log({
    parent: screen,
    label: ` {#5b8fb9-fg}Log{/#5b8fb9-fg} `,
    tags: true,
    top: 1, left: "30%", width: "70%", height: "100%-2",
    border: { type: "line" },
    style: {
      border: { fg: "#2a3a4a" },
      bg: "#0a0e14",
      fg: "#e8edf3",
    },
    scrollable: true, alwaysScroll: true,
    scrollbar: { style: { bg: "#3d5066" } },
    mouse: true,
    padding: { left: 1 },
  });

  // Status bar -- Liquid Glass
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: "100%", height: 1,
    tags: true,
    style: { bg: "#0a0e14", fg: "#546478" },
  });

  function setStatus(text: string): void {
    statusBar.setContent(` ${text}`);
  }

  setStatus("{#22d3ee-fg}\u25B6 Running...{/#22d3ee-fg}  {#546478-fg}\u2502{/#546478-fg}  {#5b8fb9-fg}q{/#5b8fb9-fg} cancel");

  // Timer -- update header every second
  const timer = setInterval(() => {
    updateHeader();
    screen.render();
  }, 1000);

  // Event handler
  function onEvent(event: TraceEvent): void {
    if (event.stepId !== "__workflow__") {
      switch (event.type) {
        case "step_start":
          stepStatus.set(event.stepId, "running");
          logBox.log(`{#22d3ee-fg}[\u25B6 start]{/#22d3ee-fg} ${event.stepId} {#546478-fg}\u2192{/#546478-fg} {#8b9bb4-fg}${event.context?.identity.role ?? ""}{/#8b9bb4-fg}`);
          break;

        case "step_end":
          if (stepStatus.get(event.stepId) === "running") {
            stepStatus.set(event.stepId, "done");
          }
          logBox.log(`{#4ade80-fg}[\u2713 done]{/#4ade80-fg}  ${event.stepId} {#546478-fg}(${formatMs(event.data.latencyMs)}){/#546478-fg}`);
          break;

        case "llm_call": {
          const tokens = (event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0);
          totalTokens += tokens;
          totalCost += event.data.cost ?? 0;
          logBox.log(`{#60a5fa-fg}[\u2022 llm]{/#60a5fa-fg}   ${event.data.model} {#546478-fg}(${event.data.inputTokens}\u2192${event.data.outputTokens}, ${formatMs(event.data.latencyMs)}){/#546478-fg}`);
          break;
        }

        case "tool_call":
          logBox.log(`{#a78bfa-fg}[\u2699 tool]{/#a78bfa-fg}  ${event.data.toolName}`);
          break;

        case "validation": {
          const passed = event.data.validationResult?.passed;
          if (passed) {
            logBox.log(`{#4ade80-fg}[\u2713 gate]{/#4ade80-fg}  ${event.stepId} PASS`);
          } else {
            logBox.log(`{#f87171-fg}[\u2717 gate]{/#f87171-fg}  ${event.stepId} FAIL`);
            stepStatus.set(event.stepId, "fail");
          }
          break;
        }

        case "evaluation": {
          const er = event.data.evaluationResult;
          const passed = er?.passed;
          if (passed) {
            logBox.log(`{#4ade80-fg}[\u2713 eval]{/#4ade80-fg}  ${event.stepId} score=${er?.score?.toFixed(2)}`);
          } else {
            logBox.log(`{#fbbf24-fg}[\u26A0 eval]{/#fbbf24-fg}  ${event.stepId} score=${er?.score?.toFixed(2)}`);
            if (stepStatus.get(event.stepId) !== "fail") {
              stepStatus.set(event.stepId, "flag");
            }
          }
          break;
        }

        case "error":
          logBox.log(`{#f87171-fg}[\u2717 err]{/#f87171-fg}   ${event.stepId} ${event.data.error?.slice(0, 80)}`);
          stepStatus.set(event.stepId, "fail");
          break;

        case "retrieval":
          logBox.log(`{#a78bfa-fg}[\u2022 rag]{/#a78bfa-fg}   ${event.stepId} ${event.data.retrievalResults?.length ?? 0} chunks`);
          break;
      }
    } else {
      if (event.type === "workflow_start") {
        logBox.log(`{bold}{#7ec8e3-fg}\u25C6 Workflow started: ${event.data.output}{/#7ec8e3-fg}{/bold}`);
      }
      if (event.type === "workflow_end") {
        const status = event.data.output === "success"
          ? "{#4ade80-fg}\u2713 SUCCESS{/#4ade80-fg}"
          : event.data.output === "partial"
            ? "{#fbbf24-fg}\u26A0 PARTIAL{/#fbbf24-fg}"
            : "{#f87171-fg}\u2717 FAILED{/#f87171-fg}";
        logBox.log(`\n{bold}\u25C6 Result: ${status}{/bold}  {#546478-fg}(${formatMs(event.data.latencyMs)}){/#546478-fg}`);
        setStatus(`${status}  {#546478-fg}\u2502{/#546478-fg}  Press any key to continue`);
      }
    }

    updateSteps();
    updateHeader();
    screen.render();
  }

  function destroy(): void {
    clearInterval(timer);
    headerBox.destroy();
    stepsBox.destroy();
    logBox.destroy();
    statusBar.destroy();
  }

  // Initial render
  updateHeader();
  updateSteps();
  screen.render();

  return { onEvent, destroy };
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "?";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

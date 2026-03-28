import blessed from "neo-blessed";
import type { TraceEvent } from "../types/index.js";
import type { TraceEmitter } from "../trace/emitter.js";

/**
 * Blessed execution dashboard -- runs INSIDE blessed, no screen destroy.
 *
 * Layout:
 * +--- Header: workflow | model | elapsed | tokens | cost ---+
 * +--- Steps --------+--- Log ------------------------------+
 * | [done] classify   | [start] classify -> problem_analyzer |
 * | [>>  ] retrieve   | [llm]   sonnet (935->3655)          |
 * | [    ] taxonomy   | [gate]  retrieve PASS                |
 * | [    ] flow       | [done]  retrieve (57.3s)             |
 * | [    ] citation   |                                      |
 * +------------------+--------------------------------------+
 * | Status: Running... Space: pause  q: quit                |
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

  // Header
  const headerBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { bg: "black" },
  });

  function updateHeader(): void {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    headerBox.setContent(
      ` {yellow-fg}<|>{/yellow-fg} {bold}${workflowName}{/bold}` +
      `  {cyan-fg}${model}{/cyan-fg}` +
      `  {gray-fg}${min}:${sec.toString().padStart(2, "0")}{/gray-fg}` +
      `  {gray-fg}${totalTokens.toLocaleString()} tok{/gray-fg}` +
      `  {green-fg}$${totalCost.toFixed(4)}{/green-fg}`,
    );
  }

  // Steps panel (left)
  const stepsBox = blessed.box({
    parent: screen,
    label: " Steps ",
    tags: true,
    top: 1,
    left: 0,
    width: "30%",
    height: "100%-2",
    border: { type: "line" },
    style: { border: { fg: "gray" } },
    padding: { left: 1, top: 0 },
  });

  function updateSteps(): void {
    const lines: string[] = [];
    for (let i = 0; i < stepIds.length; i++) {
      const id = stepIds[i];
      const status = stepStatus.get(id) ?? "    ";

      let color = "gray";
      let icon = "    ";
      if (status === "running") { color = "cyan"; icon = " >> "; }
      else if (status === "done") { color = "green"; icon = " ok "; }
      else if (status === "fail") { color = "red"; icon = " !! "; }
      else if (status === "flag") { color = "yellow"; icon = " ?? "; }

      lines.push(`{${color}-fg}[${icon}] ${i + 1}. ${id}{/${color}-fg}`);
    }
    stepsBox.setContent(lines.join("\n"));
  }

  // Log panel (right)
  const logBox = blessed.log({
    parent: screen,
    label: " Log ",
    tags: true,
    top: 1,
    left: "30%",
    width: "70%",
    height: "100%-2",
    border: { type: "line" },
    style: { border: { fg: "gray" } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "cyan" } },
    mouse: true,
    padding: { left: 1 },
  });

  // Status bar
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: { bg: "black" },
  });

  function setStatus(text: string): void {
    statusBar.setContent(` ${text}`);
  }

  setStatus("{cyan-fg}Running...{/cyan-fg}");

  // Timer
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
          logBox.log(`{cyan-fg}[start]{/cyan-fg} ${event.stepId} -> ${event.context?.identity.role ?? ""}`);
          break;

        case "step_end":
          if (stepStatus.get(event.stepId) === "running") {
            stepStatus.set(event.stepId, "done");
          }
          logBox.log(`{green-fg}[done]{/green-fg}  ${event.stepId} (${formatMs(event.data.latencyMs)})`);
          break;

        case "llm_call": {
          const tokens = (event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0);
          totalTokens += tokens;
          totalCost += event.data.cost ?? 0;
          logBox.log(`{blue-fg}[llm]{/blue-fg}   ${event.data.model} (${event.data.inputTokens}->${event.data.outputTokens}, ${formatMs(event.data.latencyMs)})`);
          break;
        }

        case "validation": {
          const passed = event.data.validationResult?.passed;
          const icon = passed ? "{green-fg}[gate]{/green-fg}" : "{red-fg}[gate]{/red-fg}";
          const result = passed ? "PASS" : "FAIL";
          logBox.log(`${icon}  ${event.stepId} ${result}`);
          if (!passed) stepStatus.set(event.stepId, "fail");
          break;
        }

        case "evaluation": {
          const er = event.data.evaluationResult;
          const passed = er?.passed;
          const icon = passed ? "{green-fg}[eval]{/green-fg}" : "{yellow-fg}[eval]{/yellow-fg}";
          logBox.log(`${icon}  ${event.stepId} score=${er?.score?.toFixed(2)}`);
          if (!passed && stepStatus.get(event.stepId) !== "fail") {
            stepStatus.set(event.stepId, "flag");
          }
          break;
        }

        case "error":
          logBox.log(`{red-fg}[err]{/red-fg}   ${event.stepId} ${event.data.error?.slice(0, 80)}`);
          stepStatus.set(event.stepId, "fail");
          break;
      }
    } else {
      if (event.type === "workflow_start") {
        logBox.log(`{bold}Workflow started: ${event.data.output}{/bold}`);
      }
      if (event.type === "workflow_end") {
        const status = event.data.output === "success"
          ? "{green-fg}SUCCESS{/green-fg}"
          : event.data.output === "partial"
            ? "{yellow-fg}PARTIAL{/yellow-fg}"
            : "{red-fg}FAILED{/red-fg}";
        logBox.log(`\n{bold}Result: ${status}{/bold}  (${formatMs(event.data.latencyMs)})`);
        setStatus(`${status}  Press any key to return`);
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
  return `${(ms / 1000).toFixed(1)}s`;
}

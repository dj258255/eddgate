import blessed from "neo-blessed";
import type { TraceEvent, WorkflowResult } from "../types/index.js";
import { loadAllTraces } from "../trace/trace-loader.js";
import { resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { t } from "../i18n/index.js";

// ─── Text-based chart helpers (pure neo-blessed) ────────

function textBar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

function textGauge(percent: number): string {
  const w = 30;
  const filled = Math.round((percent / 100) * w);
  const color = percent >= 70 ? "#4ade80" : percent >= 40 ? "#fbbf24" : "#f87171";
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
  return `{${color}-fg}[${bar}]{/${color}-fg} ${percent}%`;
}

function textTable(headers: string[], rows: string[][], colWidths: number[]): string {
  const sep = colWidths.map((w) => "\u2500".repeat(w)).join("\u2500\u253c\u2500");
  const hdr = headers.map((h, i) => h.padEnd(colWidths[i])).join(" \u2502 ");
  const lines = [
    `{bold}${hdr}{/bold}`,
    `{#546478-fg}${sep}{/#546478-fg}`,
    ...rows.map((row) => row.map((c, i) => c.padEnd(colWidths[i])).join(" \u2502 ")),
  ];
  return lines.join("\n");
}

// ─── Monitor Panel ──────────────────────────────────────

export async function showMonitorStatus(screen: any): Promise<void> {
  const events = await loadAllTraces(resolve("./traces"));
  if (events.length === 0) {
    return showEmptyPanel(screen, t("analyzeOutput.noTraces"));
  }

  const workflows = events.filter((e) => e.type === "workflow_end");
  const successCount = workflows.filter((w) => w.data.output === "success").length;
  const successRate = workflows.length > 0 ? Math.round((successCount / workflows.length) * 100) : 0;
  const llmCalls = events.filter((e) => e.type === "llm_call");
  const totalTokens = llmCalls.reduce((s, e) => s + (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0), 0);
  const totalCost = llmCalls.reduce((s, e) => s + (e.data.cost ?? 0), 0);
  const errors = events.filter((e) => e.type === "error").length;
  const steps = events.filter((e) => e.type === "step_end").length;
  const evalEvents = events.filter((e) => e.type === "evaluation").length;

  const latencies = workflows.map((w) => w.data.latencyMs ?? 0).filter((l) => l > 0).sort((a, b) => a - b);
  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  const content = [
    "",
    "  {bold}Success Rate{/bold}",
    `  ${textGauge(successRate)}`,
    "",
    `  ${textTable(
      ["Metric", "Value"],
      [
        ["Workflows", String(workflows.length)],
        ["Success", `${successCount}/${workflows.length}`],
        ["Steps", String(steps)],
        ["LLM calls", String(llmCalls.length)],
        ["Evaluations", String(evalEvents)],
        ["Errors", String(errors)],
        ["Tokens", totalTokens.toLocaleString()],
        ["Cost", `$${totalCost.toFixed(4)}`],
        ["Latency p50", fmtMs(p50)],
        ["Latency p95", fmtMs(p95)],
      ],
      [18, 16],
    ).split("\n").map((l) => "  " + l).join("\n")}`,
  ].join("\n");

  await showPanel(screen, " Monitor: Status ", content, "#7ec8e3");
}

export async function showMonitorCost(screen: any): Promise<void> {
  const events = await loadAllTraces(resolve("./traces"));
  if (events.length === 0) {
    return showEmptyPanel(screen, t("analyzeOutput.noTraces"));
  }

  const llmCalls = events.filter((e) => e.type === "llm_call");

  // By model
  const byModel = new Map<string, { calls: number; tokens: number; cost: number }>();
  for (const e of llmCalls) {
    const model = e.data.model ?? "unknown";
    const ex = byModel.get(model) ?? { calls: 0, tokens: 0, cost: 0 };
    ex.calls++;
    ex.tokens += (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0);
    ex.cost += e.data.cost ?? 0;
    byModel.set(model, ex);
  }

  // By step
  const byStep = new Map<string, { calls: number; tokens: number; cost: number }>();
  for (const e of llmCalls) {
    const ex = byStep.get(e.stepId) ?? { calls: 0, tokens: 0, cost: 0 };
    ex.calls++;
    ex.tokens += (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0);
    ex.cost += e.data.cost ?? 0;
    byStep.set(e.stepId, ex);
  }

  const modelEntries = [...byModel.entries()];
  const maxModelCost = Math.max(...modelEntries.map(([, d]) => d.cost), 0.001);

  const lines = [
    "",
    "  {bold}Cost by Model{/bold}",
    "",
  ];
  for (const [model, data] of modelEntries) {
    const bar = textBar(data.cost, maxModelCost, 25);
    lines.push(`  {#7ec8e3-fg}${model.padEnd(14)}{/#7ec8e3-fg} {#4ade80-fg}${bar}{/#4ade80-fg} $${data.cost.toFixed(4)}`);
  }

  lines.push(
    "",
    "  {bold}Cost by Step{/bold}",
    "",
    `  ${textTable(
      ["Step", "Calls", "Tokens", "Cost"],
      [...byStep.entries()].map(([step, d]) => [
        step.length > 16 ? step.slice(0, 16) : step,
        String(d.calls),
        d.tokens.toLocaleString(),
        `$${d.cost.toFixed(4)}`,
      ]),
      [16, 6, 12, 10],
    ).split("\n").map((l) => "  " + l).join("\n")}`,
  );

  await showPanel(screen, " Monitor: Cost ", lines.join("\n"), "#4ade80");
}

export async function showMonitorQuality(screen: any): Promise<void> {
  const events = await loadAllTraces(resolve("./traces"));
  const evals = events.filter((e) => e.type === "evaluation" && e.data.evaluationResult);

  if (evals.length === 0) {
    return showEmptyPanel(screen, "No evaluation data found.");
  }

  const byStep = new Map<string, number[]>();
  for (const e of evals) {
    const scores = byStep.get(e.stepId) ?? [];
    scores.push(e.data.evaluationResult!.score);
    byStep.set(e.stepId, scores);
  }

  const lines = [
    "",
    "  {bold}Evaluation Scores{/bold}",
    "",
    `  ${textTable(
      ["Step", "Avg", "Min", "Max", "Runs"],
      [...byStep.entries()].map(([step, scores]) => {
        const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
        return [
          step.length > 16 ? step.slice(0, 16) : step,
          avg.toFixed(2),
          Math.min(...scores).toFixed(2),
          Math.max(...scores).toFixed(2),
          String(scores.length),
        ];
      }),
      [16, 6, 6, 6, 5],
    ).split("\n").map((l) => "  " + l).join("\n")}`,
    "",
    "  {bold}Score Distribution{/bold}",
    "",
  ];

  for (const [step, scores] of byStep) {
    const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
    const bar = textBar(avg, 1.0, 20);
    const color = avg >= 0.7 ? "#4ade80" : avg >= 0.4 ? "#fbbf24" : "#f87171";
    lines.push(`  ${step.padEnd(16)} {${color}-fg}${bar}{/${color}-fg} ${avg.toFixed(2)}`);
  }

  await showPanel(screen, " Monitor: Quality ", lines.join("\n"), "#fbbf24");
}

// ─── Trace Viewer Panel ─────────────────────────────────

export function getTraceFiles(): Promise<string[]> {
  return readdir(resolve("./traces"))
    .then((entries) => entries.filter((f) => f.endsWith(".jsonl")).sort().reverse())
    .catch(() => []);
}

export async function showTraceTimeline(screen: any, filePath: string): Promise<void> {
  let events: TraceEvent[] = [];
  try {
    const raw = await readFile(resolve(filePath), "utf-8");
    events = raw.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line) as TraceEvent; } catch { return null; }
    }).filter((e): e is TraceEvent => e !== null);
  } catch { /* */ }

  if (events.length === 0) {
    return showEmptyPanel(screen, "No events in trace file.");
  }

  const traceId = events[0].traceId.slice(0, 8);
  const wfStart = events.find((e) => e.type === "workflow_start");
  const wfEnd = events.find((e) => e.type === "workflow_end");
  const llmCalls = events.filter((e) => e.type === "llm_call");
  const totalTokens = llmCalls.reduce((s, e) => s + (e.data.inputTokens ?? 0) + (e.data.outputTokens ?? 0), 0);
  const totalCost = llmCalls.reduce((s, e) => s + (e.data.cost ?? 0), 0);

  // Header
  const headerBox = blessed.box({
    parent: screen,
    top: 1, left: 0, width: "100%", height: 3,
    tags: true,
    style: { bg: "#0a0e14" },
    padding: { left: 1 },
    content:
      ` {bold}Trace:{/bold} ${traceId}...` +
      `  {bold}Workflow:{/bold} ${wfStart?.data.output ?? "?"}` +
      `  {bold}Status:{/bold} ${wfEnd?.data.output ?? "running"}` +
      `  {bold}Events:{/bold} ${events.length}` +
      `  {bold}Tokens:{/bold} ${totalTokens.toLocaleString()}` +
      `  {bold}Cost:{/bold} $${totalCost.toFixed(4)}`,
  });

  // Steps summary (left)
  const stepStarts = events.filter((e) => e.type === "step_start");
  const stepEnds = events.filter((e) => e.type === "step_end");
  const stepIds = [...new Set(stepStarts.map((e) => e.stepId))];

  const stepsBox = blessed.box({
    parent: screen,
    top: 4, left: 0, width: "30%", height: "100%-5",
    tags: true,
    label: " Steps ",
    border: { type: "line" },
    style: { border: { fg: "#2a3a4a" }, label: { fg: "#8b9bb4" } },
    padding: { left: 1 },
    scrollable: true,
    mouse: true,
  });

  const stepLines: string[] = [];
  for (const sid of stepIds) {
    const end = stepEnds.find((e) => e.stepId === sid);
    const evalEvt = events.find((e) => e.stepId === sid && e.type === "evaluation");
    const errEvt = events.find((e) => e.stepId === sid && e.type === "error");

    let status = "{#4ade80-fg}\u2713{/#4ade80-fg}";
    if (errEvt) status = "{#f87171-fg}\u2717{/#f87171-fg}";
    else if (evalEvt && !evalEvt.data.evaluationResult?.passed) status = "{#fbbf24-fg}\u26A0{/#fbbf24-fg}";
    else if (!end) status = "{#546478-fg}\u25CB{/#546478-fg}";

    const ms = end ? ` ${fmtMs(end.data.latencyMs)}` : "";
    stepLines.push(`[${status}] ${sid}${ms}`);
  }
  stepsBox.setContent(stepLines.join("\n"));

  // Timeline (right)
  const logBox = blessed.log({
    parent: screen,
    top: 4, left: "30%", width: "70%", height: "100%-5",
    tags: true,
    label: " Timeline ",
    border: { type: "line" },
    style: { border: { fg: "#7ec8e3" }, label: { fg: "#7ec8e3" } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "#3d5066" } },
    keys: true, vi: true, mouse: true,
    padding: { left: 1 },
  });

  for (const event of events) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const step = event.stepId === "__workflow__" ? "" : ` {#546478-fg}[${event.stepId}]{/#546478-fg}`;

    switch (event.type) {
      case "workflow_start":
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {bold}\u25B6 START{/bold}${step} ${event.data.output}`);
        break;
      case "workflow_end": {
        const color = event.data.output === "success" ? "#4ade80" : event.data.output === "partial" ? "#fbbf24" : "#f87171";
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {bold}{${color}-fg}\u25C6 END{/${color}-fg}{/bold}${step} ${event.data.output} (${fmtMs(event.data.latencyMs)})`);
        break;
      }
      case "step_start":
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {#7ec8e3-fg}\u2192 STEP{/#7ec8e3-fg}${step} -> ${event.context?.identity.role ?? ""}`);
        break;
      case "step_end":
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {#7ec8e3-fg}\u2192 STEP{/#7ec8e3-fg}${step} <- ${fmtMs(event.data.latencyMs)} (${((event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0)).toLocaleString()} tok)`);
        break;
      case "llm_call":
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {#60a5fa-fg}\u2022 LLM{/#60a5fa-fg}${step} ${event.data.model} (${event.data.inputTokens}->${event.data.outputTokens}, ${fmtMs(event.data.latencyMs)})`);
        break;
      case "validation": {
        const vr = event.data.validationResult;
        const icon = vr?.passed ? "{#4ade80-fg}\u2713 PASS{/#4ade80-fg}" : "{#f87171-fg}\u2717 FAIL{/#f87171-fg}";
        logBox.log(`{#546478-fg}${time}{/#546478-fg} ${icon}${step}`);
        if (vr && !vr.passed) {
          for (const f of vr.failures) {
            logBox.log(`         {#f87171-fg}${f.rule.message}{/#f87171-fg}`);
          }
        }
        break;
      }
      case "evaluation": {
        const er = event.data.evaluationResult;
        const icon = er?.passed ? "{#4ade80-fg}\u2713 EVAL{/#4ade80-fg}" : "{#fbbf24-fg}\u26A0 EVAL{/#fbbf24-fg}";
        logBox.log(`{#546478-fg}${time}{/#546478-fg} ${icon}${step} score=${er?.score.toFixed(2)}`);
        break;
      }
      case "retrieval": {
        const chunks = event.data.retrievalResults ?? [];
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {#a78bfa-fg}\u25C6 RETR{/#a78bfa-fg}${step} ${chunks.length} chunks`);
        break;
      }
      case "error":
        logBox.log(`{#546478-fg}${time}{/#546478-fg} {#f87171-fg}\u2717 ERR{/#f87171-fg}${step} ${event.data.error}`);
        break;
    }
  }

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: "100%", height: 1,
    tags: true, style: { bg: "#0a0e14" },
    content: " {#7ec8e3-fg}Tab{/#7ec8e3-fg} switch  {#7ec8e3-fg}Esc{/#7ec8e3-fg} back  {#7ec8e3-fg}up/down{/#7ec8e3-fg} scroll",
  });

  logBox.focus();

  const tabHandler = () => {
    if ((logBox as any).focused) stepsBox.focus();
    else logBox.focus();
    screen.render();
  };
  screen.key(["tab"], tabHandler);

  screen.render();
  await waitForKey(screen);

  screen.unkey(["tab"], tabHandler);
  headerBox.destroy();
  stepsBox.destroy();
  logBox.destroy();
  statusBar.destroy();
}

// ─── Post-Run Results Panel ─────────────────────────────

export function showRunResults(screen: any, result: WorkflowResult): Promise<void> {
  const statusColor = result.status === "success" ? "#4ade80" : result.status === "partial" ? "#fbbf24" : "#f87171";
  const statusIcon = result.status === "success" ? "\u2713" : result.status === "partial" ? "\u26A0" : "\u2717";

  const lines = [
    "",
    `  {bold}{${statusColor}-fg}${statusIcon}{/${statusColor}-fg}{/bold}  ${result.workflowName}`,
    "",
    `  Time:   ${(result.totalDurationMs / 1000).toFixed(1)}s`,
    `  Tokens: ${(result.totalTokens.input + result.totalTokens.output).toLocaleString()}`,
    `  Cost:   {#4ade80-fg}$${result.totalCostEstimate.toFixed(4)}{/#4ade80-fg}`,
    `  Trace:  {#546478-fg}${result.traceId.slice(0, 12)}{/#546478-fg}`,
    "",
    `  ${textTable(
      ["Step", "Status", "Time", "Tokens", "Eval"],
      result.steps.map((step) => {
        const st = step.status === "success" ? "{#4ade80-fg}\u2713{/#4ade80-fg}" :
                   step.status === "flagged" ? "{#fbbf24-fg}\u26A0{/#fbbf24-fg}" :
                   step.status === "skipped" ? "{#546478-fg}\u25CB{/#546478-fg}" :
                   "{#f87171-fg}\u2717{/#f87171-fg}";
        const tokens = step.tokenUsage.input + step.tokenUsage.output;
        const evalStr = step.evaluation ? step.evaluation.score.toFixed(2) : "-";
        return [
          step.stepId.length > 18 ? step.stepId.slice(0, 18) : step.stepId,
          st,
          `${(step.durationMs / 1000).toFixed(1)}s`,
          tokens.toLocaleString(),
          evalStr,
        ];
      }),
      [18, 12, 8, 12, 6],
    ).split("\n").map((l) => "  " + l).join("\n")}`,
  ];

  return showPanel(screen, " Results ", lines.join("\n"), statusColor);
}

// ─── Shared helpers ─────────────────────────────────────

function fmtMs(ms?: number): string {
  if (ms === undefined) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function waitForKey(screen: any): Promise<void> {
  return new Promise((res) => {
    screen.onceKey(["escape", "q", "enter", "space"], () => res());
  });
}

async function showEmptyPanel(screen: any, message: string): Promise<void> {
  await showPanel(screen, " Info ", `\n\n  {#546478-fg}${message}{/#546478-fg}`, "#2a3a4a");
}

function showPanel(screen: any, label: string, content: string, borderColor: string): Promise<void> {
  const box = blessed.box({
    parent: screen,
    top: 1, left: 0, width: "100%", height: "100%-2",
    tags: true,
    label,
    border: { type: "line" },
    style: { border: { fg: borderColor }, label: { fg: borderColor } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: "#3d5066" } },
    keys: true, vi: true, mouse: true,
    padding: { left: 1, right: 1 },
    content,
  });
  const bar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: "100%", height: 1,
    tags: true, style: { bg: "#0a0e14" },
    content: " {#7ec8e3-fg}Esc{/#7ec8e3-fg} back  {#7ec8e3-fg}up/down{/#7ec8e3-fg} scroll",
  });
  box.focus();
  screen.render();

  return new Promise<void>((res) => {
    screen.onceKey(["escape", "q", "enter", "space"], () => {
      box.destroy();
      bar.destroy();
      res();
    });
  });
}

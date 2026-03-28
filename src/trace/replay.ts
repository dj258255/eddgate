import { readFile } from "node:fs/promises";
import chalk from "chalk";
import type { TraceEvent } from "../types/index.js";

/**
 * Trace Replay
 *
 * Replay a saved trace step-by-step for debugging.
 * Shows what happened at each point with timing.
 */
export async function replayTrace(
  tracePath: string,
  options: { speed?: number; stepFilter?: string } = {},
): Promise<void> {
  const content = await readFile(tracePath, "utf-8");
  const events = content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as TraceEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is TraceEvent => e !== null);

  if (events.length === 0) {
    console.log(chalk.dim("No events found in trace."));
    return;
  }

  const filteredEvents = options.stepFilter
    ? events.filter(
        (e) =>
          e.stepId === options.stepFilter || e.stepId === "__workflow__",
      )
    : events;

  const speed = options.speed ?? 1;
  const startTime = new Date(filteredEvents[0].timestamp).getTime();

  console.log(chalk.bold("\n-- Trace Replay --\n"));
  console.log(
    chalk.dim(
      `Trace: ${events[0].traceId.slice(0, 8)}... | ${events.length} events | speed: ${speed}x\n`,
    ),
  );

  let prevTime = startTime;

  for (const event of filteredEvents) {
    const eventTime = new Date(event.timestamp).getTime();
    const gap = eventTime - prevTime;

    // Simulate timing gap (scaled by speed)
    if (gap > 0 && speed > 0) {
      const delay = Math.min(gap / speed, 2000);
      await sleep(delay);
    }

    printReplayEvent(event, startTime);
    prevTime = eventTime;
  }

  console.log(chalk.dim("\n-- Replay Complete --\n"));
}

function printReplayEvent(event: TraceEvent, startTime: number): void {
  const elapsed = new Date(event.timestamp).getTime() - startTime;
  const elapsedStr = `+${(elapsed / 1000).toFixed(1)}s`;
  const step = event.stepId === "__workflow__" ? "" : ` [${event.stepId}]`;

  switch (event.type) {
    case "workflow_start":
      console.log(
        `${chalk.dim(elapsedStr)} ${chalk.bold("START")}${step} ${event.data.output}`,
      );
      break;
    case "workflow_end":
      console.log(
        `${chalk.dim(elapsedStr)} ${chalk.bold("END")}${step} ${event.data.output}`,
      );
      break;
    case "step_start":
      console.log(
        `${chalk.dim(elapsedStr)} ${chalk.cyan("STEP")}${step} -> ${event.context?.identity.role ?? "?"}`,
      );
      if (event.context?.identity.constraints.length) {
        for (const c of event.context.identity.constraints) {
          console.log(chalk.dim(`          constraint: ${c}`));
        }
      }
      break;
    case "step_end":
      console.log(
        `${chalk.dim(elapsedStr)} ${chalk.cyan("STEP")}${step} <- ${formatMs(event.data.latencyMs)}`,
      );
      break;
    case "llm_call":
      console.log(
        `${chalk.dim(elapsedStr)} ${chalk.blue("LLM")}${step} ${event.data.model} (${event.data.inputTokens}->${event.data.outputTokens} tok)`,
      );
      break;
    case "validation": {
      const vr = event.data.validationResult;
      const icon = vr?.passed ? chalk.green("PASS") : chalk.red("FAIL");
      console.log(`${chalk.dim(elapsedStr)} ${icon}${step}`);
      if (vr && !vr.passed) {
        for (const f of vr.failures) {
          console.log(chalk.red(`          ${f.rule.message}`));
        }
      }
      break;
    }
    case "evaluation": {
      const er = event.data.evaluationResult;
      const icon = er?.passed ? chalk.green("EVAL") : chalk.yellow("EVAL");
      console.log(
        `${chalk.dim(elapsedStr)} ${icon}${step} score=${er?.score.toFixed(2)}`,
      );
      break;
    }
    case "error":
      console.log(
        `${chalk.dim(elapsedStr)} ${chalk.red("ERR")}${step} ${event.data.error}`,
      );
      break;
  }
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import type { TraceEvent } from "../../types/index.js";

interface TraceOptions {
  format: string;
  dir: string;
}

export async function traceCommand(
  traceIdOrFile: string,
  options: TraceOptions,
): Promise<void> {
  try {
    const events = await loadTrace(traceIdOrFile, options.dir);

    if (events.length === 0) {
      console.log(chalk.dim("트레이스를 찾을 수 없습니다."));
      return;
    }

    if (options.format === "json") {
      console.log(JSON.stringify(events, null, 2));
    } else {
      renderTraceSummary(events);
    }
  } catch (err) {
    console.error(
      chalk.red(`오류: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }
}

async function loadTrace(
  traceIdOrFile: string,
  dir: string,
): Promise<TraceEvent[]> {
  // 직접 파일 경로인 경우
  if (traceIdOrFile.endsWith(".jsonl")) {
    return parseJsonl(await readFile(resolve(traceIdOrFile), "utf-8"));
  }

  // trace ID로 검색
  const traceDir = resolve(dir);
  const files = await readdir(traceDir).catch(() => []);

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const content = await readFile(join(traceDir, file), "utf-8");
    const events = parseJsonl(content);
    if (events.some((e) => e.traceId.startsWith(traceIdOrFile))) {
      return events.filter((e) => e.traceId.startsWith(traceIdOrFile));
    }
  }

  return [];
}

function parseJsonl(content: string): TraceEvent[] {
  return content
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
}

function renderTraceSummary(events: TraceEvent[]): void {
  const traceId = events[0]?.traceId ?? "unknown";
  const workflowStart = events.find((e) => e.type === "workflow_start");
  const workflowEnd = events.find((e) => e.type === "workflow_end");
  const stepStarts = events.filter((e) => e.type === "step_start");
  const stepEnds = events.filter((e) => e.type === "step_end");
  const llmCalls = events.filter((e) => e.type === "llm_call");
  const validations = events.filter((e) => e.type === "validation");
  const evaluations = events.filter((e) => e.type === "evaluation");
  const errors = events.filter((e) => e.type === "error");

  console.log(chalk.bold(`\nTrace: ${traceId.slice(0, 8)}...`));

  if (workflowStart) {
    console.log(`Workflow: ${workflowStart.data.output}`);
  }
  if (workflowEnd) {
    console.log(
      `Status: ${workflowEnd.data.output} (${formatMs(workflowEnd.data.latencyMs)})`,
    );
  }

  console.log(`Events: ${events.length} total`);
  console.log(
    `  Steps: ${stepStarts.length} started, ${stepEnds.length} ended`,
  );
  console.log(`  LLM calls: ${llmCalls.length}`);
  console.log(`  Validations: ${validations.length}`);
  console.log(`  Evaluations: ${evaluations.length}`);
  console.log(`  Errors: ${errors.length}`);

  // 토큰 합계
  const totalInput = llmCalls.reduce(
    (s, e) => s + (e.data.inputTokens ?? 0),
    0,
  );
  const totalOutput = llmCalls.reduce(
    (s, e) => s + (e.data.outputTokens ?? 0),
    0,
  );
  const totalCost = llmCalls.reduce((s, e) => s + (e.data.cost ?? 0), 0);

  console.log(
    `\nTokens: ${totalInput.toLocaleString()} input + ${totalOutput.toLocaleString()} output`,
  );
  if (totalCost > 0) {
    console.log(`Cost: $${totalCost.toFixed(4)}`);
  }

  // 단계별 타임라인
  console.log(chalk.dim("\n-- Timeline --\n"));

  for (const event of events) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const step =
      event.stepId === "__workflow__" ? "" : ` [${event.stepId}]`;

    switch (event.type) {
      case "workflow_start":
        console.log(`${chalk.dim(time)} START${step} ${event.data.output}`);
        break;
      case "workflow_end":
        console.log(
          `${chalk.dim(time)} END${step} ${event.data.output} (${formatMs(event.data.latencyMs)})`,
        );
        break;
      case "step_start":
        console.log(
          `${chalk.dim(time)} ${chalk.cyan("STEP")}${step} -> ${event.context?.identity.role}`,
        );
        break;
      case "step_end":
        console.log(
          `${chalk.dim(time)} ${chalk.cyan("STEP")}${step} <- ${formatMs(event.data.latencyMs)} (${((event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0)).toLocaleString()} tok)`,
        );
        break;
      case "llm_call":
        console.log(
          `${chalk.dim(time)} ${chalk.blue("LLM")}${step} ${event.data.model} (${event.data.inputTokens}->${event.data.outputTokens} tok, ${formatMs(event.data.latencyMs)})`,
        );
        break;
      case "validation": {
        const vr = event.data.validationResult;
        const icon = vr?.passed ? chalk.green("PASS") : chalk.red("FAIL");
        console.log(`${chalk.dim(time)} ${icon}${step}`);
        if (vr && !vr.passed) {
          for (const f of vr.failures) {
            console.log(chalk.red(`         ${f.rule.message}`));
          }
        }
        break;
      }
      case "evaluation": {
        const er = event.data.evaluationResult;
        const icon = er?.passed ? chalk.green("EVAL") : chalk.red("EVAL");
        console.log(
          `${chalk.dim(time)} ${icon}${step} score=${er?.score.toFixed(2)}`,
        );
        break;
      }
      case "error":
        console.log(
          `${chalk.dim(time)} ${chalk.red("ERR")}${step} ${event.data.error}`,
        );
        break;
    }
  }
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "?";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

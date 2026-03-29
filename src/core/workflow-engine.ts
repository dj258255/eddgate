import { createInterface } from "node:readline";
import pLimit from "p-limit";
import type {
  WorkflowDefinition,
  StepDefinition,
  StepResult,
  WorkflowResult,
} from "../types/index.js";
import type { EvaluationResult } from "../types/index.js";
import { buildContext } from "./context-builder.js";
import { runAgent } from "./agent-runner.js";
import { validateOutput } from "../eval/tier1-rules.js";
import { runTier2Evaluation } from "../eval/tier2-llm.js";
import { TraceEmitter } from "../trace/emitter.js";

// Concurrency cap for parallel layer execution (prevents rate limiting)
const DEFAULT_CONCURRENCY = 5;

/**
 * Workflow Engine
 *
 * pipeline/parallel/single 토폴로지 지원.
 * 검색<->생성 강제 분리. Validation gate. Human approval.
 *
 * 핵심 규칙:
 * 1. 검색과 생성은 반드시 별도 Step
 * 2. Validation Step 필수
 * 3. 근거 부족 결과는 다음 단계 전달 금지
 */

interface WorkflowEngineOptions {
  workflow: WorkflowDefinition;
  input: string;
  rolePrompts?: Map<string, string>;
  tracer?: TraceEmitter;
  maxBudgetUsd?: number;
  modelOverrides?: {
    classify?: string;
    generate?: string;
    validate?: string;
  };
}

export async function executeWorkflow(
  options: WorkflowEngineOptions,
): Promise<WorkflowResult> {
  const { workflow, input, rolePrompts, maxBudgetUsd, modelOverrides } = options;
  const tracer = options.tracer ?? new TraceEmitter();
  const results = new Map<string, StepResult>();
  const stepResults: StepResult[] = [];
  let accumulatedCost = 0;

  const workflowStart = performance.now();
  tracer.workflowStart(workflow.name);

  const orderedSteps = topologicalSort(workflow.steps);

  if (workflow.config.topology === "parallel") {
    // parallel: run independent steps concurrently
    const layers = buildParallelLayers(orderedSteps);

    const limit = pLimit(DEFAULT_CONCURRENCY);

    for (const layer of layers) {
      const layerPromises = layer.map((step) => limit(async () => {
        if (hasDependencyFailure(step, results)) {
          return createSkippedResult(step.id);
        }
        return executeStep(
          step,
          input,
          results,
          workflow.config.defaultModel,
          rolePrompts?.get(step.context.identity.role),
          tracer,
          modelOverrides,
          false,
          orderedSteps,
        );
      }));

      const layerResults = await Promise.all(layerPromises);

      for (let i = 0; i < layer.length; i++) {
        results.set(layer[i].id, layerResults[i]);
        stepResults.push(layerResults[i]);

        // Budget tracking (parallel)
        accumulatedCost += estimateCostFromTokens(
          layerResults[i].tokenUsage.input,
          layerResults[i].tokenUsage.output,
        );
        if (maxBudgetUsd && accumulatedCost > maxBudgetUsd) {
          tracer.error(layer[i].id, `Budget exceeded: $${accumulatedCost.toFixed(4)} > $${maxBudgetUsd}`);
          tracer.workflowEnd("failed", Math.round(performance.now() - workflowStart));
          return buildWorkflowResult(workflow.name, tracer.getTraceId(), "failed", stepResults, workflowStart);
        }

        if (
          layerResults[i].status === "failed" &&
          workflow.config.onValidationFail === "block"
        ) {
          tracer.workflowEnd(
            "failed",
            Math.round(performance.now() - workflowStart),
          );
          return buildWorkflowResult(
            workflow.name,
            tracer.getTraceId(),
            "failed",
            stepResults,
            workflowStart,
          );
        }
      }
    }
  } else {
    // pipeline / single: sequential execution
    for (const step of orderedSteps) {
      if (hasDependencyFailure(step, results)) {
        const skipped = createSkippedResult(step.id);
        results.set(step.id, skipped);
        stepResults.push(skipped);
        tracer.error(step.id, "Dependency failed -- skipping");
        continue;
      }

      const stepResult = await executeStep(
        step,
        input,
        results,
        workflow.config.defaultModel,
        rolePrompts?.get(step.context.identity.role),
        tracer,
        modelOverrides,
        false,
        orderedSteps,
      );

      results.set(step.id, stepResult);
      stepResults.push(stepResult);

      // Budget check
      accumulatedCost += estimateCostFromTokens(
        stepResult.tokenUsage.input,
        stepResult.tokenUsage.output,
      );
      if (maxBudgetUsd && accumulatedCost > maxBudgetUsd) {
        tracer.error(step.id, `Budget exceeded: $${accumulatedCost.toFixed(4)} > $${maxBudgetUsd}`);
        tracer.workflowEnd("failed", Math.round(performance.now() - workflowStart));
        return buildWorkflowResult(workflow.name, tracer.getTraceId(), "failed", stepResults, workflowStart);
      }

      if (stepResult.status === "failed") {
        if (workflow.config.onValidationFail === "retry") {
          // Workflow-level retry: re-execute the failed step up to 2 times
          let retried = false;
          for (let retryAttempt = 0; retryAttempt < 2; retryAttempt++) {
            tracer.emit(step.id, "step_start", { output: `workflow-retry ${retryAttempt + 1}/2` });
            const retryResult = await executeStep(
              step, input, results, workflow.config.defaultModel,
              rolePrompts?.get(step.context.identity.role), tracer, modelOverrides, true, orderedSteps,
            );
            results.set(step.id, retryResult);
            stepResults[stepResults.length - 1] = retryResult;
            accumulatedCost += estimateCostFromTokens(retryResult.tokenUsage.input, retryResult.tokenUsage.output);
            if (retryResult.status !== "failed") { retried = true; break; }
          }
          if (!retried) {
            tracer.workflowEnd("failed", Math.round(performance.now() - workflowStart));
            return buildWorkflowResult(workflow.name, tracer.getTraceId(), "failed", stepResults, workflowStart);
          }
        } else if (workflow.config.onValidationFail === "block") {
          tracer.workflowEnd(
            "failed",
            Math.round(performance.now() - workflowStart),
          );
          return buildWorkflowResult(
            workflow.name,
            tracer.getTraceId(),
            "failed",
            stepResults,
            workflowStart,
          );
        }
        // "flag" -> continue execution
      }
    }
  }

  const totalMs = Math.round(performance.now() - workflowStart);
  const hasFailures = stepResults.some((r) => r.status === "failed");
  const status = hasFailures ? "partial" : "success";

  tracer.workflowEnd(status, totalMs);

  return buildWorkflowResult(
    workflow.name,
    tracer.getTraceId(),
    status,
    stepResults,
    workflowStart,
  );
}

// ─── Step Execution ──────────────────────────────────────────

async function executeStep(
  step: StepDefinition,
  originalInput: string,
  previousResults: Map<string, StepResult>,
  defaultModel: string,
  rolePrompt: string | undefined,
  tracer: TraceEmitter,
  modelOverrides?: { classify?: string; generate?: string; validate?: string },
  _isRetry = false, // true = inside retryStep, skip nested retries
  allSteps?: StepDefinition[],
): Promise<StepResult> {
  const stepStart = performance.now();
  const context = buildContext(step, previousResults, defaultModel, modelOverrides, allSteps);
  const trace: StepResult["trace"] = [];

  tracer.stepStart(step.id, context);

  try {
    // human_approval: wait for human approve/deny
    if (step.type === "human_approval") {
      const stepInput = getStepInput(step, originalInput, previousResults);
      console.log("\n--- Human Approval Required ---");
      console.log(stepInput.slice(0, 500));
      console.log("\napprove / deny? ");

      const answer = await askUser("approve/deny: ");
      const approved = answer.trim().toLowerCase().startsWith("a");
      const durationMs = Math.round(performance.now() - stepStart);

      tracer.stepEnd(step.id, { latencyMs: durationMs });

      return {
        stepId: step.id,
        status: approved ? "success" : "failed",
        output: approved ? "approved" : "denied",
        trace,
        durationMs,
        tokenUsage: { input: 0, output: 0 },
      };
    }

    // record_decision: log execution result for audit trail
    if (step.type === "record_decision") {
      const stepInput = getStepInput(step, originalInput, previousResults);
      const durationMs = Math.round(performance.now() - stepStart);

      const decisionRecord = {
        timestamp: new Date().toISOString(),
        traceId: tracer.getTraceId(),
        stepId: step.id,
        input: stepInput.slice(0, 500),
        previousSteps: Array.from(previousResults.entries()).map(([id, r]) => ({
          id,
          status: r.status,
        })),
      };

      const outputPath = `traces/decision-${tracer.getTraceId().slice(0, 8)}.json`;

      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(outputPath, JSON.stringify(decisionRecord, null, 2), "utf-8");
      } catch {
        // traces dir might not exist, non-fatal
      }

      tracer.decision(step.id, {
        status: "recorded",
        reason: "Workflow execution decision logged",
        outputPath,
      });
      tracer.stepEnd(step.id, { latencyMs: durationMs });

      return {
        stepId: step.id,
        status: "success",
        output: decisionRecord,
        trace,
        durationMs,
        tokenUsage: { input: 0, output: 0 },
      };
    }

    // Agent execution
    const stepInput = getStepInput(step, originalInput, previousResults);
    const agentOutput = await runAgent({
      stepId: step.id,
      context,
      input: stepInput,
      rolePrompt,
      tracer,
    });

    let output: unknown = agentOutput.text;

    // 마크다운 코드블록 제거 (```json ... ``` → 내용만)
    const cleanedText = stripCodeBlock(agentOutput.text);

    // JSON 출력 시도 (코드블록 벗긴 후)
    try {
      output = JSON.parse(cleanedText);
    } catch {
      // JSON 파싱 실패 — 원본 텍스트 그대로 사용
      output = cleanedText || agentOutput.text;
    }

    // ── Tier 1: 규칙 기반 검증 (매 단계, 비용 0) ──
    let validationResult = undefined;
    if (step.validation?.rules.length) {
      validationResult = validateOutput(output, step.validation.rules);
      tracer.validation(step.id, validationResult);

      if (!validationResult.passed) {
        const durationMs = Math.round(performance.now() - stepStart);
        tracer.stepEnd(step.id, {
          latencyMs: durationMs,
          inputTokens: agentOutput.inputTokens,
          outputTokens: agentOutput.outputTokens,
        });
        return {
          stepId: step.id,
          status: "failed",
          output,
          validation: validationResult,
          trace,
          durationMs,
          tokenUsage: {
            input: agentOutput.inputTokens,
            output: agentOutput.outputTokens,
          },
        };
      }
    }

    // ── Tier 2: LLM 평가 (핵심 전환점에서만) ──
    let evaluationResult: EvaluationResult | undefined;
    if (step.evaluation?.enabled) {
      evaluationResult = await runLLMEvaluation(
        step,
        agentOutput.text,
        defaultModel,
        tracer,
      );
      tracer.evaluation(step.id, evaluationResult);

      if (!evaluationResult.passed) {
        // retry 로직 (재시도 안에서는 재시도 안 함 -- 무한 루프 방지)
        if (step.evaluation.onFail === "retry" && !_isRetry) {
          const retried = await retryStep(
            step,
            originalInput,
            previousResults,
            defaultModel,
            rolePrompt,
            tracer,
            step.evaluation.maxRetries ?? 2,
          );
          if (retried) return retried;
        }

        if (step.evaluation.onFail === "block") {
          const durationMs = Math.round(performance.now() - stepStart);
          tracer.stepEnd(step.id, { latencyMs: durationMs });
          return {
            stepId: step.id,
            status: "failed",
            output,
            validation: validationResult,
            evaluation: evaluationResult,
            trace,
            durationMs,
            tokenUsage: {
              input: agentOutput.inputTokens,
              output: agentOutput.outputTokens,
            },
          };
        }
        // "flag" → 통과하되 상태를 flagged로
      }
    }

    const durationMs = Math.round(performance.now() - stepStart);
    tracer.stepEnd(step.id, {
      latencyMs: durationMs,
      inputTokens: agentOutput.inputTokens,
      outputTokens: agentOutput.outputTokens,
    });

    return {
      stepId: step.id,
      status:
        evaluationResult && !evaluationResult.passed ? "flagged" : "success",
      output,
      validation: validationResult,
      evaluation: evaluationResult,
      trace,
      durationMs,
      tokenUsage: {
        input: agentOutput.inputTokens,
        output: agentOutput.outputTokens,
      },
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - stepStart);
    const errorMsg = err instanceof Error ? err.message : String(err);
    tracer.error(step.id, errorMsg);
    tracer.stepEnd(step.id, { latencyMs: durationMs });

    return {
      stepId: step.id,
      status: "failed",
      output: null,
      error: errorMsg,
      trace,
      durationMs,
      tokenUsage: { input: 0, output: 0 },
    };
  }
}

// ─── LLM Evaluation ─────────────────────────────────────────

async function runLLMEvaluation(
  step: StepDefinition,
  output: string,
  defaultModel: string,
  tracer: TraceEmitter,
): Promise<EvaluationResult> {
  const evalConfig = step.evaluation!;
  return runTier2Evaluation({
    stepId: step.id,
    output,
    evalConfig,
    defaultModel,
    stepModel: step.model,
    tracer,
  });
}

// ─── Retry Logic ─────────────────────────────────────────────

async function retryStep(
  step: StepDefinition,
  originalInput: string,
  previousResults: Map<string, StepResult>,
  defaultModel: string,
  rolePrompt: string | undefined,
  tracer: TraceEmitter,
  maxRetries: number,
): Promise<StepResult | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    tracer.emit(step.id, "step_start", {
      output: `retry ${attempt}/${maxRetries}`,
    });

    const result = await executeStep(
      step,
      originalInput,
      previousResults,
      defaultModel,
      rolePrompt,
      tracer,
      undefined, // modelOverrides
      true, // _isRetry = true -- no nested retries
      undefined, // allSteps -- not available in retry context
    );

    if (result.status === "success" || result.status === "flagged") {
      return result;
    }
  }

  return null; // 모든 재시도 실패
}

// ─── Helpers ─────────────────────────────────────────────────

function getStepInput(
  step: StepDefinition,
  originalInput: string,
  previousResults: Map<string, StepResult>,
): string {
  if (!step.dependsOn?.length) return originalInput;

  // Merge all dependency outputs (fan-in support)
  const depOutputs: string[] = [];
  for (const depId of step.dependsOn) {
    const result = previousResults.get(depId);
    if (result?.status === "success" && result.output) {
      const outputStr =
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output, null, 2);
      depOutputs.push(`## Output from [${depId}]\n${outputStr}`);
    }
  }

  if (depOutputs.length > 0) return depOutputs.join("\n\n---\n\n");

  return originalInput;
}

function hasDependencyFailure(
  step: StepDefinition,
  results: Map<string, StepResult>,
): boolean {
  if (!step.dependsOn?.length) return false;
  return step.dependsOn.some((depId) => {
    const r = results.get(depId);
    return r && r.status === "failed";
  });
}

function createSkippedResult(stepId: string): StepResult {
  return {
    stepId,
    status: "skipped",
    output: null,
    trace: [],
    durationMs: 0,
    tokenUsage: { input: 0, output: 0 },
  };
}

function topologicalSort(steps: StepDefinition[]): StepDefinition[] {
  const sorted: StepDefinition[] = [];
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  function visit(step: StepDefinition) {
    if (visited.has(step.id)) return;
    if (inProgress.has(step.id)) {
      throw new Error(`Cycle detected in workflow: step "${step.id}" has circular dependency`);
    }

    inProgress.add(step.id);

    for (const depId of step.dependsOn ?? []) {
      const dep = stepMap.get(depId);
      if (dep) visit(dep);
    }

    inProgress.delete(step.id);
    visited.add(step.id);
    sorted.push(step);
  }

  for (const step of steps) {
    visit(step);
  }

  return sorted;
}

function buildWorkflowResult(
  name: string,
  traceId: string,
  status: WorkflowResult["status"],
  steps: StepResult[],
  startTime: number,
): WorkflowResult {
  const totalInput = steps.reduce((s, r) => s + r.tokenUsage.input, 0);
  const totalOutput = steps.reduce((s, r) => s + r.tokenUsage.output, 0);

  return {
    workflowName: name,
    traceId,
    status,
    steps,
    totalDurationMs: Math.round(performance.now() - startTime),
    totalTokens: { input: totalInput, output: totalOutput },
    totalCostEstimate: estimateCostFromTokens(totalInput, totalOutput),
  };
}

// Model pricing per million tokens (input/output)
const MODEL_PRICING: Record<string, [number, number]> = {
  sonnet: [3, 15],
  opus: [15, 75],
  haiku: [0.25, 1.25],
  "claude-sonnet-4-5": [3, 15],
  "claude-opus-4-5": [15, 75],
};

function estimateCostFromTokens(inputTokens: number, outputTokens: number, model?: string): number {
  const [inputPrice, outputPrice] = MODEL_PRICING[model ?? "sonnet"] ?? [3, 15];
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
}

/**
 * LLM 응답에서 마크다운 코드블록 제거.
 * ```json ... ``` → 내용만 추출.
 */
function stripCodeBlock(text: string): string {
  const match = text.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : text.trim();
}

/**
 * LLM 평가 점수를 0~1 범위로 정규화.
 * LLM이 0~10, 0~100, 또는 1~5 스케일로 줄 수 있음.
 */

/**
 * parallel 토폴로지용: 의존성이 같은 레이어끼리 묶어서 병렬 실행.
 * 레이어 0: 의존성 없는 단계들 (동시 실행)
 * 레이어 1: 레이어 0에 의존하는 단계들 (동시 실행)
 * ...
 */
function buildParallelLayers(
  steps: StepDefinition[],
): StepDefinition[][] {
  const layers: StepDefinition[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < steps.length) {
    const layer: StepDefinition[] = [];

    for (const step of steps) {
      if (assigned.has(step.id)) continue;

      const deps = step.dependsOn ?? [];
      if (deps.every((d) => assigned.has(d))) {
        layer.push(step);
      }
    }

    if (layer.length === 0) {
      const unassigned = steps.filter((s) => !assigned.has(s.id)).map((s) => s.id);
      throw new Error(`Cycle detected in parallel layers: unresolvable steps [${unassigned.join(", ")}]`);
    }

    for (const step of layer) {
      assigned.add(step.id);
    }

    layers.push(layer);
  }

  return layers;
}

/**
 * stdin에서 사용자 입력 읽기 (human_approval 용).
 */
function askUser(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

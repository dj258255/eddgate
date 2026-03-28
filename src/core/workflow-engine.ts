import { createInterface } from "node:readline";
import type {
  WorkflowDefinition,
  StepDefinition,
  StepResult,
  WorkflowResult,
  EvaluationResult,
} from "../types/index.js";
import { buildContext } from "./context-builder.js";
import { runAgent, runEvaluation } from "./agent-runner.js";
import { validateOutput } from "../eval/tier1-rules.js";
import { TraceEmitter } from "../trace/emitter.js";

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
}

export async function executeWorkflow(
  options: WorkflowEngineOptions,
): Promise<WorkflowResult> {
  const { workflow, input, rolePrompts, maxBudgetUsd } = options;
  const tracer = options.tracer ?? new TraceEmitter();
  const results = new Map<string, StepResult>();
  const stepResults: StepResult[] = [];
  let accumulatedCost = 0;

  const workflowStart = performance.now();
  tracer.workflowStart(workflow.name);

  const orderedSteps = topologicalSort(workflow.steps);

  if (workflow.config.topology === "parallel") {
    // parallel: 의존성 없는 단계들을 동시 실행
    const layers = buildParallelLayers(orderedSteps);

    for (const layer of layers) {
      const layerPromises = layer.map(async (step) => {
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
        );
      });

      const layerResults = await Promise.all(layerPromises);

      for (let i = 0; i < layer.length; i++) {
        results.set(layer[i].id, layerResults[i]);
        stepResults.push(layerResults[i]);

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
    // pipeline / single: 순차 실행
    for (const step of orderedSteps) {
      if (hasDependencyFailure(step, results)) {
        const skipped = createSkippedResult(step.id);
        results.set(step.id, skipped);
        stepResults.push(skipped);
        tracer.error(step.id, "의존성 단계 실패로 스킵");
        continue;
      }

      const stepResult = await executeStep(
        step,
        input,
        results,
        workflow.config.defaultModel,
        rolePrompts?.get(step.context.identity.role),
        tracer,
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
        if (workflow.config.onValidationFail === "block") {
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
): Promise<StepResult> {
  const stepStart = performance.now();
  const context = buildContext(step, previousResults, defaultModel);
  const trace: StepResult["trace"] = [];

  tracer.stepStart(step.id, context);

  try {
    // human_approval: 사람 승인 대기
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

    // 에이전트 실행
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
        // retry 로직
        if (step.evaluation.onFail === "retry") {
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
  const evalModel =
    evalConfig.model ?? step.model ?? defaultModel;

  const result = await runEvaluation({
    stepId: step.id,
    output,
    evalType: evalConfig.type,
    rubric: evalConfig.rubric,
    model: evalModel,
    tracer,
  });

  // score를 0~1 범위로 정규화 (LLM이 가끔 0~10이나 0~100으로 줌)
  const normalizedScore = normalizeScore(result.score);

  return {
    score: normalizedScore,
    passed: normalizedScore >= evalConfig.threshold,
    action: evalConfig.onFail,
    reasoning: result.reasoning,
  };
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
  // 첫 단계거나 의존성 없으면 원본 입력
  if (!step.dependsOn?.length) return originalInput;

  // 마지막 의존성의 출력을 기본 입력으로
  const lastDep = step.dependsOn[step.dependsOn.length - 1];
  const lastResult = previousResults.get(lastDep);

  if (lastResult?.status === "success" && lastResult.output) {
    const outputStr =
      typeof lastResult.output === "string"
        ? lastResult.output
        : JSON.stringify(lastResult.output, null, 2);
    return outputStr;
  }

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
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  function visit(step: StepDefinition) {
    if (visited.has(step.id)) return;
    visited.add(step.id);

    for (const depId of step.dependsOn ?? []) {
      const dep = stepMap.get(depId);
      if (dep) visit(dep);
    }

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

function estimateCostFromTokens(inputTokens: number, outputTokens: number): number {
  // Claude Sonnet 4.6 기준 추정: $3/M input, $15/M output
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
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
function normalizeScore(score: number): number {
  if (score >= 0 && score <= 1) return score;
  if (score > 1 && score <= 5) return score / 5;
  if (score > 5 && score <= 10) return score / 10;
  if (score > 10 && score <= 100) return score / 100;
  return Math.min(1, Math.max(0, score));
}

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

    if (layer.length === 0) break; // 순환 의존성 방지

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

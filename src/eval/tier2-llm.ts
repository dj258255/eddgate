import { normalizeScore } from "./normalize-score.js";
import { runEvaluation } from "../core/agent-runner.js";
import type { TraceEmitter } from "../trace/emitter.js";
import type { EvaluationResult, LLMEvaluation } from "../types/index.js";

/**
 * Tier 2: LLM Evaluation
 *
 * Runs at key transition points only.
 * Uses Claude Agent SDK for evaluation (Max subscription).
 * Score normalized to 0-1 range.
 *
 * Key difference from direct runEvaluation:
 * - Passes sourceContext for groundedness eval
 * - Normalizes score from arbitrary LLM scales
 * - Returns structured EvaluationResult with pass/fail
 */
export async function runTier2Evaluation(options: {
  stepId: string;
  output: string;
  evalConfig: LLMEvaluation;
  defaultModel: string;
  stepModel?: string;
  sourceContext?: string;
  tracer: TraceEmitter;
}): Promise<EvaluationResult> {
  const { stepId, output, evalConfig, defaultModel, stepModel, sourceContext, tracer } = options;
  const evalModel = evalConfig.model ?? stepModel ?? defaultModel;

  const result = await runEvaluation({
    stepId,
    output,
    evalType: evalConfig.type,
    rubric: evalConfig.rubric,
    sourceContext: sourceContext ?? evalConfig.sourceContext,
    model: evalModel,
    tracer,
  });

  const normalizedScore = normalizeScore(result.score);

  return {
    score: normalizedScore,
    passed: normalizedScore >= evalConfig.threshold,
    action: evalConfig.onFail,
    reasoning: result.reasoning,
  };
}

import { runEvaluation } from "../core/agent-runner.js";
import type { TraceEmitter } from "../trace/emitter.js";
import type { EvaluationResult, LLMEvaluation } from "../types/index.js";

/**
 * Tier 2: LLM Evaluation
 *
 * Runs at key transition points only.
 * Uses Claude Agent SDK for evaluation (Max subscription).
 * Score normalized to 0-1 range.
 */
export async function runTier2Evaluation(options: {
  stepId: string;
  output: string;
  evalConfig: LLMEvaluation;
  defaultModel: string;
  stepModel?: string;
  tracer: TraceEmitter;
}): Promise<EvaluationResult> {
  const { stepId, output, evalConfig, defaultModel, stepModel, tracer } = options;
  const evalModel = evalConfig.model ?? stepModel ?? defaultModel;

  const result = await runEvaluation({
    stepId,
    output,
    evalType: evalConfig.type,
    rubric: evalConfig.rubric,
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

function normalizeScore(score: number): number {
  if (score >= 0 && score <= 1) return score;
  if (score > 1 && score <= 5) return score / 5;
  if (score > 5 && score <= 10) return score / 10;
  if (score > 10 && score <= 100) return score / 100;
  return Math.min(1, Math.max(0, score));
}

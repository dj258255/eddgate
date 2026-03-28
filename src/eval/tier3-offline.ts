import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runEvaluation } from "../core/agent-runner.js";
import { TraceEmitter } from "../trace/emitter.js";
import type { TraceEvent, WorkflowDefinition } from "../types/index.js";

/**
 * Tier 3: Offline Batch Evaluation
 *
 * Runs evaluation on saved traces without re-executing the workflow.
 * Designed for CI/CD integration and regression testing.
 */

export interface OfflineEvalResult {
  traceFile: string;
  stepId: string;
  evalType: string;
  score: number;
  threshold: number;
  passed: boolean;
  reasoning: string;
  timestamp: string;
}

export async function runOfflineEvaluation(options: {
  workflow: WorkflowDefinition;
  tracesDir: string;
  model: string;
  outputPath?: string;
}): Promise<OfflineEvalResult[]> {
  const { workflow, tracesDir, model, outputPath } = options;
  const results: OfflineEvalResult[] = [];

  const files = await readdir(tracesDir).catch(() => []);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  for (const file of jsonlFiles) {
    const content = await readFile(join(tracesDir, file), "utf-8");
    const events = parseJsonl(content);

    // Find step outputs from step_end events
    const stepOutputs = extractStepOutputs(events);

    for (const [stepId, output] of stepOutputs) {
      const step = workflow.steps.find((s) => s.id === stepId);
      if (!step?.evaluation?.enabled) continue;
      if (!output) continue;

      const tracer = new TraceEmitter();

      const evalResult = await runEvaluation({
        stepId,
        output,
        evalType: step.evaluation.type,
        rubric: step.evaluation.rubric,
        model,
        tracer,
      });

      const normalizedScore = normalizeScore(evalResult.score);

      results.push({
        traceFile: file,
        stepId,
        evalType: step.evaluation.type,
        score: normalizedScore,
        threshold: step.evaluation.threshold,
        passed: normalizedScore >= step.evaluation.threshold,
        reasoning: evalResult.reasoning,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(results, null, 2), "utf-8");
  }

  return results;
}

/**
 * Compare evaluation results between two runs (regression detection).
 */
export function detectRegressions(
  baseline: OfflineEvalResult[],
  current: OfflineEvalResult[],
  threshold = 0.05,
): Array<{ stepId: string; baselineScore: number; currentScore: number; delta: number }> {
  const regressions: Array<{
    stepId: string;
    baselineScore: number;
    currentScore: number;
    delta: number;
  }> = [];

  const baselineByStep = new Map<string, number>();
  for (const r of baseline) {
    const existing = baselineByStep.get(r.stepId);
    if (existing === undefined || r.score < existing) {
      baselineByStep.set(r.stepId, r.score);
    }
  }

  const currentByStep = new Map<string, number>();
  for (const r of current) {
    const existing = currentByStep.get(r.stepId);
    if (existing === undefined || r.score < existing) {
      currentByStep.set(r.stepId, r.score);
    }
  }

  for (const [stepId, baseScore] of baselineByStep) {
    const curScore = currentByStep.get(stepId);
    if (curScore === undefined) continue;
    const delta = curScore - baseScore;
    if (delta < -threshold) {
      regressions.push({
        stepId,
        baselineScore: baseScore,
        currentScore: curScore,
        delta,
      });
    }
  }

  return regressions;
}

function extractStepOutputs(events: TraceEvent[]): Map<string, string> {
  const outputs = new Map<string, string>();

  for (const event of events) {
    if (event.type === "step_end" && event.stepId !== "__workflow__") {
      if (event.data.output) {
        outputs.set(event.stepId, String(event.data.output));
      }
    }
  }

  return outputs;
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

function normalizeScore(score: number): number {
  if (score >= 0 && score <= 1) return score;
  if (score > 1 && score <= 5) return score / 5;
  if (score > 5 && score <= 10) return score / 10;
  if (score > 10 && score <= 100) return score / 100;
  return Math.min(1, Math.max(0, score));
}

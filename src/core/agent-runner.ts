import type { ExecutionContext } from "../types/index.js";
import { buildSystemPrompt } from "./context-builder.js";
import type { TraceEmitter } from "../trace/emitter.js";
import type { LLMAdapter, LLMResponse } from "./llm-adapter.js";
import { createDefaultAdapter } from "./llm-adapter.js";

/**
 * Agent Runner
 *
 * Uses LLM Adapter pattern -- works with:
 * - Claude Agent SDK (Claude CLI, any subscription)
 * - Anthropic API (ANTHROPIC_API_KEY)
 * - Any custom adapter implementing LLMAdapter
 */

let defaultAdapter: LLMAdapter | null = null;

let globalEffort: string | undefined;
let globalThinking: string | undefined;

export function setAdapter(adapter: LLMAdapter): void {
  defaultAdapter = adapter;
}

export function setEffort(effort: string): void {
  globalEffort = effort;
}

export function setThinking(thinking: string): void {
  globalThinking = thinking;
}

function getAdapter(): LLMAdapter {
  if (!defaultAdapter) {
    defaultAdapter = createDefaultAdapter();
  }
  return defaultAdapter;
}

interface RunAgentOptions {
  stepId: string;
  context: ExecutionContext;
  input: string;
  rolePrompt?: string;
  tracer: TraceEmitter;
}

interface AgentOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

export async function runAgent(
  options: RunAgentOptions,
  maxRetries = 3,
): Promise<AgentOutput> {
  const { stepId, context, input, rolePrompt, tracer } = options;

  const systemPrompt = buildSystemPrompt(context, rolePrompt);
  const model = context.identity.model ?? "sonnet";

  const fullInput = context.memory?.previousStepOutput
    ? `${input}\n\n---\n\n## Previous step output\n${context.memory.previousStepOutput}`
    : input;

  // Retry with exponential backoff on transient errors
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const adapter = getAdapter();
      const result = await adapter.generate({
        model,
        systemPrompt,
        prompt: fullInput,
        tools: context.tools.length > 0 ? context.tools : undefined,
        effort: globalEffort,
        thinking: globalThinking,
      });

      tracer.llmCall(stepId, {
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        cost: result.cost,
      });

      return {
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        model: result.model,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTransient =
        lastError.message.includes("rate_limit") ||
        lastError.message.includes("overloaded") ||
        lastError.message.includes("ECONNREFUSED") ||
        lastError.message.includes("ETIMEDOUT") ||
        lastError.message.includes("529") ||
        lastError.message.includes("503");

      if (!isTransient || attempt === maxRetries - 1) throw lastError;

      const delay = Math.min(1000 * 2 ** attempt, 30000);
      tracer.emit(stepId, "error", {
        error: `Transient error, retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${lastError.message}`,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error("Unknown error");
}

/**
 * LLM evaluation (Tier 2).
 * Uses the same adapter as agent execution.
 */
export async function runEvaluation(options: {
  stepId: string;
  output: string;
  evalType: "groundedness" | "relevance" | "custom";
  rubric?: string;
  model: string;
  tracer: TraceEmitter;
}): Promise<{ score: number; reasoning: string }> {
  const { stepId, output, evalType, rubric, model, tracer } = options;

  const evalPrompts: Record<string, string> = {
    groundedness: `Evaluate the groundedness of the following text.
Check if all claims are supported by the provided evidence.
Score: 0.0 = no grounding, 1.0 = fully grounded.

Text:
${output}

Respond ONLY with this JSON: {"score": 0.0-1.0, "reasoning": "..."}`,

    relevance: `Evaluate how relevant the following text is to the original question.
Score: 0.0 = not relevant, 1.0 = fully relevant.

Text:
${output}

Respond ONLY with this JSON: {"score": 0.0-1.0, "reasoning": "..."}`,

    custom: rubric
      ? `${rubric}\n\nText:\n${output}\n\nRespond ONLY with this JSON: {"score": 0.0-1.0, "reasoning": "..."}`
      : `Evaluate the quality of this text.\n\nText:\n${output}\n\nRespond ONLY with this JSON: {"score": 0.0-1.0, "reasoning": "..."}`,
  };

  const adapter = getAdapter();
  const result = await adapter.generate({
    model,
    systemPrompt: "You are an evaluation judge. Respond only with the requested JSON format.",
    prompt: evalPrompts[evalType],
  });

  tracer.llmCall(stepId, {
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
  });

  try {
    // Try to extract JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*"score"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: typeof parsed.score === "number" ? parsed.score : 0,
        reasoning: parsed.reasoning ?? "",
      };
    }
  } catch {
    // fallback
  }

  const scoreMatch = result.text.match(/(\d+\.?\d*)/);
  return {
    score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
    reasoning: result.text,
  };
}

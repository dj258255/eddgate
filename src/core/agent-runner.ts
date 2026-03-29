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
      const statusCode = (lastError as any)?.status ?? (lastError as any)?.statusCode;
      const isTransient =
        statusCode === 429 ||
        statusCode === 529 ||
        statusCode === 503 ||
        lastError.message.includes("rate_limit") ||
        lastError.message.includes("overloaded") ||
        lastError.message.includes("ECONNREFUSED") ||
        lastError.message.includes("ETIMEDOUT") ||
        lastError.message.includes("529") ||
        lastError.message.includes("503");

      if (!isTransient || attempt === maxRetries - 1) throw lastError;

      // Exponential backoff with jitter to avoid thundering herd
      const baseDelay = Math.min(1000 * 2 ** attempt, 30000);
      const delay = Math.round(baseDelay * (0.5 + Math.random() * 0.5));
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
  sourceContext?: string;
  model: string;
  tracer: TraceEmitter;
}): Promise<{ score: number; reasoning: string }> {
  const { stepId, output, evalType, rubric, sourceContext, model, tracer } = options;

  const sourceBlock = sourceContext
    ? `\n\nSource/Evidence:\n${sourceContext}\n`
    : "\n\n(No source context provided -- evaluate internal coherence only)\n";

  const evalPrompts: Record<string, string> = {
    groundedness: `Evaluate the groundedness of the following text.
Check if all claims are supported by the provided evidence.
Score: 0.0 = no grounding, 1.0 = fully grounded.
${sourceBlock}
Text to evaluate:
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

  // Retry evaluation up to 2 times on transient errors
  const maxEvalRetries = 2;
  let lastEvalError: Error | null = null;

  for (let evalAttempt = 0; evalAttempt <= maxEvalRetries; evalAttempt++) {
    try {
      const adapter = getAdapter();
      const result = await adapter.generate({
        model,
        systemPrompt: "You are an evaluation judge. Respond only with the requested JSON format.",
        prompt: evalPrompts[evalType],
      });

      tracer.llmCall(`${stepId}/eval`, {
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      });

      // Parse JSON response
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*"score"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed.score === "number") {
            return {
              score: parsed.score,
              reasoning: parsed.reasoning ?? "",
            };
          }
        }
      } catch {
        // JSON parse failed -- try stricter fallback below
      }

      // Stricter fallback: only accept a number that looks like a score (0-1 or 0-10 range)
      const scoreMatch = result.text.match(/\b((?:0|1)(?:\.\d+)?|[0-9](?:\.\d+)?|10(?:\.0+)?)\b/);
      if (scoreMatch) {
        const parsed = parseFloat(scoreMatch[1]);
        // Reject clearly non-score numbers (e.g., years, counts)
        if (parsed <= 10) {
          return { score: parsed, reasoning: result.text };
        }
      }

      // No valid score found -- return 0 with explanation
      return {
        score: 0,
        reasoning: `[eval-parse-failed] Could not extract valid score from: ${result.text.slice(0, 200)}`,
      };

    } catch (err) {
      lastEvalError = err instanceof Error ? err : new Error(String(err));
      if (evalAttempt < maxEvalRetries) {
        const delay = Math.round(1000 * (evalAttempt + 1) * (0.5 + Math.random() * 0.5));
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  // All eval retries failed -- return 0 so evaluation infrastructure failure doesn't masquerade as content failure
  return {
    score: 0,
    reasoning: `[eval-error] Evaluation failed after ${maxEvalRetries + 1} attempts: ${lastEvalError?.message ?? "unknown"}`,
  };
}

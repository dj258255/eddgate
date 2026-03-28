import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultSuccess,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ExecutionContext } from "../types/index.js";
import { buildSystemPrompt } from "./context-builder.js";
import type { TraceEmitter } from "../trace/emitter.js";

/**
 * Agent Runner — Claude Agent SDK 기반
 *
 * Claude Code CLI를 내부적으로 호출.
 * Max 구독으로 실행 — API 키 불필요.
 * 코드가 워크플로우를 제어, Claude는 각 단계의 LLM 역할만.
 */

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

function isSuccess(msg: SDKResultMessage): msg is SDKResultSuccess {
  return msg.subtype === "success";
}

export async function runAgent(
  options: RunAgentOptions,
): Promise<AgentOutput> {
  const { stepId, context, input, rolePrompt, tracer } = options;

  const systemPrompt = buildSystemPrompt(context, rolePrompt);
  const model = resolveModel(context.identity.model);

  const fullInput = context.memory?.previousStepOutput
    ? `${input}\n\n---\n\n## 이전 단계 산출물\n${context.memory.previousStepOutput}`
    : input;

  const allowedTools = mapTools(context.tools);

  const start = performance.now();

  let resultText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  const conversation = query({
    prompt: fullInput,
    options: {
      model,
      systemPrompt,
      allowedTools,
      maxTurns: 10,
      persistSession: false,
      tools: context.tools.length === 0 ? [] : undefined,
    },
  });

  for await (const message of conversation) {
    if (message.type === "assistant") {
      // BetaMessage에서 텍스트 추출
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            resultText += block.text;
          }
        }
      }
    }

    if (message.type === "result") {
      inputTokens = message.usage?.input_tokens ?? 0;
      outputTokens = message.usage?.output_tokens ?? 0;
      costUsd = message.total_cost_usd ?? 0;

      if (isSuccess(message)) {
        resultText = message.result || resultText;
      }
    }
  }

  const latencyMs = Math.round(performance.now() - start);

  tracer.llmCall(stepId, {
    model,
    inputTokens,
    outputTokens,
    latencyMs,
    cost: costUsd,
  });

  return {
    text: resultText,
    inputTokens,
    outputTokens,
    latencyMs,
    model,
  };
}

/**
 * LLM 평가 실행 (Tier 2).
 * 핵심 전환점에서만 호출.
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
    groundedness: `다음 텍스트의 근거 기반 정도를 평가하세요.
모든 주장이 제시된 근거에 의해 뒷받침되는지 확인하세요.

0.0 = 전혀 근거 없음, 1.0 = 모든 주장에 근거 있음

텍스트:
${output}`,
    relevance: `다음 텍스트가 원래 질문에 얼마나 관련되는지 평가하세요.

0.0 = 전혀 관련 없음, 1.0 = 완전히 관련됨

텍스트:
${output}`,
    custom: rubric
      ? `${rubric}\n\n텍스트:\n${output}`
      : `다음 텍스트의 품질을 평가하세요.\n\n텍스트:\n${output}`,
  };

  const evalSchema = {
    type: "object" as const,
    properties: {
      score: { type: "number" as const },
      reasoning: { type: "string" as const },
    },
    required: ["score", "reasoning"] as const,
  };

  const start = performance.now();

  let score = 0;
  let reasoning = "";
  let evalInputTokens = 0;
  let evalOutputTokens = 0;

  const conversation = query({
    prompt: evalPrompts[evalType],
    options: {
      model,
      tools: [],
      persistSession: false,
      outputFormat: { type: "json_schema", schema: evalSchema },
    },
  });

  for await (const message of conversation) {
    if (message.type === "result") {
      evalInputTokens = message.usage?.input_tokens ?? 0;
      evalOutputTokens = message.usage?.output_tokens ?? 0;

      if (isSuccess(message) && message.structured_output) {
        const parsed = message.structured_output as {
          score: number;
          reasoning: string;
        };
        score = typeof parsed.score === "number" ? parsed.score : 0;
        reasoning = parsed.reasoning ?? "";
      } else if (isSuccess(message)) {
        try {
          const parsed = JSON.parse(message.result ?? "{}");
          score = typeof parsed.score === "number" ? parsed.score : 0;
          reasoning = parsed.reasoning ?? "";
        } catch {
          const match = (message.result ?? "").match(/(\d+\.?\d*)/);
          score = match ? parseFloat(match[1]) : 0;
          reasoning = message.result ?? "";
        }
      }
    }
  }

  const latencyMs = Math.round(performance.now() - start);

  tracer.llmCall(stepId, {
    model,
    inputTokens: evalInputTokens,
    outputTokens: evalOutputTokens,
    latencyMs,
  });

  return { score, reasoning };
}

// ─── Tool Mapping ────────────────────────────────────────────

function mapTools(tools: string[]): string[] {
  const mapping: Record<string, string[]> = {
    web_search: ["WebSearch", "WebFetch"],
    file_read: ["Read", "Glob", "Grep"],
    file_write: ["Write", "Edit"],
    file_ops: ["Read", "Write", "Edit", "Glob", "Grep"],
    shell: ["Bash"],
    git: ["Bash"],
    test_runner: ["Bash"],
    lint: ["Bash"],
    git_diff: ["Bash"],
    model_eval: [],
  };

  const mapped = new Set<string>();
  for (const tool of tools) {
    const claudeTools = mapping[tool] ?? [tool];
    for (const t of claudeTools) {
      mapped.add(t);
    }
  }

  return Array.from(mapped);
}

/**
 * 모델 이름을 Claude Code CLI alias로 해석.
 * AI Gateway 포맷(anthropic/claude-sonnet-4.6)도 CLI alias(sonnet)로 변환.
 */
function resolveModel(model?: string): string {
  if (!model) return "sonnet";

  // 이미 alias면 그대로
  const aliases = ["sonnet", "opus", "haiku"];
  if (aliases.includes(model)) return model;

  // AI Gateway 포맷 → alias 변환
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";

  // 그 외는 그대로 전달 (full model ID)
  return model;
}

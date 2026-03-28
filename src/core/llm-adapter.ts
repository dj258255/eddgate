/**
 * LLM Adapter Interface
 *
 * Decouples eddgate from any specific LLM provider.
 * Claude Agent SDK is the default adapter, but users can plug in:
 * - Anthropic API directly
 * - OpenAI API
 * - Local models (Ollama)
 * - Any provider that implements this interface
 */

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
  cost?: number;
}

export interface LLMAdapter {
  /**
   * Generate text from a prompt with a system instruction.
   */
  generate(options: {
    model: string;
    systemPrompt: string;
    prompt: string;
    tools?: string[];
  }): Promise<LLMResponse>;

  /**
   * Name of this adapter (for traces and logs).
   */
  readonly name: string;
}

/**
 * Claude Agent SDK Adapter (default)
 *
 * Uses Claude Code CLI internally.
 * Requires any Claude subscription (Pro/Max/Team).
 * No API key needed.
 */
export class ClaudeSDKAdapter implements LLMAdapter {
  readonly name = "claude-sdk";

  async generate(options: {
    model: string;
    systemPrompt: string;
    prompt: string;
    tools?: string[];
  }): Promise<LLMResponse> {
    // Dynamic import so Claude SDK is not required at load time
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const { SDKResultSuccess } = await import("@anthropic-ai/claude-agent-sdk").then(() => ({
      SDKResultSuccess: null, // type only, not runtime
    }));

    const model = resolveModel(options.model);
    const allowedTools = options.tools?.length ? mapTools(options.tools) : undefined;

    const start = performance.now();

    let resultText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;

    const conversation = query({
      prompt: options.prompt,
      options: {
        model,
        systemPrompt: options.systemPrompt,
        allowedTools,
        maxTurns: 10,
        persistSession: false,
        tools: !options.tools?.length ? [] : undefined,
      },
    });

    for await (const message of conversation) {
      if (message.type === "assistant") {
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

        if (message.subtype === "success") {
          resultText = message.result || resultText;
        }
      }
    }

    return {
      text: resultText,
      inputTokens,
      outputTokens,
      latencyMs: Math.round(performance.now() - start),
      model,
      cost: costUsd,
    };
  }
}

/**
 * Anthropic API Adapter
 *
 * Direct API calls. Requires ANTHROPIC_API_KEY.
 * For users without Claude Code CLI.
 */
export class AnthropicAPIAdapter implements LLMAdapter {
  readonly name = "anthropic-api";

  async generate(options: {
    model: string;
    systemPrompt: string;
    prompt: string;
  }): Promise<LLMResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY not set. Set it in your environment or use Claude SDK adapter instead.",
      );
    }

    const model = options.model.includes("/")
      ? options.model.split("/")[1]
      : mapModelToAPIName(options.model);

    const start = performance.now();

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: options.systemPrompt,
        messages: [{ role: "user", content: options.prompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    // Sonnet pricing: $3/M input, $15/M output
    const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    return {
      text,
      inputTokens,
      outputTokens,
      latencyMs: Math.round(performance.now() - start),
      model,
      cost,
    };
  }
}

/**
 * Create the appropriate adapter based on environment.
 * Priority: Claude SDK (if claude CLI available) > Anthropic API (if key set)
 */
export function createDefaultAdapter(): LLMAdapter {
  // Check if Claude CLI is available
  try {
    const { execFileSync } = require("node:child_process");
    execFileSync("claude", ["--version"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: "pipe",
    });
    return new ClaudeSDKAdapter();
  } catch {
    // Claude CLI not available, try API key
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicAPIAdapter();
  }

  // Default to Claude SDK (will error at runtime if not available)
  return new ClaudeSDKAdapter();
}

// ─── Helpers ─────────────────────────────────────────────────

function resolveModel(model: string): string {
  const aliases = ["sonnet", "opus", "haiku"];
  if (aliases.includes(model)) return model;
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  return model;
}

function mapModelToAPIName(alias: string): string {
  switch (alias) {
    case "sonnet": return "claude-sonnet-4-6";
    case "opus": return "claude-opus-4-6";
    case "haiku": return "claude-haiku-4-5";
    default: return alias;
  }
}

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
  };

  const mapped = new Set<string>();
  for (const tool of tools) {
    const claudeTools = mapping[tool] ?? [tool];
    for (const t of claudeTools) mapped.add(t);
  }
  return Array.from(mapped);
}

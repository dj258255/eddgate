import type {
  ExecutionContext,
  StepDefinition,
  StepResult,
} from "../types/index.js";

/**
 * Context Builder
 *
 * Build minimal execution context. Reproducibility is key.
 *
 * Principles:
 * - 100-token summary > 10,000-token raw
 * - 이전 단계 결과는 필요할 때만 명시적으로 주입
 * - Context rot 방지: 50K 토큰 이전에 열화 시작 (Chroma 연구)
 */
export function buildContext(
  step: StepDefinition,
  previousResults: Map<string, StepResult>,
  defaultModel: string,
  modelOverrides?: { classify?: string; generate?: string; validate?: string },
): ExecutionContext {
  // Model resolution priority: step.model > config overrides by step type > default
  const typeOverride = modelOverrides?.[step.type as keyof typeof modelOverrides];
  const resolvedModel = step.model ?? typeOverride ?? step.context.identity.model ?? defaultModel;

  const ctx: ExecutionContext = {
    state: step.type,
    identity: {
      role: step.context.identity.role,
      model: resolvedModel,
      constraints: step.context.identity.constraints,
    },
    tools: step.context.tools,
  };

  // Context Engineering: retrieve steps must not include execution context
  // in search queries. Search must only handle evidence data.
  // "Execution context must not appear in Search Query" -- enforced in code.
  if (step.type === "retrieve") {
    return ctx; // Return without injecting previous step results
  }

  // Inject previous step results (only when dependsOn set, exclude retrieve)
  if (step.dependsOn?.length) {
    const summaries: string[] = [];

    for (const depId of step.dependsOn) {
      const result = previousResults.get(depId);
      if (result && result.status === "success") {
        summaries.push(summarizeOutput(depId, result.output));
      }
    }

    if (summaries.length > 0) {
      ctx.memory = {
        summary: summaries.join("\n"),
        previousStepOutput: getPrimaryDependencyOutput(
          step.dependsOn,
          previousResults,
        ),
      };
    }
  }

  return ctx;
}

/**
 * Summarize previous step output.
 * "Less is more" -- extract key info only.
 */
function summarizeOutput(stepId: string, output: unknown): string {
  if (output === null || output === undefined) {
    return `[${stepId}]: (no output)`;
  }

  const str = typeof output === "string" ? output : JSON.stringify(output);

  // Under 400 chars (~100 tokens) -- use as-is
  if (str.length <= 400) {
    return `[${stepId}]: ${str}`;
  }

  // Over limit -- truncate head+tail
  const head = str.slice(0, 200);
  const tail = str.slice(-150);
  return `[${stepId}]: ${head}...[truncated]...${tail}`;
}

/**
 * Return full output of primary dependency.
 * When the previous step output becomes the next step input.
 */
function getPrimaryDependencyOutput(
  dependsOn: string[],
  results: Map<string, StepResult>,
): string | undefined {
  if (dependsOn.length === 0) return undefined;
  const primary = results.get(dependsOn[dependsOn.length - 1]);
  if (!primary || primary.status !== "success") return undefined;

  const output = primary.output;
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

/**
 * Build system prompt.
 * Combine role + constraints + memory into one system prompt.
 */
export function buildSystemPrompt(
  context: ExecutionContext,
  rolePrompt?: string,
): string {
  const parts: string[] = [];

  // Role prompt (loaded from file)
  if (rolePrompt) {
    parts.push(rolePrompt);
  }

  // Constraints
  if (context.identity.constraints.length > 0) {
    parts.push(
      "## Constraints\n" +
        context.identity.constraints.map((c) => `- ${c}`).join("\n"),
    );
  }

  // Previous step context (if available)
  if (context.memory?.summary) {
    parts.push("## Previous Step Summary\n" + context.memory.summary);
  }

  return parts.join("\n\n");
}

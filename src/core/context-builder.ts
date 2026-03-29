import type {
  ExecutionContext,
  StepDefinition,
  StepResult,
  StepState,
} from "../types/index.js";

/**
 * Valid state transitions map.
 * Key = current step type, Value = set of step types that can precede it.
 * A warning (not an error) is logged for suspicious transitions.
 */
const VALID_TRANSITIONS: Record<StepState, Set<StepState>> = {
  classify:        new Set(["classify", "retrieve", "transform", "human_approval"]),
  retrieve:        new Set(["classify", "retrieve", "transform", "human_approval"]),
  generate:        new Set(["classify", "retrieve", "generate", "transform", "validate", "human_approval"]),
  validate:        new Set(["generate", "transform", "retrieve", "validate"]),
  transform:       new Set(["classify", "retrieve", "generate", "validate", "transform"]),
  human_approval:  new Set(["generate", "validate", "transform", "classify", "human_approval"]),
  record_decision: new Set(["human_approval", "validate", "generate", "transform", "record_decision"]),
};

/**
 * Validate that a step's dependencies represent reasonable state transitions.
 * Logs a warning for suspicious transitions -- never throws.
 */
function validateStateTransition(
  step: StepDefinition,
  previousResults: Map<string, StepResult>,
  allSteps?: StepDefinition[],
): void {
  if (!step.dependsOn?.length) return;

  const allowedPredecessors = VALID_TRANSITIONS[step.type];
  if (!allowedPredecessors) return;

  for (const depId of step.dependsOn) {
    // Try to resolve the dependency's step type from the results map first,
    // then fall back to allSteps if provided.
    let depType: StepState | undefined;

    // StepResult doesn't carry type directly, so look up from allSteps
    if (allSteps) {
      const depStep = allSteps.find((s) => s.id === depId);
      depType = depStep?.type;
    }

    if (depType && !allowedPredecessors.has(depType)) {
      console.warn(
        `[context-builder] Suspicious state transition: ` +
        `step "${step.id}" (${step.type}) depends on "${depId}" (${depType}). ` +
        `Expected predecessors: [${[...allowedPredecessors].join(", ")}]`,
      );
    }
  }
}

/**
 * Validate tool names. MCP tools must follow the pattern mcp:<server>:<tool>
 * (exactly 3 colon-separated parts). Logs a warning for malformed names.
 */
function validateTools(tools: string[]): void {
  for (const tool of tools) {
    if (tool.startsWith("mcp:")) {
      const parts = tool.split(":");
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        console.warn(
          `[context-builder] Malformed MCP tool name: "${tool}". ` +
          `Expected format: "mcp:<server>:<tool>" (exactly 3 colon-separated parts).`,
        );
      }
    }
  }
}

/**
 * Verify identity has minimum required fields.
 * Logs a warning if role is missing or empty.
 */
function verifyIdentity(identity: { role: string; constraints: string[] }): void {
  if (!identity.role || identity.role.trim().length === 0) {
    console.warn(
      `[context-builder] Identity verification failed: role is empty or missing.`,
    );
  }
  if (!Array.isArray(identity.constraints)) {
    console.warn(
      `[context-builder] Identity verification failed: constraints is not an array.`,
    );
  }
}

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
  allSteps?: StepDefinition[],
): ExecutionContext {
  // Pre-flight: validate state transitions
  validateStateTransition(step, previousResults, allSteps);

  // Pre-flight: validate tool names
  validateTools(step.context.tools);

  // Pre-flight: verify identity
  verifyIdentity(step.context.identity);

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
 *
 * Truncation strategy:
 * - JSON objects: parse, pick top-level keys, re-serialize to stay under limit
 * - Strings: truncate at sentence boundaries (". " or "\n") to avoid mid-word cuts
 * - Never produce malformed JSON in the summary
 */
function summarizeOutput(stepId: string, output: unknown): string {
  if (output === null || output === undefined) {
    return `[${stepId}]: (no output)`;
  }

  const MAX_CHARS = 400;

  // If the output is not a string, try JSON-safe truncation
  if (typeof output !== "string") {
    return `[${stepId}]: ${truncateJson(output, MAX_CHARS)}`;
  }

  // String output: use as-is if short enough
  if (output.length <= MAX_CHARS) {
    return `[${stepId}]: ${output}`;
  }

  // String output: might be serialized JSON
  try {
    const parsed = JSON.parse(output);
    return `[${stepId}]: ${truncateJson(parsed, MAX_CHARS)}`;
  } catch {
    // Plain string -- truncate at sentence boundary
    return `[${stepId}]: ${truncateString(output, MAX_CHARS)}`;
  }
}

/**
 * Truncate a JSON-serializable value while preserving valid JSON structure.
 * Picks top-level keys until the budget is exhausted, then adds a marker.
 */
function truncateJson(value: unknown, maxChars: number): string {
  const full = JSON.stringify(value);
  if (full.length <= maxChars) return full;

  // For arrays: keep elements from the front until budget exhausted
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    let size = 2; // "[]"
    for (const item of value) {
      const itemStr = JSON.stringify(item);
      // +2 for ", " separator (or just the item if first)
      const addition = kept.length === 0 ? itemStr.length : itemStr.length + 2;
      if (size + addition + 30 > maxChars) break; // reserve room for truncation marker
      kept.push(item);
      size += addition;
    }
    const truncated = JSON.stringify(kept);
    if (kept.length < value.length) {
      // Replace closing "]" with a truncation note
      return truncated.slice(0, -1) +
        `,"...(${value.length - kept.length} more items)"]`;
    }
    return truncated;
  }

  // For objects: keep keys from the front until budget exhausted
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const kept: Record<string, unknown> = {};
    let size = 2; // "{}"
    let keptCount = 0;
    for (const [key, val] of entries) {
      const entryStr = JSON.stringify(key) + ":" + JSON.stringify(val);
      const addition = keptCount === 0 ? entryStr.length : entryStr.length + 1;
      if (size + addition + 40 > maxChars) break; // reserve room for truncation marker
      kept[key] = val;
      size += addition;
      keptCount++;
    }
    const truncated = JSON.stringify(kept);
    if (keptCount < entries.length) {
      return truncated.slice(0, -1) +
        `,"_truncated":"${entries.length - keptCount} more keys"}`;
    }
    return truncated;
  }

  // Primitive (number, boolean, etc.) -- just stringify
  return full.slice(0, maxChars);
}

/**
 * Truncate a plain string at a sentence boundary.
 * Looks for ". " or "\n" near the limit to avoid mid-word cuts.
 */
function truncateString(str: string, maxChars: number): string {
  // Look for a sentence boundary in the last 25% of the allowed range
  const searchStart = Math.floor(maxChars * 0.75);
  const candidate = str.slice(0, maxChars);

  // Try ". " first (sentence end)
  const dotIdx = candidate.lastIndexOf(". ", maxChars);
  if (dotIdx >= searchStart) {
    return candidate.slice(0, dotIdx + 1) + " ...[truncated]";
  }

  // Try newline
  const nlIdx = candidate.lastIndexOf("\n", maxChars);
  if (nlIdx >= searchStart) {
    return candidate.slice(0, nlIdx) + " ...[truncated]";
  }

  // Try space (avoid mid-word)
  const spaceIdx = candidate.lastIndexOf(" ", maxChars);
  if (spaceIdx >= searchStart) {
    return candidate.slice(0, spaceIdx) + " ...[truncated]";
  }

  // Worst case: hard cut (but we never do this with JSON)
  return candidate + " ...[truncated]";
}

/**
 * Merge full outputs from ALL dependencies (not just the last one).
 * When multiple previous steps feed into the next step, all outputs are combined.
 * Single dependency: returns its output directly.
 * Multiple dependencies: returns a JSON object keyed by step ID.
 */
function getPrimaryDependencyOutput(
  dependsOn: string[],
  results: Map<string, StepResult>,
): string | undefined {
  if (dependsOn.length === 0) return undefined;

  const outputs: Record<string, unknown> = {};
  let successCount = 0;

  for (const depId of dependsOn) {
    const result = results.get(depId);
    if (result && result.status === "success") {
      outputs[depId] = result.output;
      successCount++;
    }
  }

  if (successCount === 0) return undefined;

  // Single dependency: return its output directly (preserves backward compat)
  if (successCount === 1) {
    const singleOutput = Object.values(outputs)[0];
    if (typeof singleOutput === "string") return singleOutput;
    return JSON.stringify(singleOutput);
  }

  // Multiple dependencies: combine into a keyed object
  return JSON.stringify(outputs);
}

/**
 * Build system prompt.
 * Combine role + constraints + memory into one system prompt.
 */
export function buildSystemPrompt(
  context: ExecutionContext,
  rolePrompt?: string,
  memoryInsights?: string,
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

  // Cross-run memory insights
  if (memoryInsights) {
    parts.push(memoryInsights);
  }

  return parts.join("\n\n");
}

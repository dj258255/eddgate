import type { ModelConfig, StepState } from "../types/index.js";

/**
 * Model Provider
 *
 * Resolves which model to use for each step type.
 * Supports per-step-type overrides (classify=haiku, generate=sonnet, etc.)
 */

export function resolveModelForStep(
  config: ModelConfig,
  stepType: StepState,
  stepModelOverride?: string,
): string {
  // Step-level override takes highest priority
  if (stepModelOverride) return normalizeAlias(stepModelOverride);

  // Config-level step-type override
  if (config.overrides) {
    const typeOverride =
      stepType === "classify" ? config.overrides.classify :
      stepType === "generate" ? config.overrides.generate :
      stepType === "validate" ? config.overrides.validate :
      undefined;

    if (typeOverride) return normalizeAlias(typeOverride);
  }

  // Default model
  return normalizeAlias(config.default);
}

/**
 * Normalize model name to Claude Code CLI alias.
 */
function normalizeAlias(model: string): string {
  const aliases = ["sonnet", "opus", "haiku"];
  if (aliases.includes(model)) return model;

  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";

  return model;
}

import { readFile, readdir } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ValidationRule } from "../types/index.js";

/**
 * Load auto-generated rules from eval/rules/ directory.
 * These are produced by `eddgate analyze --generate-rules`.
 * Merged into workflow step validation at runtime.
 */
export async function loadAutoRules(
  rulesDir: string,
): Promise<Map<string, ValidationRule[]>> {
  const dir = resolve(rulesDir);
  const rulesByStep = new Map<string, ValidationRule[]>();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return rulesByStep; // dir doesn't exist = no auto rules
  }

  for (const file of files) {
    if (extname(file) !== ".yaml" && extname(file) !== ".yml") continue;

    try {
      const content = await readFile(join(dir, file), "utf-8");
      const parsed = parseYaml(content) as Record<string, unknown>;

      if (!parsed.type || !parsed.message) continue;

      // Extract step name from filename (e.g., "validate_final_adjusted_threshold.yaml")
      const stepId = file.split("_").slice(0, -1).join("_") || file.replace(/\.\w+$/, "");

      const rule: ValidationRule = {
        type: (parsed.type as string) === "evaluation_threshold" ? "custom" : (parsed.type as ValidationRule["type"]),
        spec: (parsed.spec as Record<string, unknown>) ?? {},
        message: `[auto] ${parsed.message as string}`,
      };

      const existing = rulesByStep.get(stepId) ?? [];
      existing.push(rule);
      rulesByStep.set(stepId, existing);
    } catch {
      // Skip invalid files
    }
  }

  return rulesByStep;
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runAgent } from "./agent-runner.js";
import { TraceEmitter } from "../trace/emitter.js";

export interface PromptPatch {
  stepId: string;
  role: string;
  promptFile: string;         // e.g. "templates/prompts/artifact_validator.md"
  originalContent: string;
  suggestedContent: string;
  reason: string;             // why this change
  failurePattern: string;     // which cluster triggered this
  confidence: "high" | "medium" | "low";
}

export interface PromptImproveResult {
  patches: PromptPatch[];
  analysisTokens: number;
}

/**
 * Analyze failure clusters and generate prompt improvement suggestions.
 * Uses LLM to read the current prompt + failure patterns and suggest edits.
 */
export async function suggestPromptImprovements(options: {
  clusters: Array<{
    stepId: string;
    failureType: string;
    description: string;
    count: number;
    fix: string;
    avgScore?: number;
    instances: Array<{ message: string; role?: string }>;
  }>;
  promptsDir: string;
  tracer?: TraceEmitter;
}): Promise<PromptImproveResult> {
  const { clusters, promptsDir, tracer } = options;
  const patches: PromptPatch[] = [];
  let totalTokens = 0;
  const tr = tracer ?? new TraceEmitter();

  for (const cluster of clusters) {
    // Only improve eval_fail and validation_fail (not rate limits, timeouts)
    if (!cluster.failureType.includes("eval_fail") && !cluster.failureType.includes("validation_fail")) continue;

    // Find the role from instances
    const role = cluster.instances.find(i => i.role)?.role;
    if (!role) continue;

    // Try to load the prompt file
    const promptFile = resolve(promptsDir, `${role}.md`);
    let originalContent: string;
    try {
      originalContent = await readFile(promptFile, "utf-8");
    } catch {
      continue; // No prompt file for this role
    }

    // Build improvement request for LLM
    const failureMessages = [...new Set(cluster.instances.map(i => i.message))].slice(0, 5);
    const prompt = `You are a prompt engineering expert. A workflow step is failing repeatedly.

## Current Prompt
\`\`\`
${originalContent}
\`\`\`

## Failure Pattern
- Step: "${cluster.stepId}" (role: "${role}")
- Failure type: ${cluster.failureType}
- Description: ${cluster.description}
- Occurrences: ${cluster.count}
- Average score: ${cluster.avgScore?.toFixed(2) ?? "N/A"}
- Sample failure messages:
${failureMessages.map(m => `  - ${m}`).join("\n")}

## Suggested fix from analysis
${cluster.fix}

## Your task
Rewrite the prompt to fix the failure pattern. Keep the same overall structure and purpose, but add/modify instructions to address the specific failures.

Rules:
- Return ONLY the improved prompt text, no explanations before or after
- Keep the same markdown format as the original
- Add specific examples or constraints that address the failure messages
- Do not remove existing instructions unless they conflict with the fix
- If the issue is about output format, add explicit format examples`;

    try {
      const result = await runAgent({
        stepId: `prompt-improve-${cluster.stepId}`,
        context: {
          state: "generate",
          identity: { role: "prompt_improver", constraints: ["Return only the improved prompt"] },
          tools: [],
        },
        input: prompt,
        tracer: tr,
      });

      totalTokens += result.inputTokens + result.outputTokens;

      // Determine confidence based on score and count
      let confidence: "high" | "medium" | "low" = "medium";
      if (cluster.count > 10 && cluster.avgScore !== undefined && cluster.avgScore < 0.5) confidence = "high";
      if (cluster.count < 3) confidence = "low";

      patches.push({
        stepId: cluster.stepId,
        role,
        promptFile,
        originalContent,
        suggestedContent: result.text.trim(),
        reason: cluster.fix,
        failurePattern: cluster.description,
        confidence,
      });
    } catch {
      // Skip if LLM call fails
    }
  }

  return { patches, analysisTokens: totalTokens };
}

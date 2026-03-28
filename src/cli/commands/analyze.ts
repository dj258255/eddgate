import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import type { TraceEvent, ValidationResult, EvaluationResult } from "../../types/index.js";

interface AnalyzeOptions {
  dir: string;
  context?: boolean;
  generateRules?: boolean;
  output?: string;
}

// ─── Failure Pattern ─────────────────────────────────────────

interface FailureInstance {
  traceId: string;
  stepId: string;
  type: "validation_fail" | "eval_fail" | "error" | "low_score";
  message: string;
  score?: number;
  context?: {
    role?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  };
}

interface FailureCluster {
  id: string;
  pattern: string;
  count: number;
  percentage: number;
  instances: FailureInstance[];
  suggestedFix: string;
  suggestedRule?: GeneratedRule;
}

interface GeneratedRule {
  type: string;
  spec: Record<string, unknown>;
  message: string;
}

// ─── Context Profile ─────────────────────────────────────────

interface ContextProfile {
  totalTokens: number;
  breakdown: {
    systemPrompt: number;
    tools: number;
    history: number;
    retrieval: number;
    other: number;
  };
  waste: string[];
  recommendations: string[];
}

// ─── Main ────────────────────────────────────────────────────

export async function analyzeCommand(
  options: AnalyzeOptions,
): Promise<void> {
  const tracesDir = resolve(options.dir);
  const events = await loadAllTraces(tracesDir);

  if (events.length === 0) {
    console.log(chalk.dim("\nNo traces found. Run a workflow first.\n"));
    return;
  }

  console.log(chalk.bold("\neddgate analyze\n"));
  console.log(chalk.dim(`  traces: ${tracesDir}`));
  console.log(chalk.dim(`  events: ${events.length}\n`));

  if (options.context) {
    // Context Window Profiler mode
    const profile = analyzeContextWindows(events);
    renderContextProfile(profile);
  } else {
    // Error Analysis mode
    const failures = extractFailures(events);

    if (failures.length === 0) {
      console.log(chalk.green("  No failures found in traces.\n"));
      return;
    }

    const clusters = clusterFailures(failures, events.length);
    renderClusters(clusters);

    if (options.generateRules) {
      await generateRuleFiles(clusters, options.output ?? "./eval/rules");
    }
  }
}

// ─── Error Analysis ──────────────────────────────────────────

function extractFailures(events: TraceEvent[]): FailureInstance[] {
  const failures: FailureInstance[] = [];

  for (const event of events) {
    if (event.type === "validation" && event.data.validationResult) {
      const vr = event.data.validationResult as ValidationResult;
      if (!vr.passed) {
        for (const f of vr.failures) {
          failures.push({
            traceId: event.traceId,
            stepId: event.stepId,
            type: "validation_fail",
            message: f.rule.message,
            context: {
              role: event.context?.identity.role,
              model: event.context?.identity.model ?? undefined,
            },
          });
        }
      }
    }

    if (event.type === "evaluation" && event.data.evaluationResult) {
      const er = event.data.evaluationResult as EvaluationResult;
      if (!er.passed) {
        failures.push({
          traceId: event.traceId,
          stepId: event.stepId,
          type: "eval_fail",
          message: er.reasoning ?? `score ${er.score} below threshold`,
          score: er.score,
          context: {
            role: event.context?.identity.role,
          },
        });
      }
    }

    if (event.type === "error") {
      failures.push({
        traceId: event.traceId,
        stepId: event.stepId,
        type: "error",
        message: event.data.error ?? "unknown error",
      });
    }
  }

  return failures;
}

function clusterFailures(
  failures: FailureInstance[],
  totalEvents: number,
): FailureCluster[] {
  // Group by step + type + message pattern
  const groups = new Map<string, FailureInstance[]>();

  for (const f of failures) {
    // Normalize message for grouping
    const normalized = normalizeMessage(f.message);
    const key = `${f.stepId}:${f.type}:${normalized}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const clusters: FailureCluster[] = [];
  let id = 1;

  for (const [key, instances] of groups) {
    const [stepId, type, pattern] = key.split(":");
    const percentage = (instances.length / Math.max(1, failures.length)) * 100;

    clusters.push({
      id: `C${id++}`,
      pattern: `[${stepId}] ${type}: ${pattern}`,
      count: instances.length,
      percentage,
      instances,
      suggestedFix: suggestFix(type, pattern, stepId, instances),
      suggestedRule: suggestRule(type, pattern, instances),
    });
  }

  // Sort by count descending
  clusters.sort((a, b) => b.count - a.count);

  return clusters;
}

function normalizeMessage(msg: string): string {
  return msg
    .replace(/\d+/g, "N")      // numbers -> N
    .replace(/https?:\/\/\S+/g, "URL") // URLs -> URL
    .replace(/\s+/g, " ")      // whitespace
    .trim()
    .slice(0, 80);
}

function suggestFix(type: string, pattern: string, stepId: string, instances: FailureInstance[]): string {
  if (type === "validation_fail") {
    if (pattern.includes("too short") || pattern.includes("짧")) {
      return `Lower the length threshold for step "${stepId}" or improve the prompt to generate more detailed output`;
    }
    if (pattern.includes("required") || pattern.includes("필수")) {
      return `Add output format examples to the prompt for step "${stepId}" to ensure required fields are produced`;
    }
    if (pattern.includes("URL") || pattern.includes("http")) {
      return `Add URL validation to the search step or constrain output to verified links only`;
    }
    return `Review validation rules for step "${stepId}" -- may be too strict or prompt may need clarification`;
  }

  if (type === "eval_fail") {
    const avgScore = instances.reduce((s, i) => s + (i.score ?? 0), 0) / instances.length;
    if (avgScore > 0.6) {
      return `Scores averaging ${avgScore.toFixed(2)} -- consider lowering threshold or improving source quality`;
    }
    return `Low evaluation scores in "${stepId}" -- check if retrieval is returning relevant documents`;
  }

  if (type === "error") {
    if (pattern.includes("limit") || pattern.includes("rate")) {
      return `Rate limit hit -- add request throttling or upgrade subscription tier`;
    }
    if (pattern.includes("timeout") || pattern.includes("ETIMEDOUT")) {
      return `Timeout errors -- increase timeout settings or check network connectivity`;
    }
    return `Runtime errors in "${stepId}" -- check logs for details`;
  }

  return `Review step "${stepId}" configuration`;
}

function suggestRule(type: string, pattern: string, instances: FailureInstance[]): GeneratedRule | undefined {
  if (type === "validation_fail" && pattern.includes("short")) {
    return {
      type: "length",
      spec: { min: 50 },
      message: `Output too short (pattern from ${instances.length} failures)`,
    };
  }

  if (type === "eval_fail") {
    const avgScore = instances.reduce((s, i) => s + (i.score ?? 0), 0) / instances.length;
    return {
      type: "custom",
      spec: { check: "min_evidence_count", minCount: 2 },
      message: `Ensure at least 2 evidence citations (avg eval score: ${avgScore.toFixed(2)})`,
    };
  }

  return undefined;
}

// ─── Context Window Profiler ─────────────────────────────────

function analyzeContextWindows(events: TraceEvent[]): ContextProfile {
  const llmCalls = events.filter((e) => e.type === "llm_call");

  let totalInput = 0;
  let totalOutput = 0;
  const stepTokens = new Map<string, number>();

  for (const e of llmCalls) {
    const input = e.data.inputTokens ?? 0;
    const output = e.data.outputTokens ?? 0;
    totalInput += input;
    totalOutput += output;

    const existing = stepTokens.get(e.stepId) ?? 0;
    stepTokens.set(e.stepId, existing + input + output);
  }

  // Estimate breakdown (heuristic based on typical patterns)
  const totalTokens = totalInput + totalOutput;
  const stepCount = new Set(llmCalls.map((e) => e.stepId)).size;

  // System prompt is typically sent with every call
  const estimatedSystemPerCall = Math.min(500, totalInput / Math.max(1, llmCalls.length) * 0.3);
  const systemTotal = Math.round(estimatedSystemPerCall * llmCalls.length);

  const waste: string[] = [];
  const recommendations: string[] = [];

  // Find steps with disproportionate token usage
  const avgPerStep = totalTokens / Math.max(1, stepCount);
  for (const [step, tokens] of stepTokens) {
    if (tokens > avgPerStep * 3) {
      waste.push(`Step "${step}" uses ${tokens.toLocaleString()} tokens (${((tokens / totalTokens) * 100).toFixed(0)}% of total) -- consider splitting or optimizing`);
    }
  }

  // Check for repeated calls (retry indicator)
  const callsPerStep = new Map<string, number>();
  for (const e of llmCalls) {
    callsPerStep.set(e.stepId, (callsPerStep.get(e.stepId) ?? 0) + 1);
  }
  for (const [step, count] of callsPerStep) {
    if (count > 2) {
      waste.push(`Step "${step}" made ${count} LLM calls (possible retries wasting ${((count - 1) * (stepTokens.get(step) ?? 0) / count).toLocaleString()} tokens)`);
      recommendations.push(`Reduce retries for "${step}" or lower eval threshold`);
    }
  }

  // General recommendations
  if (totalInput > 50000) {
    recommendations.push("Total input tokens exceed 50K -- context rot likely. Consider summarizing intermediate results");
  }
  if (llmCalls.length > 15) {
    recommendations.push(`${llmCalls.length} LLM calls is high -- check if some steps can be merged or removed`);
  }

  return {
    totalTokens,
    breakdown: {
      systemPrompt: systemTotal,
      tools: 0, // Would need tool definitions to calculate
      history: Math.round(totalInput * 0.2),
      retrieval: Math.round(totalInput * 0.3),
      other: Math.round(totalInput * 0.2),
    },
    waste,
    recommendations,
  };
}

// ─── Rendering ───────────────────────────────────────────────

function renderClusters(clusters: FailureCluster[]): void {
  console.log(chalk.bold("  Failure Patterns:\n"));

  for (const c of clusters) {
    const bar = "#".repeat(Math.max(1, Math.round(c.percentage / 3)));
    console.log(`  ${chalk.red(c.id)} ${c.pattern}`);
    console.log(`     ${chalk.dim(`${c.count} occurrences (${c.percentage.toFixed(0)}%)`)} ${chalk.red(bar)}`);
    console.log(`     ${chalk.cyan("Fix:")} ${c.suggestedFix}`);
    if (c.suggestedRule) {
      console.log(`     ${chalk.yellow("Rule:")} ${c.suggestedRule.type} -- ${c.suggestedRule.message}`);
    }
    console.log();
  }
}

function renderContextProfile(profile: ContextProfile): void {
  console.log(chalk.bold("  Context Window Profile:\n"));

  console.log(`  Total tokens: ${profile.totalTokens.toLocaleString()}\n`);

  const { breakdown } = profile;
  const total = Math.max(1, profile.totalTokens);

  const items = [
    { label: "System prompt", tokens: breakdown.systemPrompt },
    { label: "Retrieval", tokens: breakdown.retrieval },
    { label: "History", tokens: breakdown.history },
    { label: "Other", tokens: breakdown.other },
  ];

  for (const item of items) {
    const pct = ((item.tokens / total) * 100).toFixed(0);
    const bar = "=".repeat(Math.max(1, Math.round(item.tokens / total * 40)));
    console.log(`  ${item.label.padEnd(16)} ${item.tokens.toLocaleString().padStart(8)} (${pct.padStart(2)}%) ${chalk.cyan(bar)}`);
  }

  if (profile.waste.length > 0) {
    console.log(chalk.bold("\n  Waste Detected:\n"));
    for (const w of profile.waste) {
      console.log(chalk.yellow(`  - ${w}`));
    }
  }

  if (profile.recommendations.length > 0) {
    console.log(chalk.bold("\n  Recommendations:\n"));
    for (const r of profile.recommendations) {
      console.log(chalk.cyan(`  - ${r}`));
    }
  }

  console.log();
}

// ─── Rule Generation ─────────────────────────────────────────

async function generateRuleFiles(
  clusters: FailureCluster[],
  outputDir: string,
): Promise<void> {
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true });

  let generated = 0;

  for (const cluster of clusters) {
    if (!cluster.suggestedRule) continue;

    const filename = `auto_${cluster.id.toLowerCase()}_${sanitize(cluster.pattern.slice(0, 30))}.yaml`;
    const filepath = join(dir, filename);

    const yaml = [
      `# Auto-generated by eddgate analyze`,
      `# Pattern: ${cluster.pattern}`,
      `# Occurrences: ${cluster.count} (${cluster.percentage.toFixed(0)}%)`,
      `# Suggested fix: ${cluster.suggestedFix}`,
      ``,
      `type: "${cluster.suggestedRule.type}"`,
      `spec:`,
      ...Object.entries(cluster.suggestedRule.spec).map(
        ([k, v]) => `  ${k}: ${JSON.stringify(v)}`,
      ),
      `message: "${cluster.suggestedRule.message}"`,
    ].join("\n");

    await writeFile(filepath, yaml, "utf-8");
    console.log(chalk.green(`  Generated: ${filepath}`));
    generated++;
  }

  if (generated === 0) {
    console.log(chalk.dim("  No rules to generate."));
  } else {
    console.log(chalk.bold(`\n  ${generated} rule(s) generated in ${dir}\n`));
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

// ─── Trace Loading ───────────────────────────────────────────

async function loadAllTraces(dir: string): Promise<TraceEvent[]> {
  const files = await readdir(dir).catch(() => []);
  const events: TraceEvent[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const content = await readFile(join(dir, file), "utf-8");
    for (const line of content.split("\n").filter(Boolean)) {
      try { events.push(JSON.parse(line) as TraceEvent); } catch { /* skip */ }
    }
  }

  return events;
}

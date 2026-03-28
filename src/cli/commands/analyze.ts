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

interface FailureInstance {
  traceId: string;
  stepId: string;
  type: "validation_fail" | "eval_fail" | "error";
  message: string;
  score?: number;
  role?: string;
  tokens?: number;
}

interface FailureCluster {
  id: string;
  stepId: string;
  failureType: string;
  description: string;
  count: number;
  percentage: number;
  avgScore?: number;
  scoreRange?: { min: number; max: number };
  instances: FailureInstance[];
  fix: string;
  rules: GeneratedRule[];
}

interface GeneratedRule {
  filename: string;
  type: string;
  spec: Record<string, unknown>;
  message: string;
  context: string;
}

// ─── Main ────────────────────────────────────────────────────

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const tracesDir = resolve(options.dir);
  const events = await loadAllTraces(tracesDir);

  if (events.length === 0) {
    console.log(chalk.dim("\nNo traces found. Run a workflow first.\n"));
    return;
  }

  const traceCount = new Set(events.map((e) => e.traceId)).size;
  console.log(chalk.bold("\neddgate analyze\n"));
  console.log(chalk.dim(`  ${events.length} events from ${traceCount} run(s)\n`));

  if (options.context) {
    renderContextProfile(events);
    return;
  }

  const failures = extractFailures(events);
  if (failures.length === 0) {
    console.log(chalk.green("  No failures found.\n"));
    return;
  }

  const clusters = clusterFailures(failures);
  renderClusters(clusters, traceCount);

  if (options.generateRules) {
    await generateRuleFiles(clusters, options.output ?? "./eval/rules");

    // Show split view if TTY (patterns left, rules right)
    if (process.stdout.isTTY) {
      try {
        const { showRulePreview } = await import("../split-view.js");
        await showRulePreview(
          clusters.map((c) => ({
            id: c.id,
            description: c.description,
            count: c.count,
            percentage: c.percentage,
            fix: c.fix,
            ruleYaml: c.rules.map((r) =>
              `type: "${r.type}"\nspec:\n${Object.entries(r.spec).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n")}\nmessage: "${r.message}"`
            ).join("\n---\n"),
          })),
        );
      } catch { /* split view not available */ }
    }
  }
}

// ─── Failure Extraction ──────────────────────────────────────

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
            role: event.context?.identity.role,
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
          message: er.reasoning ?? "",
          score: er.score,
          role: event.context?.identity.role,
        });
      }
    }

    if (event.type === "error") {
      failures.push({
        traceId: event.traceId,
        stepId: event.stepId,
        type: "error",
        message: event.data.error ?? "unknown",
      });
    }
  }

  return failures;
}

// ─── Clustering: step + type + score band ────────────────────

function clusterFailures(failures: FailureInstance[]): FailureCluster[] {
  // Group by step + type (NOT by message -- that's what caused 6 clusters for 1 problem)
  const groups = new Map<string, FailureInstance[]>();

  for (const f of failures) {
    // Errors subgroup by category (rate limit, timeout, other)
    let subtype = "";
    if (f.type === "error") {
      if (f.message.includes("limit") || f.message.includes("rate")) subtype = ":rate_limit";
      else if (f.message.includes("timeout") || f.message.includes("ETIMEDOUT")) subtype = ":timeout";
      else subtype = ":runtime";
    }

    const key = `${f.stepId}:${f.type}${subtype}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const clusters: FailureCluster[] = [];
  let id = 1;

  for (const [key, instances] of groups) {
    const parts = key.split(":");
    const stepId = parts[0];
    const failureType = parts.slice(1).join(":");
    const percentage = (instances.length / failures.length) * 100;

    // Score stats for eval failures
    const scores = instances.filter((i) => i.score !== undefined).map((i) => i.score!);
    const avgScore = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : undefined;
    const scoreRange = scores.length > 0 ? { min: Math.min(...scores), max: Math.max(...scores) } : undefined;

    const cluster: FailureCluster = {
      id: `C${id++}`,
      stepId,
      failureType,
      description: buildDescription(failureType, stepId, instances, avgScore),
      count: instances.length,
      percentage,
      avgScore,
      scoreRange,
      instances,
      fix: buildFix(failureType, stepId, instances, avgScore, scoreRange),
      rules: buildRules(failureType, stepId, instances, avgScore, scoreRange),
    };

    clusters.push(cluster);
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

function buildDescription(type: string, stepId: string, instances: FailureInstance[], avgScore?: number): string {
  if (type === "eval_fail") {
    return `Eval gate failed at "${stepId}" (avg score: ${avgScore?.toFixed(2) ?? "?"}, ${instances.length} times)`;
  }
  if (type === "validation_fail") {
    const msgs = [...new Set(instances.map((i) => i.message))];
    return `Validation failed at "${stepId}": ${msgs.join(", ")}`;
  }
  if (type.includes("rate_limit")) {
    return `Rate limit hit at "${stepId}" (${instances.length} times)`;
  }
  if (type.includes("timeout")) {
    return `Timeout at "${stepId}" (${instances.length} times)`;
  }
  return `Runtime error at "${stepId}" (${instances.length} times)`;
}

function buildFix(type: string, stepId: string, instances: FailureInstance[], avgScore?: number, range?: { min: number; max: number }): string {
  if (type === "eval_fail" && avgScore !== undefined) {
    if (avgScore >= 0.65) {
      return `Scores are close to threshold (avg ${avgScore.toFixed(2)}). Options: (1) lower threshold slightly, (2) improve prompt specificity for "${stepId}", (3) add few-shot examples to the role prompt`;
    }
    if (avgScore >= 0.4) {
      return `Moderate eval failures (avg ${avgScore.toFixed(2)}). Check: (1) is retrieval returning relevant docs? (2) is the prompt too vague? (3) consider splitting this step into smaller sub-steps`;
    }
    return `Severe eval failures (avg ${avgScore.toFixed(2)}). The step "${stepId}" may need fundamental redesign -- check if the task is too complex for a single step`;
  }

  if (type === "validation_fail") {
    const msgs = [...new Set(instances.map((i) => i.message))];
    if (msgs.some((m) => m.includes("short") || m.includes("짧"))) {
      return `Output too short. Add "be detailed and comprehensive" to constraints, or lower the min length threshold`;
    }
    if (msgs.some((m) => m.includes("required") || m.includes("필수"))) {
      return `Missing required fields. Add explicit output format example to the role prompt: "You MUST include these fields: ..."`;
    }
    return `Validation rule mismatch. Review rules for "${stepId}" -- they may be too strict for this model's output style`;
  }

  if (type.includes("rate_limit")) {
    return `Rate limits are causing retries that waste tokens. Solutions: (1) add delay between steps, (2) use a smaller model for eval steps, (3) reduce maxRetries`;
  }

  if (type.includes("timeout")) {
    return `Network timeouts. Check connection stability or increase timeout settings`;
  }

  return `Review step "${stepId}" configuration and logs`;
}

function buildRules(type: string, stepId: string, instances: FailureInstance[], avgScore?: number, range?: { min: number; max: number }): GeneratedRule[] {
  const rules: GeneratedRule[] = [];

  if (type === "eval_fail" && avgScore !== undefined) {
    // Suggest adjusted threshold
    if (range && range.max > 0.6) {
      const suggestedThreshold = Math.round((range.max - 0.05) * 100) / 100;
      rules.push({
        filename: `${stepId}_adjusted_threshold.yaml`,
        type: "evaluation_threshold",
        spec: { step: stepId, threshold: suggestedThreshold },
        message: `Adjusted threshold for ${stepId} based on observed score range ${range.min.toFixed(2)}-${range.max.toFixed(2)}`,
        context: `${instances.length} eval failures, avg score ${avgScore.toFixed(2)}`,
      });
    }

    // Suggest output quality check
    rules.push({
      filename: `${stepId}_output_quality.yaml`,
      type: "length",
      spec: { min: 100, field: "output" },
      message: `Ensure ${stepId} produces substantive output (prevents low eval scores from thin content)`,
      context: `Added because eval scores suggest thin/incomplete outputs`,
    });
  }

  if (type === "validation_fail") {
    const msgs = [...new Set(instances.map((i) => i.message))];
    for (const msg of msgs) {
      rules.push({
        filename: `${stepId}_${sanitize(msg.slice(0, 20))}.yaml`,
        type: "custom",
        spec: { check: "prompt_reinforcement", step: stepId, constraint: msg },
        message: msg,
        context: `${instances.length} validation failures with this message`,
      });
    }
  }

  if (type.includes("rate_limit")) {
    rules.push({
      filename: `${stepId}_rate_limit_protection.yaml`,
      type: "custom",
      spec: { check: "max_retries", maxRetries: 2 },
      message: `Limit retries for ${stepId} to prevent rate limit exhaustion`,
      context: `${instances.length} rate limit errors observed`,
    });
  }

  return rules;
}

// ─── Context Window Profiler ─────────────────────────────────

function renderContextProfile(events: TraceEvent[]): void {
  const llmCalls = events.filter((e) => e.type === "llm_call");
  const traceCount = new Set(events.map((e) => e.traceId)).size;

  console.log(chalk.bold("  Context Window Profile\n"));

  // Per-step token analysis
  const stepStats = new Map<string, { calls: number; inputTotal: number; outputTotal: number }>();
  for (const e of llmCalls) {
    const existing = stepStats.get(e.stepId) ?? { calls: 0, inputTotal: 0, outputTotal: 0 };
    existing.calls++;
    existing.inputTotal += e.data.inputTokens ?? 0;
    existing.outputTotal += e.data.outputTokens ?? 0;
    stepStats.set(e.stepId, existing);
  }

  const totalInput = llmCalls.reduce((s, e) => s + (e.data.inputTokens ?? 0), 0);
  const totalOutput = llmCalls.reduce((s, e) => s + (e.data.outputTokens ?? 0), 0);
  const totalTokens = totalInput + totalOutput;

  console.log(`  Total: ${totalTokens.toLocaleString()} tokens (${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out)`);
  console.log(`  Across ${llmCalls.length} LLM calls in ${traceCount} run(s)\n`);

  // Per-step breakdown
  console.log(chalk.bold("  Per-step breakdown:\n"));
  console.log(`  ${"Step".padEnd(25)} ${"Calls".padEnd(6)} ${"Input".padEnd(10)} ${"Output".padEnd(10)} ${"Total".padEnd(10)} ${"% of Total"}`);
  console.log(`  ${"─".repeat(25)} ${"─".repeat(6)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)}`);

  const sortedSteps = [...stepStats.entries()].sort((a, b) =>
    (b[1].inputTotal + b[1].outputTotal) - (a[1].inputTotal + a[1].outputTotal),
  );

  const waste: string[] = [];
  const recommendations: string[] = [];

  for (const [step, stats] of sortedSteps) {
    const total = stats.inputTotal + stats.outputTotal;
    const pct = ((total / Math.max(1, totalTokens)) * 100).toFixed(1);
    const bar = chalk.cyan("=".repeat(Math.max(1, Math.round(parseFloat(pct) / 2.5))));

    console.log(
      `  ${step.padEnd(25)} ${String(stats.calls).padEnd(6)} ${stats.inputTotal.toLocaleString().padEnd(10)} ${stats.outputTotal.toLocaleString().padEnd(10)} ${total.toLocaleString().padEnd(10)} ${pct.padStart(5)}% ${bar}`,
    );

    // Waste detection
    if (stats.calls > 2 * traceCount) {
      const wastedTokens = Math.round(((stats.calls - traceCount) / stats.calls) * total);
      waste.push(`"${step}" made ${stats.calls} calls (${traceCount} expected) -- ~${wastedTokens.toLocaleString()} tokens wasted on retries`);
    }

    if (stats.inputTotal > stats.outputTotal * 5) {
      waste.push(`"${step}" input/output ratio is ${(stats.inputTotal / Math.max(1, stats.outputTotal)).toFixed(1)}:1 -- context may be bloated`);
    }
  }

  // Recommendations
  if (totalTokens > 50000 * traceCount) {
    recommendations.push(`Average ${Math.round(totalTokens / traceCount).toLocaleString()} tokens per run -- context rot likely above 50K. Consider summarizing intermediate results.`);
  }

  const highestStep = sortedSteps[0];
  if (highestStep) {
    const highPct = ((highestStep[1].inputTotal + highestStep[1].outputTotal) / totalTokens) * 100;
    if (highPct > 40) {
      recommendations.push(`"${highestStep[0]}" consumes ${highPct.toFixed(0)}% of all tokens. Consider splitting into smaller steps or reducing its input.`);
    }
  }

  if (waste.length > 0) {
    console.log(chalk.bold("\n  Waste detected:\n"));
    for (const w of waste) console.log(chalk.yellow(`    ${w}`));
  }

  if (recommendations.length > 0) {
    console.log(chalk.bold("\n  Recommendations:\n"));
    for (const r of recommendations) console.log(chalk.cyan(`    ${r}`));
  }

  console.log();
}

// ─── Rendering ───────────────────────────────────────────────

function renderClusters(clusters: FailureCluster[], traceCount: number): void {
  const totalFailures = clusters.reduce((s, c) => s + c.count, 0);
  console.log(chalk.bold(`  ${totalFailures} failures in ${clusters.length} patterns:\n`));

  for (const c of clusters) {
    const pctBar = chalk.red("#".repeat(Math.max(1, Math.round(c.percentage / 2))));

    console.log(chalk.bold(`  ${c.id} ${c.description}`));
    console.log(`     ${c.count} occurrences (${c.percentage.toFixed(0)}% of failures) ${pctBar}`);

    if (c.scoreRange) {
      console.log(chalk.dim(`     Score range: ${c.scoreRange.min.toFixed(2)} - ${c.scoreRange.max.toFixed(2)}, avg: ${c.avgScore?.toFixed(2)}`));
    }

    console.log(chalk.cyan(`     Fix: ${c.fix}`));

    if (c.rules.length > 0) {
      for (const r of c.rules) {
        console.log(chalk.yellow(`     Rule: ${r.filename} (${r.type})`));
      }
    }
    console.log();
  }
}

// ─── Rule File Generation ────────────────────────────────────

async function generateRuleFiles(clusters: FailureCluster[], outputDir: string): Promise<void> {
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true });
  let count = 0;

  for (const cluster of clusters) {
    for (const rule of cluster.rules) {
      const filepath = join(dir, rule.filename);
      const yaml = [
        `# Auto-generated by: eddgate analyze --generate-rules`,
        `# Cluster: ${cluster.id} -- ${cluster.description}`,
        `# Context: ${rule.context}`,
        `# Suggested fix: ${cluster.fix}`,
        ``,
        `type: "${rule.type}"`,
        `spec:`,
        ...Object.entries(rule.spec).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`),
        `message: "${rule.message}"`,
      ].join("\n");

      await writeFile(filepath, yaml, "utf-8");
      console.log(chalk.green(`  Generated: ${filepath}`));
      count++;
    }
  }

  console.log(chalk.bold(`\n  ${count} rule(s) generated in ${dir}\n`));
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 30);
}

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

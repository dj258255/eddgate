import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import {
  loadWorkflow,
  loadProjectConfig,
  loadPrompt,
} from "../../config/loader.js";
import { interactiveSetup } from "../interactive-setup.js";
import { executeWorkflow } from "../../core/workflow-engine.js";
import {
  TraceEmitter,
  createStdoutListener,
  createJsonlListener,
} from "../../trace/emitter.js";
import { renderHTMLReport } from "../../render/html-report.js";
import { renderTUI } from "../../render/tui-report.js";
import type { WorkflowResult } from "../../types/index.js";

interface RunOptions {
  input?: string;
  model?: string;
  config: string;
  workflowsDir: string;
  rolesDir: string;
  promptsDir: string;
  output?: string;
  report?: string;
  tui?: boolean;
  traceJsonl?: string;
  maxBudgetUsd?: number;
  interactive?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

export async function runCommand(
  workflowName: string,
  options: RunOptions,
): Promise<void> {
  try {
    // 워크플로우 로드
    const workflowPath = resolve(
      options.workflowsDir,
      `${workflowName}.yaml`,
    );
    console.log(chalk.dim(`워크플로우 로드: ${workflowPath}`));
    const workflow = await loadWorkflow(workflowPath);

    // Interactive setup
    if (options.interactive && !options.dryRun) {
      const setup = await interactiveSetup(
        workflow.name,
        workflow.steps.length,
      );
      if (!setup.confirmed) {
        console.log(chalk.dim("\nCancelled."));
        return;
      }
      workflow.config.defaultModel = setup.model;
      if (setup.maxBudgetUsd) options.maxBudgetUsd = setup.maxBudgetUsd;
      if (setup.outputReport) options.report = setup.outputReport;
      if (setup.traceJsonl) options.traceJsonl = setup.traceJsonl;
    }

    // CLI --model 오버라이드 (interactive보다 우선)
    if (options.model && !options.interactive) {
      workflow.config.defaultModel = options.model;
    }

    // 프로젝트 설정 로드 (선택적)
    let projectConfig;
    try {
      projectConfig = await loadProjectConfig(resolve(options.config));
    } catch {
      console.log(chalk.dim("프로젝트 설정 없음 — 기본값 사용"));
    }

    // Dry run (입력 불필요)
    if (options.dryRun) {
      printWorkflowStructure(workflow);
      return;
    }

    // 입력 읽기
    let input: string;
    if (options.input) {
      try {
        input = await readFile(resolve(options.input), "utf-8");
      } catch {
        input = options.input; // 파일이 아니면 텍스트로 취급
      }
    } else {
      // stdin에서 읽기
      input = await readStdin();
    }

    if (!input.trim()) {
      console.error(chalk.red("입력이 비어있습니다. --input 옵션 사용"));
      process.exit(1);
    }

    // 역할 프롬프트 로드
    const rolePrompts = new Map<string, string>();
    for (const step of workflow.steps) {
      const role = step.context.identity.role;
      if (!rolePrompts.has(role)) {
        try {
          const promptPath = join(
            resolve(options.promptsDir),
            `${role}.md`,
          );
          const prompt = await loadPrompt(promptPath);
          rolePrompts.set(role, prompt);
        } catch {
          // 프롬프트 파일 없으면 무시 — 제약조건만으로 실행
        }
      }
    }

    // 트레이서 설정
    const tracer = new TraceEmitter();
    if (!options.quiet && !options.json) {
      tracer.onEvent(createStdoutListener());
    }

    if (options.traceJsonl) {
      const tracePath = resolve(options.traceJsonl);
      tracer.onEvent(
        createJsonlListener((line) => {
          appendFile(tracePath, line + "\n").catch(() => {});
        }),
      );
    }

    // Config-driven trace outputs (Langfuse, OTel)
    if (projectConfig?.trace?.outputs) {
      for (const output of projectConfig.trace.outputs) {
        if (output.type === "langfuse") {
          const { createLangfuseListener } = await import(
            "../../trace/outputs/langfuse.js"
          );
          tracer.onEvent(createLangfuseListener(output.config as Record<string, string>));
        } else if (output.type === "otel") {
          const { createOtelListener } = await import(
            "../../trace/outputs/otel.js"
          );
          tracer.onEvent(createOtelListener(output.config as Record<string, string>));
        }
      }
    }

    // 실행
    if (!options.quiet && !options.json) {
      console.log(
        chalk.bold(`\n${workflow.name}`),
        chalk.dim(`(${workflow.steps.length} steps, ${workflow.config.topology})`),
      );
      console.log(chalk.dim(`  model: ${workflow.config.defaultModel}`));
      if (options.maxBudgetUsd) {
        console.log(chalk.dim(`  budget: $${options.maxBudgetUsd}`));
      }
      console.log();
    }

    const result = await executeWorkflow({
      workflow,
      input,
      rolePrompts,
      tracer,
      maxBudgetUsd: options.maxBudgetUsd,
    });

    // 결과 출력
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!options.quiet) {
      printResult(result);
    }

    // 결과 저장
    if (options.output) {
      const lastSuccessful = result.steps
        .filter((s) => s.status === "success" || s.status === "flagged")
        .pop();

      if (lastSuccessful?.output) {
        const outputStr =
          typeof lastSuccessful.output === "string"
            ? lastSuccessful.output
            : JSON.stringify(lastSuccessful.output, null, 2);
        await writeFile(resolve(options.output), outputStr, "utf-8");
        console.log(chalk.dim(`\n결과 저장: ${options.output}`));
      }
    }

    // HTML 리포트 생성
    if (options.report) {
      const html = renderHTMLReport(result);
      await writeFile(resolve(options.report), html, "utf-8");
      console.log(chalk.dim(`\n리포트 저장: ${options.report}`));
    }

    // TUI 대시보드
    if (options.tui) {
      await renderTUI(result);
    }

    // 실패 시 exit code 1
    if (result.status === "failed") {
      process.exit(1);
    }
  } catch (err) {
    console.error(
      chalk.red(
        `오류: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    process.exit(1);
  }
}

function printWorkflowStructure(workflow: { name: string; description: string; config: { defaultModel: string; topology: string; onValidationFail: string }; steps: Array<{ id: string; name: string; type: string; dependsOn?: string[]; validation?: { rules: unknown[] }; evaluation?: { enabled: boolean; type: string } }> }): void {
  console.log(chalk.bold(`\n${workflow.name}`));
  console.log(chalk.dim(workflow.description));
  console.log(chalk.dim(`  모델: ${workflow.config.defaultModel}`));
  console.log(chalk.dim(`  토폴로지: ${workflow.config.topology}`));
  console.log();

  for (const step of workflow.steps) {
    const deps = step.dependsOn?.join(", ") ?? "없음";
    const hasRules = step.validation?.rules.length
      ? chalk.green(" [T1:규칙]")
      : "";
    const hasEval = step.evaluation?.enabled
      ? chalk.yellow(` [T2:${step.evaluation.type}]`)
      : "";

    console.log(
      `  ${chalk.cyan(step.id)} — ${step.name} (${step.type})${hasRules}${hasEval}`,
    );
    console.log(chalk.dim(`    의존: ${deps}`));
  }
}

function printResult(result: WorkflowResult): void {
  console.log(chalk.bold("\n─── 실행 결과 ───"));

  const statusIcon =
    result.status === "success"
      ? chalk.green("✓ SUCCESS")
      : result.status === "partial"
        ? chalk.yellow("⚠ PARTIAL")
        : chalk.red("✗ FAILED");

  console.log(`상태: ${statusIcon}`);
  console.log(
    `시간: ${(result.totalDurationMs / 1000).toFixed(1)}s`,
  );
  console.log(
    `토큰: ${result.totalTokens.input.toLocaleString()} input + ${result.totalTokens.output.toLocaleString()} output`,
  );
  console.log(
    `비용 추정: $${result.totalCostEstimate.toFixed(4)}`,
  );
  console.log(`트레이스 ID: ${result.traceId}`);

  console.log(chalk.dim("\n단계별:"));
  for (const step of result.steps) {
    const icon =
      step.status === "success"
        ? chalk.green("✓")
        : step.status === "flagged"
          ? chalk.yellow("⚠")
          : step.status === "skipped"
            ? chalk.dim("○")
            : chalk.red("✗");

    console.log(
      `  ${icon} ${step.stepId} — ${step.status} (${(step.durationMs / 1000).toFixed(1)}s, ${(step.tokenUsage.input + step.tokenUsage.output).toLocaleString()} tokens)`,
    );

    if (step.validation && !step.validation.passed) {
      for (const f of step.validation.failures) {
        console.log(chalk.red(`    ↳ ${f.rule.message}`));
      }
    }

    if (step.evaluation && !step.evaluation.passed) {
      console.log(
        chalk.yellow(
          `    ↳ 평가 점수: ${step.evaluation.score.toFixed(2)} (기준 미달)`,
        ),
      );
    }
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

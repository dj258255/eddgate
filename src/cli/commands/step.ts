import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import { loadWorkflow, loadPrompt } from "../../config/loader.js";
import { buildContext } from "../../core/context-builder.js";
import { runAgent } from "../../core/agent-runner.js";
import { validateOutput } from "../../eval/tier1-rules.js";
import {
  TraceEmitter,
  createStdoutListener,
} from "../../trace/emitter.js";

interface StepOptions {
  input?: string;
  workflowsDir: string;
  promptsDir: string;
}

export async function stepCommand(
  workflowName: string,
  stepId: string,
  options: StepOptions,
): Promise<void> {
  try {
    const workflowPath = resolve(
      options.workflowsDir,
      `${workflowName}.yaml`,
    );
    const workflow = await loadWorkflow(workflowPath);

    const step = workflow.steps.find((s) => s.id === stepId);
    if (!step) {
      const ids = workflow.steps.map((s) => s.id).join(", ");
      console.error(
        chalk.red(`단계 '${stepId}'를 찾을 수 없습니다. 가능한 단계: ${ids}`),
      );
      process.exit(1);
    }

    // 입력 읽기
    let input: string;
    if (options.input) {
      try {
        input = await readFile(resolve(options.input), "utf-8");
      } catch {
        input = options.input;
      }
    } else {
      console.error(chalk.red("--input 필수"));
      process.exit(1);
      return;
    }

    // 역할 프롬프트 로드
    let rolePrompt: string | undefined;
    try {
      const promptPath = resolve(
        options.promptsDir,
        `${step.context.identity.role}.md`,
      );
      rolePrompt = await loadPrompt(promptPath);
    } catch {
      // 없으면 무시
    }

    const tracer = new TraceEmitter();
    tracer.onEvent(createStdoutListener());

    const context = buildContext(step, new Map(), workflow.config.defaultModel);

    console.log(
      chalk.bold(`\n-- 단일 단계 실행: ${step.name} (${step.id}) --\n`),
    );

    const agentOutput = await runAgent({
      stepId: step.id,
      context,
      input,
      rolePrompt,
      tracer,
    });

    // Tier 1 검증
    if (step.validation?.rules.length) {
      let output: unknown = agentOutput.text;
      const stripped = stripCodeBlock(agentOutput.text);
      try {
        output = JSON.parse(stripped);
      } catch {
        output = stripped || agentOutput.text;
      }

      const result = validateOutput(output, step.validation.rules);
      if (result.passed) {
        console.log(chalk.green("\nTier 1 검증: PASS"));
      } else {
        console.log(chalk.red("\nTier 1 검증: FAIL"));
        for (const f of result.failures) {
          console.log(chalk.red(`  - ${f.rule.message}`));
        }
      }
    }

    console.log(chalk.dim("\n-- 출력 --\n"));
    console.log(agentOutput.text);
    console.log(
      chalk.dim(
        `\n(${agentOutput.inputTokens} input + ${agentOutput.outputTokens} output, ${(agentOutput.latencyMs / 1000).toFixed(1)}s)`,
      ),
    );
  } catch (err) {
    console.error(
      chalk.red(`오류: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }
}

function stripCodeBlock(text: string): string {
  const match = text.match(/```(?:\w+)?\s*\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : text.trim();
}

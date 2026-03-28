import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import { loadWorkflow } from "../../config/loader.js";
import { runEvaluation } from "../../core/agent-runner.js";
import { TraceEmitter } from "../../trace/emitter.js";
import type { TraceEvent } from "../../types/index.js";

interface EvalOptions {
  dataset?: string;
  output?: string;
  workflowsDir: string;
  model: string;
}

export async function evalCommand(
  workflowName: string,
  options: EvalOptions,
): Promise<void> {
  try {
    // 워크플로우 로드 (평가 기준 참조)
    const workflowPath = resolve(
      options.workflowsDir,
      `${workflowName}.yaml`,
    );
    const workflow = await loadWorkflow(workflowPath);

    // 트레이스 파일 로드
    const traceDir = resolve(options.dataset ?? "./traces");
    const files = await readdir(traceDir).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) {
      console.error(chalk.red(`트레이스 파일 없음: ${traceDir}`));
      process.exit(1);
    }

    console.log(
      chalk.bold(`\n오프라인 평가: ${workflow.name}`),
    );
    console.log(chalk.dim(`트레이스: ${jsonlFiles.length}개 파일\n`));

    const results: EvalResult[] = [];

    for (const file of jsonlFiles) {
      const content = await readFile(join(traceDir, file), "utf-8");
      const events = parseJsonl(content);

      // step_end 이벤트에서 출력 추출
      const stepEnds = events.filter(
        (e) => e.type === "step_end" && e.stepId !== "__workflow__",
      );

      for (const stepEnd of stepEnds) {
        const step = workflow.steps.find((s) => s.id === stepEnd.stepId);
        if (!step?.evaluation?.enabled) continue;

        const output = stepEnd.data.output;
        if (!output) continue;

        console.log(
          chalk.dim(
            `  평가 중: ${file} / ${stepEnd.stepId} (${step.evaluation.type})...`,
          ),
        );

        const tracer = new TraceEmitter();
        const evalResult = await runEvaluation({
          stepId: stepEnd.stepId,
          output: String(output),
          evalType: step.evaluation.type,
          rubric: step.evaluation.rubric,
          model: options.model,
          tracer,
        });

        const passed = evalResult.score >= (step.evaluation.threshold ?? 0.7);

        results.push({
          file,
          stepId: stepEnd.stepId,
          evalType: step.evaluation.type,
          score: evalResult.score,
          threshold: step.evaluation.threshold ?? 0.7,
          passed,
          reasoning: evalResult.reasoning,
        });

        const icon = passed ? chalk.green("PASS") : chalk.red("FAIL");
        console.log(
          `  ${icon} ${stepEnd.stepId}: ${evalResult.score.toFixed(2)} (threshold: ${step.evaluation.threshold})`,
        );
      }
    }

    // 요약
    console.log(chalk.bold("\n-- 평가 요약 --\n"));

    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const avgScore =
      total > 0 ? results.reduce((s, r) => s + r.score, 0) / total : 0;

    console.log(`총 평가: ${total}`);
    console.log(chalk.green(`통과: ${passed}`));
    if (failed > 0) console.log(chalk.red(`실패: ${failed}`));
    console.log(`평균 점수: ${avgScore.toFixed(2)}`);

    // 결과 저장
    if (options.output) {
      const outputPath = resolve(options.output);
      await writeFile(outputPath, JSON.stringify(results, null, 2), "utf-8");
      console.log(chalk.dim(`\n결과 저장: ${outputPath}`));
    }

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error(
      chalk.red(`오류: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }
}

interface EvalResult {
  file: string;
  stepId: string;
  evalType: string;
  score: number;
  threshold: number;
  passed: boolean;
  reasoning: string;
}

function parseJsonl(content: string): TraceEvent[] {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as TraceEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is TraceEvent => e !== null);
}

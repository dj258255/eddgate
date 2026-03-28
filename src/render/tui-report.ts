import chalk from "chalk";
import type { WorkflowResult, StepResult } from "../types/index.js";
import { createInterface } from "node:readline";

/**
 * TUI Report Renderer
 *
 * 실행 완료 후 인터랙티브 터미널 대시보드.
 * 화살표 키로 단계 이동, Enter로 상세 보기.
 * 외부 의존성 0 — Node.js readline만 사용.
 */
export async function renderTUI(result: WorkflowResult): Promise<void> {
  const steps = result.steps;
  let selectedIndex = 0;
  let showDetail = false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Raw mode로 키 입력 받기
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const render = () => {
    // 화면 클리어
    process.stdout.write("\x1B[2J\x1B[H");

    // 헤더
    const statusIcon =
      result.status === "success"
        ? chalk.green("✓ SUCCESS")
        : result.status === "partial"
          ? chalk.yellow("⚠ PARTIAL")
          : chalk.red("✗ FAILED");

    console.log(chalk.bold(`  eddgate TUI — ${result.workflowName}`));
    console.log(
      `  ${statusIcon}  ${chalk.dim(`${(result.totalDurationMs / 1000).toFixed(1)}s · ${(result.totalTokens.input + result.totalTokens.output).toLocaleString()} tok · $${result.totalCostEstimate.toFixed(4)}`)}`,
    );
    console.log(chalk.dim(`  Trace: ${result.traceId.slice(0, 8)}...`));
    console.log();

    if (showDetail && steps[selectedIndex]) {
      // 상세 뷰
      renderStepDetail(steps[selectedIndex]);
      console.log(
        chalk.dim("\n  ← Esc: 목록으로  ↑↓: 이동  q: 종료"),
      );
    } else {
      // 목록 뷰
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const selected = i === selectedIndex;
        const cursor = selected ? chalk.cyan("▸") : " ";
        const bg = selected ? chalk.bgGray : (s: string) => s;
        const icon = stepIcon(step.status);
        const tokens = step.tokenUsage.input + step.tokenUsage.output;

        const evalBadge =
          step.evaluation
            ? step.evaluation.passed
              ? chalk.green(` [${step.evaluation.score.toFixed(2)}]`)
              : chalk.red(` [${step.evaluation.score.toFixed(2)}]`)
            : "";

        const line = `${cursor} ${icon} Step ${i + 1}: ${step.stepId}${evalBadge}`;
        const meta = `${(step.durationMs / 1000).toFixed(1)}s · ${tokens.toLocaleString()} tok`;
        const badge = statusBadge(step.status);

        const padding = Math.max(
          2,
          (process.stdout.columns || 80) - stripAnsi(line).length - stripAnsi(meta).length - stripAnsi(badge).length - 4,
        );

        console.log(bg(`  ${line}${" ".repeat(padding)}${chalk.dim(meta)} ${badge}`));
      }

      console.log(
        chalk.dim("\n  ↑↓: 이동  Enter: 상세  q: 종료"),
      );
    }
  };

  render();

  return new Promise<void>((resolve) => {
    process.stdin.on("data", (key: Buffer) => {
      const k = key.toString();

      if (k === "q" || k === "\x03") {
        // q 또는 Ctrl+C
        cleanup();
        resolve();
        return;
      }

      if (showDetail) {
        if (k === "\x1B" || k === "\x1B[D") {
          // Esc 또는 ←
          showDetail = false;
          render();
        } else if (k === "\x1B[A" && selectedIndex > 0) {
          selectedIndex--;
          render();
        } else if (k === "\x1B[B" && selectedIndex < steps.length - 1) {
          selectedIndex++;
          render();
        }
      } else {
        if (k === "\x1B[A" && selectedIndex > 0) {
          // ↑
          selectedIndex--;
          render();
        } else if (k === "\x1B[B" && selectedIndex < steps.length - 1) {
          // ↓
          selectedIndex++;
          render();
        } else if (k === "\r" || k === "\x1B[C") {
          // Enter 또는 →
          showDetail = true;
          render();
        }
      }
    });
  });

  function cleanup() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    rl.close();
    process.stdout.write("\x1B[2J\x1B[H"); // 화면 클리어
  }
}

// ─── Step Detail ─────────────────────────────────────────────

function renderStepDetail(step: StepResult): void {
  const icon = stepIcon(step.status);
  const badge = statusBadge(step.status);

  console.log(chalk.bold(`  ${icon} ${step.stepId} ${badge}`));
  console.log();

  // 토큰/시간
  console.log(
    `  ${chalk.dim("Input:")}  ${step.tokenUsage.input.toLocaleString()} tokens`,
  );
  console.log(
    `  ${chalk.dim("Output:")} ${step.tokenUsage.output.toLocaleString()} tokens`,
  );
  console.log(
    `  ${chalk.dim("시간:")}   ${(step.durationMs / 1000).toFixed(1)}s`,
  );

  // 검증 결과
  if (step.validation) {
    console.log();
    if (step.validation.passed) {
      console.log(`  ${chalk.green("✓ Tier 1 검증 통과")}`);
    } else {
      console.log(`  ${chalk.red("✗ Tier 1 검증 실패:")}`);
      for (const f of step.validation.failures) {
        console.log(chalk.red(`    - ${f.rule.message}`));
      }
    }
  }

  // 평가 결과
  if (step.evaluation) {
    console.log();
    const bar = renderBar(step.evaluation.score, 30);
    const scoreLabel = step.evaluation.passed
      ? chalk.green(step.evaluation.score.toFixed(2))
      : chalk.red(step.evaluation.score.toFixed(2));

    console.log(`  ${chalk.dim("Tier 2 평가:")} ${scoreLabel} ${bar}`);
    if (step.evaluation.reasoning) {
      const reasonLines = step.evaluation.reasoning.split("\n").slice(0, 3);
      for (const line of reasonLines) {
        console.log(chalk.dim(`    ${line.slice(0, 70)}`));
      }
    }
  }

  // 출력 미리보기
  if (step.output) {
    console.log();
    console.log(chalk.dim("  ── 출력 미리보기 ──"));
    const text =
      typeof step.output === "string"
        ? step.output
        : JSON.stringify(step.output, null, 2);
    const lines = text.split("\n").slice(0, 15);
    for (const line of lines) {
      console.log(`  ${chalk.dim(line.slice(0, (process.stdout.columns || 80) - 4))}`);
    }
    if (text.split("\n").length > 15) {
      console.log(chalk.dim(`  ... (${text.split("\n").length - 15} lines more)`));
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function stepIcon(status: StepResult["status"]): string {
  switch (status) {
    case "success": return chalk.green("✓");
    case "flagged": return chalk.yellow("⚠");
    case "failed": return chalk.red("✗");
    case "skipped": return chalk.dim("○");
    default: return "?";
  }
}

function statusBadge(status: StepResult["status"]): string {
  switch (status) {
    case "success": return chalk.black.bgGreen(` ${status} `);
    case "flagged": return chalk.black.bgYellow(` ${status} `);
    case "failed": return chalk.white.bgRed(` ${status} `);
    case "skipped": return chalk.dim(` ${status} `);
    default: return status;
  }
}

function renderBar(value: number, width: number): string {
  const filled = Math.round(value * width);
  const empty = width - filled;
  const color = value >= 0.7 ? chalk.green : value >= 0.4 ? chalk.yellow : chalk.red;
  return color("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[\d+m/g, "").replace(/\x1B\[[\d;]*m/g, "");
}

import { createInterface } from "node:readline";
import { readdir } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import chalk from "chalk";

export interface LaunchResult {
  workflow: string;
  input: string;
  model: string;
  effort: string;
  maxBudgetUsd?: number;
  report?: string;
  traceJsonl?: string;
  workflowsDir: string;
  promptsDir: string;
  cancelled: boolean;
}

type Lang = "ko" | "en";

const i18n: Record<Lang, Record<string, string>> = {
  ko: {
    title: "eddgate",
    subtitle: "평가 게이트 워크플로우 엔진",
    langSelect: "  언어 / Language:",
    workflow: "  워크플로우:",
    selectWorkflow: "\n  선택 [1]: ",
    input: "  입력 (텍스트 또는 파일 경로): ",
    inputRequired: "  입력이 필요합니다.",
    model: "  모델:",
    selectModel: "\n  선택 [1]: ",
    effort: "  정밀도:",
    selectEffort: "\n  선택 [2]: ",
    budget: "  최대 예산 USD (건너뛰려면 엔터): ",
    reportPath: "  HTML 리포트 경로 (건너뛰려면 엔터): ",
    tracePath: "  JSONL 트레이스 경로 (건너뛰려면 엔터): ",
    summary: "  요약:",
    summaryWorkflow: "    워크플로우: ",
    summaryModel: "    모델:       ",
    summaryEffort: "    정밀도:     ",
    summaryBudget: "    예산:       $",
    summaryReport: "    리포트:     ",
    summaryTrace: "    트레이스:   ",
    confirm: "\n  실행? [Y/n]: ",
    noWorkflows: "  워크플로우가 없습니다. eddgate init을 실행하세요.",
    cancelled: "\n  취소됨.",
    modelSonnet: "균형 (기본)",
    modelOpus: "최고 성능, 느림",
    modelHaiku: "빠르고 저렴",
    effortLow: "빠르게",
    effortMedium: "표준 (기본)",
    effortHigh: "꼼꼼하게",
    effortMax: "최대 품질",
  },
  en: {
    title: "eddgate",
    subtitle: "Evaluation-gated workflow engine",
    langSelect: "  Language:",
    workflow: "  Workflow:",
    selectWorkflow: "\n  Select [1]: ",
    input: "  Input (text or file path): ",
    inputRequired: "  Input required.",
    model: "  Model:",
    selectModel: "\n  Select [1]: ",
    effort: "  Effort:",
    selectEffort: "\n  Select [2]: ",
    budget: "  Max budget USD (enter to skip): ",
    reportPath: "  HTML report path (enter to skip): ",
    tracePath: "  JSONL trace path (enter to skip): ",
    summary: "  Summary:",
    summaryWorkflow: "    Workflow: ",
    summaryModel: "    Model:    ",
    summaryEffort: "    Effort:   ",
    summaryBudget: "    Budget:   $",
    summaryReport: "    Report:   ",
    summaryTrace: "    Trace:    ",
    confirm: "\n  Run? [Y/n]: ",
    noWorkflows: "  No workflows found. Run: eddgate init",
    cancelled: "\n  Cancelled.",
    modelSonnet: "Balanced (default)",
    modelOpus: "Most capable, slower",
    modelHaiku: "Fast and cheap",
    effortLow: "Quick",
    effortMedium: "Standard (default)",
    effortHigh: "Thorough",
    effortMax: "Maximum quality",
  },
};

export async function tuilauncher(): Promise<LaunchResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, res));

  const cancelled = (): LaunchResult => ({
    workflow: "", input: "", model: "sonnet", effort: "medium",
    workflowsDir: ".", promptsDir: ".", cancelled: true,
  });

  console.log(chalk.bold("\n  eddgate\n"));

  // Language
  console.log("  1) 한국어");
  console.log("  2) English");
  const langChoice = await ask("\n  Select [1]: ");
  const lang: Lang = langChoice.trim() === "2" ? "en" : "ko";
  const t = i18n[lang];
  console.log();

  console.log(chalk.dim(`  ${t.subtitle}\n`));

  // Find workflows
  const workflowsDir = resolve("./workflows");
  const templateDir = resolve("./templates/workflows");
  let wfDir = workflowsDir;
  let workflows = await findWorkflows(workflowsDir);

  if (workflows.length === 0) {
    workflows = await findWorkflows(templateDir);
    wfDir = templateDir;
  }

  if (workflows.length === 0) {
    console.log(chalk.red(t.noWorkflows));
    rl.close();
    return cancelled();
  }

  // Workflow
  console.log(chalk.bold(t.workflow));
  workflows.forEach((wf, i) => {
    console.log(`    ${chalk.cyan(String(i + 1))}) ${wf}`);
  });
  const wfChoice = await ask(t.selectWorkflow);
  const wfIndex = parseInt(wfChoice.trim() || "1") - 1;
  const selectedWf = workflows[Math.max(0, Math.min(wfIndex, workflows.length - 1))];
  console.log(chalk.dim(`  -> ${selectedWf}\n`));

  // Input
  const inputText = await ask(t.input);
  if (!inputText.trim()) {
    console.log(chalk.red(t.inputRequired));
    rl.close();
    return cancelled();
  }
  console.log();

  // Model
  const models = [
    { key: "1", name: "sonnet", desc: t.modelSonnet },
    { key: "2", name: "opus", desc: t.modelOpus },
    { key: "3", name: "haiku", desc: t.modelHaiku },
  ];
  console.log(chalk.bold(t.model));
  models.forEach((m) => console.log(`    ${chalk.cyan(m.key)}) ${m.name} -- ${chalk.dim(m.desc)}`));
  const modelChoice = await ask(t.selectModel);
  const model = models.find((m) => m.key === modelChoice.trim())?.name ?? "sonnet";
  console.log(chalk.dim(`  -> ${model}\n`));

  // Effort
  const efforts = [
    { key: "1", name: "low", desc: t.effortLow },
    { key: "2", name: "medium", desc: t.effortMedium },
    { key: "3", name: "high", desc: t.effortHigh },
    { key: "4", name: "max", desc: t.effortMax },
  ];
  console.log(chalk.bold(t.effort));
  efforts.forEach((e) => console.log(`    ${chalk.cyan(e.key)}) ${e.name} -- ${chalk.dim(e.desc)}`));
  const effortChoice = await ask(t.selectEffort);
  const effort = efforts.find((e) => e.key === effortChoice.trim())?.name ?? "medium";
  console.log(chalk.dim(`  -> ${effort}\n`));

  // Budget
  const budgetInput = await ask(t.budget);
  const maxBudgetUsd = budgetInput.trim() ? parseFloat(budgetInput) : undefined;

  // Report
  const reportInput = await ask(t.reportPath);
  const report = reportInput.trim() || undefined;

  // Trace
  const traceInput = await ask(t.tracePath);
  const traceJsonl = traceInput.trim() || undefined;

  // Summary
  console.log(chalk.bold(`\n${t.summary}`));
  console.log(`${t.summaryWorkflow}${selectedWf}`);
  console.log(`${t.summaryModel}${model}`);
  console.log(`${t.summaryEffort}${effort}`);
  if (maxBudgetUsd) console.log(`${t.summaryBudget}${maxBudgetUsd}`);
  if (report) console.log(`${t.summaryReport}${report}`);
  if (traceJsonl) console.log(`${t.summaryTrace}${traceJsonl}`);

  const confirm = await ask(t.confirm);
  const isCancelled = confirm.trim().toLowerCase() === "n";

  rl.close();

  if (isCancelled) {
    console.log(chalk.dim(t.cancelled));
    return cancelled();
  }

  // Prompts dir
  let promptsDir = resolve("./prompts");
  try { await readdir(promptsDir); } catch { promptsDir = resolve("./templates/prompts"); }

  return {
    workflow: selectedWf,
    input: inputText.trim(),
    model,
    effort,
    maxBudgetUsd,
    report,
    traceJsonl,
    workflowsDir: wfDir,
    promptsDir,
    cancelled: false,
  };
}

async function findWorkflows(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => extname(f) === ".yaml" || extname(f) === ".yml")
      .map((f) => basename(f, extname(f)));
  } catch {
    return [];
  }
}

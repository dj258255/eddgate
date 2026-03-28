import * as p from "@clack/prompts";
import { readdir } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import chalk from "chalk";
import { pickFile } from "./file-picker.js";
import { MODELS, EFFORTS, THINKING_OPTIONS } from "./models.js";

export interface LaunchResult {
  workflow: string;
  input: string;
  model: string;
  effort: string;
  thinking: string;
  maxBudgetUsd?: number;
  report?: string;
  traceJsonl?: string;
  workflowsDir: string;
  promptsDir: string;
  cancelled: boolean;
}

type Lang = "ko" | "en";

const t: Record<Lang, Record<string, string>> = {
  ko: {
    subtitle: "평가 게이트 워크플로우 엔진",
    workflow: "워크플로우를 선택하세요",
    input: "입력 (텍스트 또는 파일 경로)",
    model: "모델을 선택하세요",
    effort: "정밀도를 선택하세요",
    budget: "최대 예산 USD (건너뛰려면 엔터)",
    reportPath: "HTML 리포트 경로 (건너뛰려면 엔터)",
    tracePath: "JSONL 트레이스 경로 (건너뛰려면 엔터)",
    confirm: "실행하시겠습니까?",
    noWorkflows: "워크플로우가 없습니다. eddgate init을 실행하세요.",
    cancelled: "취소되었습니다.",
    running: "워크플로우 실행 중...",
    done: "완료!",
    sonnet: "균형 (기본)",
    opus: "최고 성능",
    haiku: "빠르고 저렴",
    low: "빠르게",
    medium: "표준 (기본)",
    high: "꼼꼼하게",
    max: "최대 품질",
  },
  en: {
    subtitle: "Evaluation-gated workflow engine",
    workflow: "Select a workflow",
    input: "Input (text or file path)",
    model: "Select a model",
    effort: "Select effort level",
    budget: "Max budget USD (enter to skip)",
    reportPath: "HTML report path (enter to skip)",
    tracePath: "JSONL trace path (enter to skip)",
    confirm: "Run this workflow?",
    noWorkflows: "No workflows found. Run: eddgate init",
    cancelled: "Cancelled.",
    running: "Running workflow...",
    done: "Done!",
    sonnet: "Balanced (default)",
    opus: "Most capable",
    haiku: "Fast and cheap",
    low: "Quick",
    medium: "Standard (default)",
    high: "Thorough",
    max: "Maximum quality",
  },
};

export async function tuilauncher(): Promise<LaunchResult> {
  const cancelled = (): LaunchResult => ({
    workflow: "", input: "", model: "sonnet", effort: "medium", thinking: "disabled",
    workflowsDir: ".", promptsDir: ".", cancelled: true,
  });

  p.intro(chalk.bold("eddgate"));

  // Language
  const lang = (await p.select({
    message: "Language",
    options: [
      { value: "ko", label: "한국어" },
      { value: "en", label: "English" },
    ],
  })) as Lang;

  if (p.isCancel(lang)) { p.cancel(t.en.cancelled); return cancelled(); }
  const l = t[lang];

  p.note(l.subtitle);

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
    p.cancel(l.noWorkflows);
    return cancelled();
  }

  // Workflow
  const workflow = await p.select({
    message: l.workflow,
    options: workflows.map((wf) => ({ value: wf, label: wf })),
  });
  if (p.isCancel(workflow)) { p.cancel(l.cancelled); return cancelled(); }

  // Input method
  const inputMethod = await p.select({
    message: lang === "ko" ? "입력 방식" : "Input method",
    options: [
      { value: "file", label: lang === "ko" ? "파일 선택" : "Select file" },
      { value: "text", label: lang === "ko" ? "직접 입력" : "Type text" },
    ],
  });
  if (p.isCancel(inputMethod)) { p.cancel(l.cancelled); return cancelled(); }

  let input: string | symbol;

  if (inputMethod === "file") {
    const filePath = await pickFile(".", lang);
    if (!filePath) { p.cancel(l.cancelled); return cancelled(); }
    input = filePath;
    p.log.info(`${lang === "ko" ? "선택됨" : "Selected"}: ${filePath}`);
  } else {
    input = await p.text({
      message: l.input,
      validate: (val) => (val?.trim() ? undefined : l.input),
    });
  }
  if (p.isCancel(input)) { p.cancel(l.cancelled); return cancelled(); }

  // Model
  const isKo = lang === "ko";
  const model = await p.select({
    message: l.model,
    options: MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      hint: isKo ? m.hintKo : m.hint,
    })),
  });
  if (p.isCancel(model)) { p.cancel(l.cancelled); return cancelled(); }

  // Effort
  const effort = await p.select({
    message: l.effort,
    options: EFFORTS.map((e) => ({
      value: e.value,
      label: e.label,
      hint: isKo ? e.hintKo : e.hint,
    })),
    initialValue: "medium",
  });
  if (p.isCancel(effort)) { p.cancel(l.cancelled); return cancelled(); }

  // Extended Thinking
  const thinking = await p.select({
    message: isKo ? "확장 사고" : "Extended thinking",
    options: THINKING_OPTIONS.map((t) => ({
      value: t.value,
      label: t.label,
      hint: isKo ? t.hintKo : t.hint,
    })),
    initialValue: "disabled",
  });
  if (p.isCancel(thinking)) { p.cancel(l.cancelled); return cancelled(); }

  // Optional settings
  const budget = await p.text({ message: l.budget, defaultValue: "" });
  if (p.isCancel(budget)) { p.cancel(l.cancelled); return cancelled(); }

  const report = await p.text({ message: l.reportPath, defaultValue: "" });
  if (p.isCancel(report)) { p.cancel(l.cancelled); return cancelled(); }

  const trace = await p.text({ message: l.tracePath, defaultValue: "" });
  if (p.isCancel(trace)) { p.cancel(l.cancelled); return cancelled(); }

  // Confirm
  const confirmed = await p.confirm({ message: l.confirm });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel(l.cancelled);
    return cancelled();
  }

  // Prompts dir
  let promptsDir = resolve("./prompts");
  try { await readdir(promptsDir); } catch { promptsDir = resolve("./templates/prompts"); }

  return {
    workflow: workflow as string,
    input: input as string,
    model: model as string,
    effort: effort as string,
    thinking: thinking as string,
    maxBudgetUsd: (budget as string).trim() ? parseFloat(budget as string) : undefined,
    report: (report as string).trim() || undefined,
    traceJsonl: (trace as string).trim() || undefined,
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

// findInputFiles removed -- replaced by file-picker.ts with folder navigation

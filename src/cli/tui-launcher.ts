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

export async function tuilauncher(): Promise<LaunchResult> {
  const cancelled = (): LaunchResult => ({
    workflow: "", input: "", model: "sonnet", effort: "medium", thinking: "disabled",
    workflowsDir: ".", promptsDir: ".", cancelled: true,
  });

  const { initLang, t: tr, getLang } = await import("../i18n/index.js");
  initLang();

  const lang = getLang();

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
    p.cancel(tr("run.noWorkflows"));
    return cancelled();
  }

  // Workflow
  const workflow = await p.select({
    message: tr("run.workflow"),
    options: workflows.map((wf) => ({ value: wf, label: wf })),
  });
  if (p.isCancel(workflow)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  // Input method
  const inputMethod = await p.select({
    message: tr("run.inputMethod"),
    options: [
      { value: "file", label: tr("run.selectFile") },
      { value: "text", label: tr("run.typeText") },
    ],
  });
  if (p.isCancel(inputMethod)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  let input: string | symbol;

  if (inputMethod === "file") {
    const filePath = await pickFile(".", lang);
    if (!filePath) { p.cancel(tr("run.cancelled")); return cancelled(); }
    input = filePath;
    p.log.info(`${tr("run.selected")}: ${filePath}`);
  } else {
    input = await p.text({
      message: tr("run.input"),
      validate: (val) => (val?.trim() ? undefined : tr("run.input")),
    });
  }
  if (p.isCancel(input)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  // Model
  const isKo = lang === "ko";
  const model = await p.select({
    message: tr("run.model"),
    options: MODELS.map((m) => ({
      value: m.value,
      label: m.label,
      hint: isKo ? m.hintKo : m.hint,
    })),
  });
  if (p.isCancel(model)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  // Effort
  const effort = await p.select({
    message: tr("run.effort"),
    options: EFFORTS.map((e) => ({
      value: e.value,
      label: e.label,
      hint: isKo ? e.hintKo : e.hint,
    })),
    initialValue: "medium",
  });
  if (p.isCancel(effort)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  // Extended Thinking
  const thinking = await p.select({
    message: tr("run.thinking"),
    options: THINKING_OPTIONS.map((t) => ({
      value: t.value,
      label: t.label,
      hint: isKo ? t.hintKo : t.hint,
    })),
    initialValue: "disabled",
  });
  if (p.isCancel(thinking)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  // Optional settings
  const budget = await p.text({ message: tr("run.budget"), defaultValue: "" });
  if (p.isCancel(budget)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  const report = await p.text({ message: tr("run.reportPath"), defaultValue: "" });
  if (p.isCancel(report)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  const trace = await p.text({ message: tr("run.tracePath"), defaultValue: "" });
  if (p.isCancel(trace)) { p.cancel(tr("run.cancelled")); return cancelled(); }

  // Confirm
  const confirmed = await p.confirm({ message: tr("run.confirm") });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel(tr("run.cancelled"));
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

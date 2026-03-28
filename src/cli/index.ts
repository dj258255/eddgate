#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";

const program = new Command();

program
  .name("eddops")
  .description(
    "EDDOps CLI — 평가가 내장된 멀티에이전트 워크플로우",
  )
  .version("0.1.0");

program
  .command("run <workflow>")
  .description("워크플로우 실행")
  .option("-i, --input <file>", "입력 파일 또는 텍스트")
  .option("-c, --config <path>", "프로젝트 설정 파일", "./eddops.config.yaml")
  .option("-w, --workflows-dir <path>", "워크플로우 디렉토리", "./workflows")
  .option("-r, --roles-dir <path>", "역할 디렉토리", "./roles")
  .option("-p, --prompts-dir <path>", "프롬프트 디렉토리", "./prompts")
  .option("-o, --output <path>", "결과 저장 경로")
  .option("--report <path>", "HTML 리포트 저장 경로")
  .option("--trace-jsonl <path>", "JSONL 트레이스 저장 경로")
  .option("--tui", "실행 완료 후 인터랙티브 TUI 대시보드 표시")
  .option("--dry-run", "실행하지 않고 워크플로우 구조만 출력")
  .action(runCommand);

program
  .command("list <type>")
  .description("워크플로우/역할 목록 (type: workflows | roles)")
  .option("-d, --dir <path>", "검색 디렉토리")
  .action(listCommand);

program.parse();

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve("dist/cli/index.js");
const WORKFLOWS = resolve("templates/workflows");

function run(args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    encoding: "utf-8",
    timeout: 10000,
    cwd: resolve("."),
  });
}

function runFail(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      cwd: resolve("."),
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? 1,
    };
  }
}

describe("CLI Integration", () => {
  it("shows help", () => {
    const out = run(["--help"]);
    expect(out).toContain("eddgate");
    expect(out).toContain("run");
    expect(out).toContain("step");
    expect(out).toContain("trace");
    expect(out).toContain("eval");
    expect(out).toContain("init");
    expect(out).toContain("doctor");
    expect(out).toContain("list");
  });

  it("shows version", () => {
    const out = run(["--version"]);
    expect(out.trim()).toBe("0.1.0");
  });

  it("lists workflows", () => {
    const out = run(["list", "workflows", "-d", WORKFLOWS]);
    expect(out).toContain("document-pipeline");
    expect(out).toContain("code-review");
    expect(out).toContain("bug-fix");
  });

  it("dry-run document-pipeline", () => {
    const out = run(["run", "document-pipeline", "--dry-run", "-w", WORKFLOWS]);
    expect(out).toContain("classify");
    expect(out).toContain("retrieve");
    expect(out).toContain("generate_citation");
    expect(out).toContain("validate_final");
    expect(out).toContain("T1");
    expect(out).toContain("T2");
  });

  it("dry-run code-review", () => {
    const out = run(["run", "code-review", "--dry-run", "-w", WORKFLOWS]);
    expect(out).toContain("analyze_diff");
    expect(out).toContain("detect_issues");
    expect(out).toContain("generate_report");
  });

  it("dry-run bug-fix", () => {
    const out = run(["run", "bug-fix", "--dry-run", "-w", WORKFLOWS]);
    expect(out).toContain("reproduce");
    expect(out).toContain("root_cause");
    expect(out).toContain("implement_fix");
    expect(out).toContain("verify_fix");
  });

  it("fails on missing workflow", () => {
    const result = runFail(["run", "nonexistent", "--dry-run", "-w", WORKFLOWS]);
    expect(result.status).not.toBe(0);
  });

  it("step command shows help", () => {
    const out = run(["step", "--help"]);
    expect(out).toContain("step-id");
    expect(out).toContain("--input");
  });

  it("trace command shows help", () => {
    const out = run(["trace", "--help"]);
    expect(out).toContain("trace-id-or-file");
    expect(out).toContain("--format");
  });

  it("eval command shows help", () => {
    const out = run(["eval", "--help"]);
    expect(out).toContain("--dataset");
    expect(out).toContain("--model");
  });

  it("run command has budget flag", () => {
    const out = run(["run", "--help"]);
    expect(out).toContain("--max-budget-usd");
    expect(out).toContain("--verbose");
    expect(out).toContain("--quiet");
    expect(out).toContain("--json");
  });
});

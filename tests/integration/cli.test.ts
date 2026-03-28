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

describe("CLI Core Commands", () => {
  it("shows help with core commands", () => {
    const out = run(["--help"]);
    expect(out).toContain("eddgate");
    expect(out).toContain("init");
    expect(out).toContain("doctor");
    expect(out).toContain("run");
    expect(out).toContain("list");
    expect(out).toContain("advanced");
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
    expect(out).toContain("api-design");
    expect(out).toContain("translation");
  });

  it("dry-run document-pipeline", () => {
    const out = run(["run", "document-pipeline", "--dry-run", "-w", WORKFLOWS]);
    expect(out).toContain("classify");
    expect(out).toContain("retrieve");
    expect(out).toContain("validate_final");
  });

  it("dry-run code-review", () => {
    const out = run(["run", "code-review", "--dry-run", "-w", WORKFLOWS]);
    expect(out).toContain("analyze_diff");
    expect(out).toContain("generate_report");
  });

  it("dry-run bug-fix", () => {
    const out = run(["run", "bug-fix", "--dry-run", "-w", WORKFLOWS]);
    expect(out).toContain("reproduce");
    expect(out).toContain("verify_fix");
  });

  it("fails on missing workflow", () => {
    const result = runFail(["run", "nonexistent", "--dry-run", "-w", WORKFLOWS]);
    expect(result.status).not.toBe(0);
  });

  it("run command has key flags", () => {
    const out = run(["run", "--help"]);
    expect(out).toContain("--max-budget-usd");
    expect(out).toContain("--quiet");
    expect(out).toContain("--json");
    expect(out).toContain("--report");
  });
});

describe("CLI Advanced Commands", () => {
  it("shows advanced help", () => {
    const out = run(["advanced", "--help"]);
    expect(out).toContain("step");
    expect(out).toContain("trace");
    expect(out).toContain("eval");
    expect(out).toContain("gate");
    expect(out).toContain("monitor");
    expect(out).toContain("viz");
  });

  it("advanced step shows help", () => {
    const out = run(["advanced", "step", "--help"]);
    expect(out).toContain("step-id");
  });

  it("advanced viz generates mermaid", () => {
    const out = run(["advanced", "viz", "document-pipeline", "-w", WORKFLOWS]);
    expect(out).toContain("mermaid");
    expect(out).toContain("classify");
  });
});

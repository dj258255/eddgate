import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { loadProjectConfig, loadAllWorkflows } from "../../config/loader.js";
import { validateWorkflowGraph } from "../../core/graph-validator.js";

interface DoctorOptions {
  config: string;
  workflowsDir: string;
}

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  console.log(chalk.bold("\neddgate doctor\n"));

  const checks: Check[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  checks.push({
    name: "Node.js",
    status: major >= 20 ? "pass" : "fail",
    message: `${nodeVersion} ${major >= 20 ? "" : "(requires >= 20)"}`,
  });

  // 2. Claude Code CLI
  try {
    const claudeVersion = execFileSync("claude", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    checks.push({
      name: "Claude Code CLI",
      status: "pass",
      message: claudeVersion || "installed",
    });
  } catch {
    checks.push({
      name: "Claude Code CLI",
      status: "fail",
      message: "not found. Install: npm install -g @anthropic-ai/claude-code",
    });
  }

  // 3. Config file
  const configPath = resolve(options.config);
  try {
    await loadProjectConfig(configPath);
    checks.push({
      name: "Config",
      status: "pass",
      message: configPath,
    });
  } catch (err) {
    const configExists = await fileExists(configPath);
    checks.push({
      name: "Config",
      status: configExists ? "fail" : "warn",
      message: configExists
        ? `invalid: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`
        : `not found: ${configPath} (run: eddgate init)`,
    });
  }

  // 4. Workflows
  const wfDir = resolve(options.workflowsDir);
  try {
    const workflows = await loadAllWorkflows(wfDir);
    if (workflows.size === 0) {
      checks.push({
        name: "Workflows",
        status: "warn",
        message: `no workflows found in ${wfDir}`,
      });
    } else {
      checks.push({
        name: "Workflows",
        status: "pass",
        message: `${workflows.size} workflow(s) found`,
      });

      for (const [name, wf] of workflows) {
        const errors = validateWorkflowGraph(wf);
        if (errors.length > 0) {
          for (const error of errors) {
            checks.push({
              name: `  ${name}`,
              status: "fail",
              message: error,
            });
          }
        } else {
          checks.push({
            name: `  ${name}`,
            status: "pass",
            message: `${wf.steps.length} steps, valid graph`,
          });
        }
      }
    }
  } catch {
    checks.push({
      name: "Workflows",
      status: "warn",
      message: `directory not found: ${wfDir}`,
    });
  }

  // Print results
  let hasFailure = false;
  for (const check of checks) {
    const icon =
      check.status === "pass"
        ? chalk.green("PASS")
        : check.status === "warn"
          ? chalk.yellow("WARN")
          : chalk.red("FAIL");

    console.log(`  ${icon}  ${check.name}: ${check.message}`);
    if (check.status === "fail") hasFailure = true;
  }

  console.log();
  if (hasFailure) {
    console.log(chalk.red("Some checks failed. Fix the issues above."));
    process.exit(1);
  } else {
    console.log(chalk.green("All checks passed."));
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

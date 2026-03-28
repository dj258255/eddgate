import { resolve } from "node:path";
import chalk from "chalk";
import { loadWorkflow } from "../../config/loader.js";

interface VizOptions {
  workflowsDir: string;
  format: string;
}

export async function vizCommand(
  workflowName: string,
  options: VizOptions,
): Promise<void> {
  try {
    const workflowPath = resolve(
      options.workflowsDir,
      `${workflowName}.yaml`,
    );
    const workflow = await loadWorkflow(workflowPath);

    if (options.format === "mermaid") {
      console.log(generateMermaid(workflow));
    } else {
      console.log(generateAscii(workflow));
    }
  } catch (err) {
    console.error(
      chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  }
}

function generateMermaid(workflow: {
  name: string;
  steps: Array<{
    id: string;
    name: string;
    type: string;
    dependsOn?: string[];
    validation?: { rules: unknown[] };
    evaluation?: { enabled: boolean; type: string };
  }>;
}): string {
  const lines: string[] = [];
  lines.push("```mermaid");
  lines.push("graph TD");
  lines.push(`  title["${workflow.name}"]`);
  lines.push("");

  for (const step of workflow.steps) {
    const hasT1 = step.validation?.rules?.length ? " [T1]" : "";
    const hasT2 =
      step.evaluation?.enabled ? ` [T2:${step.evaluation.type}]` : "";
    const label = `${step.name}${hasT1}${hasT2}`;

    // Node shape based on type
    switch (step.type) {
      case "classify":
        lines.push(`  ${step.id}{{"${label}"}}`);
        break;
      case "retrieve":
        lines.push(`  ${step.id}[("${label}")]`);
        break;
      case "validate":
      case "human_approval":
        lines.push(`  ${step.id}{"${label}"}`);
        break;
      default:
        lines.push(`  ${step.id}["${label}"]`);
    }

    // Edges
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        const edgeLabel =
          step.evaluation?.enabled ? `|eval: ${step.evaluation.type}|` : "";
        lines.push(`  ${dep} -->${edgeLabel} ${step.id}`);
      }
    }
  }

  // Styling
  lines.push("");
  lines.push("  classDef classify fill:#1a3a5c,stroke:#58a6ff,color:#e6edf3");
  lines.push("  classDef retrieve fill:#1a3a2a,stroke:#3fb950,color:#e6edf3");
  lines.push("  classDef generate fill:#161b22,stroke:#7d8590,color:#e6edf3");
  lines.push("  classDef validate fill:#3a2a1a,stroke:#d29922,color:#e6edf3");

  for (const step of workflow.steps) {
    lines.push(`  class ${step.id} ${step.type}`);
  }

  lines.push("```");
  return lines.join("\n");
}

function generateAscii(workflow: {
  name: string;
  steps: Array<{
    id: string;
    name: string;
    type: string;
    dependsOn?: string[];
    validation?: { rules: unknown[] };
    evaluation?: { enabled: boolean; type: string };
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`  ${workflow.name}`);
  lines.push(`  ${"=".repeat(workflow.name.length)}`);
  lines.push("");

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const hasT1 = step.validation?.rules?.length ? " [T1]" : "";
    const hasT2 =
      step.evaluation?.enabled ? ` [T2:${step.evaluation.type}]` : "";

    const box = `[ ${step.name}${hasT1}${hasT2} ]`;
    lines.push(`  ${box}`);

    if (i < workflow.steps.length - 1) {
      if (step.evaluation?.enabled) {
        lines.push(`    | (eval gate)`);
      }
      lines.push(`    v`);
    }
  }

  return lines.join("\n");
}

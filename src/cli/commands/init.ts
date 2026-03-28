import { writeFile, mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";

interface InitOptions {
  dir: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const root = resolve(options.dir);

  console.log(chalk.bold(`\neddgate init: ${root}\n`));

  const dirs = ["workflows", "prompts", "roles", "traces", "eval/rules", "eval/rubrics", "eval/datasets"];
  for (const dir of dirs) {
    const path = join(root, dir);
    await mkdir(path, { recursive: true });
    console.log(chalk.dim(`  mkdir ${dir}/`));
  }

  // eddgate.config.yaml
  const configPath = join(root, "eddgate.config.yaml");
  if (await exists(configPath)) {
    console.log(chalk.yellow(`  skip  eddgate.config.yaml (already exists)`));
  } else {
    await writeFile(configPath, CONFIG_TEMPLATE, "utf-8");
    console.log(`  create eddgate.config.yaml`);
  }

  // example workflow
  const wfPath = join(root, "workflows/example.yaml");
  if (await exists(wfPath)) {
    console.log(chalk.yellow(`  skip  workflows/example.yaml (already exists)`));
  } else {
    await writeFile(wfPath, WORKFLOW_TEMPLATE, "utf-8");
    console.log(`  create workflows/example.yaml`);
  }

  // example prompt
  const promptPath = join(root, "prompts/analyzer.md");
  if (await exists(promptPath)) {
    console.log(chalk.yellow(`  skip  prompts/analyzer.md (already exists)`));
  } else {
    await writeFile(promptPath, PROMPT_TEMPLATE, "utf-8");
    console.log(`  create prompts/analyzer.md`);
  }

  // .gitignore additions
  const giPath = join(root, ".gitignore");
  const giContent = await readSafe(giPath);
  if (!giContent.includes("traces/")) {
    await writeFile(
      giPath,
      giContent + (giContent ? "\n" : "") + "traces/*.jsonl\n",
      "utf-8",
    );
    console.log(`  update .gitignore`);
  }

  console.log(chalk.bold("\nDone. Next steps:"));
  console.log(`  eddgate doctor                           # check setup`);
  console.log(`  eddgate run example --input input.txt     # run example workflow`);
  console.log(`  eddgate run example --dry-run             # preview structure`);
  console.log();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readSafe(path: string): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

const CONFIG_TEMPLATE = `# eddgate configuration
model:
  default: "sonnet"

trace:
  outputs:
    - type: "stdout"
    - type: "jsonl"
      config:
        path: "./traces/"
`;

const WORKFLOW_TEMPLATE = `name: "Example Workflow"
description: "2-step example: analyze input, then generate output"

config:
  defaultModel: "sonnet"
  topology: "pipeline"
  onValidationFail: "block"

steps:
  - id: "analyze"
    name: "Analyze Input"
    type: "classify"
    context:
      state: "classify"
      identity:
        role: "analyzer"
        constraints:
          - "Identify the key topics and requirements"
          - "Output as structured JSON with 'topics' array"
      tools: []
    validation:
      rules:
        - type: "length"
          spec: { min: 20 }
          message: "Analysis result too short"

  - id: "generate"
    name: "Generate Output"
    type: "generate"
    dependsOn: ["analyze"]
    context:
      state: "generate"
      identity:
        role: "generator"
        constraints:
          - "Generate a response based on the analysis"
          - "Be concise and actionable"
      tools: []
    validation:
      rules:
        - type: "length"
          spec: { min: 50 }
          message: "Output too short"
`;

const PROMPT_TEMPLATE = `You are an input analyzer.

## Task

Analyze the given input and identify:
1. Key topics and themes
2. Questions or requirements
3. Priority level (high/medium/low)

## Output Format

Respond in clear, structured format.
`;

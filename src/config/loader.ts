import { readFile, readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  workflowSchema,
  agentRoleSchema,
  projectConfigSchema,
  type WorkflowSchema,
  type AgentRoleSchema,
  type ProjectConfigSchema,
} from "./schemas.js";

export class ConfigLoadError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly issues: string[],
  ) {
    super(`Config validation failed for ${filePath}:\n${issues.join("\n")}`);
    this.name = "ConfigLoadError";
  }
}

async function loadYaml(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf-8");
  return parseYaml(raw);
}

function formatZodErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.map(
    (i) => `  - ${i.path.map(String).join(".")}: ${i.message}`,
  );
}

// ─── Public API ──────────────────────────────────────────────

export async function loadProjectConfig(
  configPath: string,
): Promise<ProjectConfigSchema> {
  const raw = await loadYaml(configPath);
  const result = projectConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigLoadError(configPath, formatZodErrors(result.error));
  }
  return result.data;
}

export async function loadWorkflow(
  filePath: string,
): Promise<WorkflowSchema> {
  const raw = await loadYaml(filePath);
  const result = workflowSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigLoadError(filePath, formatZodErrors(result.error));
  }
  return result.data;
}

export async function loadRole(
  filePath: string,
): Promise<AgentRoleSchema> {
  const raw = await loadYaml(filePath);
  const result = agentRoleSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigLoadError(filePath, formatZodErrors(result.error));
  }
  return result.data;
}

export async function loadAllWorkflows(
  dir: string,
): Promise<Map<string, WorkflowSchema>> {
  const map = new Map<string, WorkflowSchema>();
  const files = await readdir(dir).catch(() => []);
  for (const file of files) {
    if (extname(file) === ".yaml" || extname(file) === ".yml") {
      const wf = await loadWorkflow(join(dir, file));
      map.set(basename(file, extname(file)), wf);
    }
  }
  return map;
}

export async function loadAllRoles(
  dir: string,
): Promise<Map<string, AgentRoleSchema>> {
  const map = new Map<string, AgentRoleSchema>();
  const files = await readdir(dir).catch(() => []);
  for (const file of files) {
    if (extname(file) === ".yaml" || extname(file) === ".yml") {
      const role = await loadRole(join(dir, file));
      map.set(role.id, role);
    }
  }
  return map;
}

export async function loadPrompt(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

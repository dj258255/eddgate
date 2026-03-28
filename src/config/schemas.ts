import { z } from "zod";

// ─── Execution Context ───────────────────────────────────────

const stepStateSchema = z.enum([
  "classify",
  "retrieve",
  "generate",
  "validate",
  "transform",
  "human_approval",
]);

const identitySchema = z.object({
  role: z.string().min(1),
  model: z.string().optional(),
  constraints: z.array(z.string()).default([]),
});

const executionContextSchema = z.object({
  state: stepStateSchema,
  identity: identitySchema,
  tools: z.array(z.string()).default([]),
  memory: z
    .object({
      summary: z.string().max(500), // 100토큰 ≈ 400자 정도
      previousStepOutput: z.string().optional(),
    })
    .optional(),
});

// ─── Validation Rules (Tier 1) ───────────────────────────────

const validationRuleSchema = z.object({
  type: z.enum([
    "schema",
    "required_fields",
    "format",
    "length",
    "regex",
    "custom",
  ]),
  spec: z.record(z.string(), z.unknown()),
  message: z.string(),
});

// ─── LLM Evaluation (Tier 2) ─────────────────────────────────

const llmEvaluationSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(["groundedness", "relevance", "custom"]),
  threshold: z.number().min(0).max(1).default(0.7),
  onFail: z.enum(["block", "flag", "retry"]).default("flag"),
  maxRetries: z.number().int().min(1).max(5).default(2),
  model: z.string().optional(),
  rubric: z.string().optional(),
});

// ─── Step Definition ─────────────────────────────────────────

const stepDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: stepStateSchema,
  context: executionContextSchema,
  dependsOn: z.array(z.string()).optional(),
  validation: z
    .object({ rules: z.array(validationRuleSchema) })
    .optional(),
  evaluation: llmEvaluationSchema.optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
});

// ─── Workflow Definition ─────────────────────────────────────

export const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  config: z.object({
    defaultModel: z.string().min(1),
    topology: z.enum(["single", "pipeline", "parallel"]).default("pipeline"),
    onValidationFail: z.enum(["block", "flag", "retry"]).default("block"),
  }),
  steps: z.array(stepDefinitionSchema).min(1),
});

// ─── Agent Role ──────────────────────────────────────────────

export const agentRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  systemPrompt: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).optional(),
  constraints: z.array(z.string()).default([]),
});

// ─── Model Config ────────────────────────────────────────────

const modelConfigSchema = z.object({
  default: z.string().min(1),
  overrides: z
    .object({
      classify: z.string().optional(),
      generate: z.string().optional(),
      validate: z.string().optional(),
    })
    .optional(),
  provider: z
    .object({
      type: z.enum(["anthropic", "openai", "google", "custom"]),
      apiKey: z.string().min(1),
      baseUrl: z.string().url().optional(),
    })
    .optional(),
});

// ─── MCP Server Config ──────────────────────────────────────

const mcpServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(["stdio", "http", "sse"]),
  command: z.string().optional(),
  url: z.string().url().optional(),
  env: z.record(z.string(), z.string()).optional(),
  allowedRoles: z.array(z.string()).optional(),
});

// ─── Trace Output Config ─────────────────────────────────────

const traceOutputConfigSchema = z.object({
  type: z.enum(["stdout", "jsonl", "langfuse", "otel", "custom"]),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ─── Project Config (eddgate.config.yaml) ─────────────────────

export const projectConfigSchema = z.object({
  model: modelConfigSchema,
  mcp: z
    .object({ servers: z.array(mcpServerConfigSchema) })
    .optional(),
  trace: z
    .object({ outputs: z.array(traceOutputConfigSchema) })
    .optional(),
  eval: z
    .object({
      tier3: z
        .object({
          trigger: z
            .enum(["on_prompt_change", "on_workflow_change", "manual", "cron"])
            .default("manual"),
          dataset: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

// ─── Type Exports ────────────────────────────────────────────

export type WorkflowSchema = z.infer<typeof workflowSchema>;
export type AgentRoleSchema = z.infer<typeof agentRoleSchema>;
export type ProjectConfigSchema = z.infer<typeof projectConfigSchema>;

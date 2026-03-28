// ─── Execution Context ───────────────────────────────────────
// 최소 실행 컨텍스트. 재현 가능성이 핵심.
// "100토큰 요약 > 10,000토큰 raw" (Anthropic)

export type StepState =
  | "classify"
  | "retrieve"
  | "generate"
  | "validate"
  | "transform"
  | "human_approval";

export interface Identity {
  role: string;
  model?: string;
  constraints: string[];
}

export interface StepMemory {
  summary: string;
  previousStepOutput?: string;
}

export interface ExecutionContext {
  state: StepState;
  identity: Identity;
  tools: string[];
  memory?: StepMemory;
}

// ─── Validation (Tier 1: 규칙 기반, 매 단계, 비용 0) ────────

export type ValidationRuleType =
  | "schema"
  | "required_fields"
  | "format"
  | "length"
  | "regex"
  | "custom";

export interface ValidationRule {
  type: ValidationRuleType;
  spec: Record<string, unknown>;
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  failures: Array<{
    rule: ValidationRule;
    actual?: unknown;
  }>;
}

// ─── Evaluation (Tier 2: LLM 평가, 핵심 전환점만) ────────────

export type EvalType = "groundedness" | "relevance" | "custom";
export type EvalAction = "block" | "flag" | "retry";

export interface LLMEvaluation {
  enabled: boolean;
  type: EvalType;
  threshold: number;
  onFail: EvalAction;
  maxRetries?: number;
  model?: string;
  rubric?: string;
}

export interface EvaluationResult {
  score: number;
  passed: boolean;
  action: EvalAction;
  reasoning?: string;
}

// ─── Workflow ─────────────────────────────────────────────────

export type Topology = "single" | "pipeline" | "parallel";
export type OnValidationFail = "block" | "flag" | "retry";

export interface WorkflowConfig {
  defaultModel: string;
  topology: Topology;
  onValidationFail: OnValidationFail;
}

export interface StepDefinition {
  id: string;
  name: string;
  type: StepState;
  context: ExecutionContext;
  dependsOn?: string[];
  validation?: { rules: ValidationRule[] };
  evaluation?: LLMEvaluation;
  outputSchema?: Record<string, unknown>;
  model?: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  config: WorkflowConfig;
  steps: StepDefinition[];
}

// ─── Agent Role ──────────────────────────────────────────────

export interface AgentRole {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  mcpServers?: string[];
  constraints: string[];
}

// ─── Model Provider ──────────────────────────────────────────

export interface ModelConfig {
  default: string;
  overrides?: {
    classify?: string;
    generate?: string;
    validate?: string;
  };
  provider?: {
    type: "anthropic" | "openai" | "google" | "custom";
    apiKey: string;
    baseUrl?: string;
  };
}

// ─── Trace ───────────────────────────────────────────────────

export type TraceEventType =
  | "workflow_start"
  | "workflow_end"
  | "step_start"
  | "step_end"
  | "llm_call"
  | "tool_call"
  | "validation"
  | "evaluation"
  | "error";

export interface TraceEvent {
  timestamp: string;
  traceId: string;
  stepId: string;
  type: TraceEventType;
  context?: ExecutionContext;
  data: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    cost?: number;
    validationResult?: ValidationResult;
    evaluationResult?: EvaluationResult;
    output?: string;
    error?: string;
  };
}

export type TraceOutputType = "stdout" | "jsonl" | "langfuse" | "otel" | "custom";

export interface TraceOutputConfig {
  type: TraceOutputType;
  config?: Record<string, unknown>;
}

// ─── Step Execution Result ───────────────────────────────────

export interface StepResult {
  stepId: string;
  status: "success" | "failed" | "flagged" | "skipped";
  output: unknown;
  validation?: ValidationResult;
  evaluation?: EvaluationResult;
  trace: TraceEvent[];
  durationMs: number;
  tokenUsage: { input: number; output: number };
}

// ─── Workflow Execution Result ────────────────────────────────

export interface WorkflowResult {
  workflowName: string;
  traceId: string;
  status: "success" | "failed" | "partial";
  steps: StepResult[];
  totalDurationMs: number;
  totalTokens: { input: number; output: number };
  totalCostEstimate: number;
}

// ─── Project Config (eddgate.config.yaml) ─────────────────────

export interface ProjectConfig {
  model: ModelConfig;
  mcp?: {
    servers: MCPServerConfig[];
  };
  trace?: {
    outputs: TraceOutputConfig[];
  };
  eval?: {
    tier3?: {
      trigger: "on_prompt_change" | "on_workflow_change" | "manual" | "cron";
      dataset?: string;
    };
  };
}

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  url?: string;
  env?: Record<string, string>;
  allowedRoles?: string[];
}

// ─── Execution Context ───────────────────────────────────────
// Minimal execution context. Reproducibility is key.
// "100-token summary > 10,000-token raw" (Anthropic)

export type StepState =
  | "classify"
  | "retrieve"
  | "generate"
  | "validate"
  | "transform"
  | "human_approval"
  | "record_decision";

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

// ─── Validation (Tier 1: rule-based, every step, zero cost) ────────

export type ValidationRuleType =
  | "schema"
  | "required_fields"
  | "format"
  | "length"
  | "regex"
  | "range"
  | "enum"
  | "not_empty"
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

// ─── Evaluation (Tier 2: LLM judge, key transitions only) ────────────

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
  sourceContext?: string;
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
  | "retrieval"
  | "validation"
  | "evaluation"
  | "decision"
  | "error";

// Retrieval result metadata for E2E trace
export interface RetrievalChunk {
  chunkId: string;
  source: string;
  url?: string;
  score: number;
  text?: string;
}

export interface TraceEvent {
  timestamp: string;
  traceId: string;
  stepId: string;
  parentSpanId?: string;
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
    retrievalResults?: RetrievalChunk[];
    decision?: { status: string; reason: string; outputPath?: string };
    output?: string;
    error?: string;
    toolName?: string;
    toolInput?: unknown;
    toolOutput?: unknown;
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
  error?: string;
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

// ─── RAG Pipeline ────────────────────────────────────────

export interface RAGConfig {
  indexName: string;
  namespace?: string;
  topK: number;
  scoreThreshold?: number;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface RAGIndexResult {
  indexName: string;
  documentsProcessed: number;
  chunksCreated: number;
  chunksUpserted: number;
  durationMs: number;
}

export interface RAGSearchResult {
  query: string;
  chunks: RetrievalChunk[];
  durationMs: number;
}

// ─── A/B Prompt Testing ─────────────────────────────────

export type ABVariant = "A" | "B";

export interface ABTestConfig {
  workflow: string;
  promptA: string;
  promptB: string;
  input: string;
  iterations: number;
  model?: string;
}

export interface ABTestResult {
  variant: ABVariant;
  runs: Array<{
    iteration: number;
    status: string;
    evalScores: Record<string, number>;
    totalTokens: number;
    totalCost: number;
    durationMs: number;
  }>;
  avgScore: number;
  avgTokens: number;
  avgCost: number;
  avgDurationMs: number;
}

export interface ABComparison {
  config: ABTestConfig;
  resultA: ABTestResult;
  resultB: ABTestResult;
  winner: ABVariant | "tie";
  scoreDelta: number;
  costDelta: number;
  tokenDelta: number;
  pValue?: number;
  confidenceInterval?: [number, number];
  statisticallySignificant?: boolean;
}

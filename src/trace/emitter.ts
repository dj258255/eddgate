import { randomUUID } from "node:crypto";
import type {
  TraceEvent,
  TraceEventType,
  TraceOutputConfig,
  ExecutionContext,
  ValidationResult,
  EvaluationResult,
} from "../types/index.js";

type TraceListener = (event: TraceEvent) => void | Promise<void>;

const MAX_BUFFER_SIZE = 10_000;

/**
 * Trace Emitter
 *
 * Core of the observable framework.
 * Event emission + pluggable outputs, not a custom platform.
 *
 * Outputs:
 * - stdout: Human-readable summary (always)
 * - jsonl: Machine-readable full trace (optional)
 * - langfuse: Langfuse integration (optional)
 * - otel: OpenTelemetry integration (optional)
 */
export class TraceEmitter {
  private traceId: string;
  private events: TraceEvent[] = [];
  private listeners: TraceListener[] = [];
  private activeSpans = new Map<string, string>(); // stepId -> spanId

  constructor(traceId?: string) {
    this.traceId = traceId ?? randomUUID();
  }

  getTraceId(): string {
    return this.traceId;
  }

  getEvents(): readonly TraceEvent[] {
    return this.events;
  }

  onEvent(listener: TraceListener): void {
    this.listeners.push(listener);
  }

  emit(
    stepId: string,
    type: TraceEventType,
    data: TraceEvent["data"],
    context?: ExecutionContext,
    parentSpanId?: string,
  ): TraceEvent {
    const event: TraceEvent = {
      timestamp: new Date().toISOString(),
      traceId: this.traceId,
      stepId,
      parentSpanId: parentSpanId ?? this.activeSpans.get(stepId),
      type,
      context,
      data,
    };

    // Buffer management: prevent unbounded memory growth
    if (this.events.length < MAX_BUFFER_SIZE) {
      this.events.push(event);
    }

    for (const listener of this.listeners) {
      try {
        // Safely handle both sync and async listeners
        const result = listener(event);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => {
            // Listener failures must not break workflow execution
          });
        }
      } catch {
        // Sync listener failures must not break execution
      }
    }

    return event;
  }

  /**
   * Flush buffered events (for long-running workflows).
   * Returns flushed events and clears the buffer.
   */
  flush(): TraceEvent[] {
    const flushed = [...this.events];
    this.events = [];
    return flushed;
  }

  // ─── Convenience Methods ─────────────────────────────────

  workflowStart(workflowName: string): TraceEvent {
    const spanId = randomUUID();
    this.activeSpans.set("__workflow__", spanId);
    return this.emit("__workflow__", "workflow_start", {
      output: workflowName,
    });
  }

  workflowEnd(status: string, totalMs: number): TraceEvent {
    const event = this.emit("__workflow__", "workflow_end", {
      output: status,
      latencyMs: totalMs,
    });
    this.activeSpans.delete("__workflow__");
    return event;
  }

  stepStart(stepId: string, context: ExecutionContext): TraceEvent {
    const spanId = randomUUID();
    this.activeSpans.set(stepId, spanId);
    return this.emit(stepId, "step_start", {}, context, this.activeSpans.get("__workflow__"));
  }

  stepEnd(
    stepId: string,
    data: {
      output?: string;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
    },
  ): TraceEvent {
    const event = this.emit(stepId, "step_end", data);
    this.activeSpans.delete(stepId);
    return event;
  }

  llmCall(
    stepId: string,
    data: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      cost?: number;
    },
  ): TraceEvent {
    return this.emit(stepId, "llm_call", data, undefined, this.activeSpans.get(stepId));
  }

  toolCall(
    stepId: string,
    data: {
      toolName: string;
      toolInput?: unknown;
      toolOutput?: unknown;
      latencyMs?: number;
    },
  ): TraceEvent {
    return this.emit(stepId, "tool_call", {
      toolName: data.toolName,
      toolInput: data.toolInput,
      toolOutput: data.toolOutput,
      latencyMs: data.latencyMs,
    }, undefined, this.activeSpans.get(stepId));
  }

  validation(
    stepId: string,
    result: ValidationResult,
  ): TraceEvent {
    return this.emit(stepId, "validation", { validationResult: result });
  }

  retrieval(
    stepId: string,
    chunks: Array<{ chunkId: string; source: string; url?: string; score: number; text?: string }>,
  ): TraceEvent {
    return this.emit(stepId, "retrieval", { retrievalResults: chunks });
  }

  decision(
    stepId: string,
    info: { status: string; reason: string; outputPath?: string },
  ): TraceEvent {
    return this.emit(stepId, "decision", { decision: info });
  }

  error(stepId: string, error: string): TraceEvent {
    return this.emit(stepId, "error", { error });
  }

  evaluation(stepId: string, result: EvaluationResult): TraceEvent {
    return this.emit(stepId, "evaluation", { evaluationResult: result });
  }
}

// ─── Trace Output Adapters ───────────────────────────────────

export function createStdoutListener(): TraceListener {
  return (event: TraceEvent) => {
    const prefix = formatPrefix(event);
    const detail = formatDetail(event);
    if (detail) {
      console.log(`${prefix} ${detail}`);
    }
  };
}

export function createJsonlListener(
  writeLine: (line: string) => void,
): TraceListener {
  return (event: TraceEvent) => {
    writeLine(JSON.stringify(event));
  };
}

// Re-export external listeners for convenience
export { createLangfuseListener } from "./outputs/langfuse.js";
export { createOtelListener } from "./outputs/otel.js";

// ─── Formatting ──────────────────────────────────────────────

function formatPrefix(event: TraceEvent): string {
  const typeTag = `[${event.type.toUpperCase().replace("_", " ")}]`;
  const step = event.stepId === "__workflow__" ? "" : ` ${event.stepId}`;
  return `${typeTag}${step}`;
}

function formatDetail(event: TraceEvent): string | null {
  switch (event.type) {
    case "workflow_start":
      return `-> ${event.data.output}`;
    case "workflow_end":
      return `<- ${event.data.output} (${formatMs(event.data.latencyMs)})`;
    case "step_start":
      return `-> ${event.context?.identity.role ?? "unknown"}`;
    case "step_end": {
      const tokens = event.data.inputTokens
        ? ` (${((event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0)).toLocaleString()} tokens)`
        : "";
      return `<- done ${formatMs(event.data.latencyMs)}${tokens}`;
    }
    case "llm_call":
      return `${event.data.model} (${event.data.inputTokens}->${event.data.outputTokens} tokens, ${formatMs(event.data.latencyMs)})`;
    case "tool_call":
      return `tool:${event.data.toolName}`;
    case "validation": {
      const vr = event.data.validationResult;
      if (!vr) return null;
      return vr.passed
        ? "PASS"
        : `FAIL: ${vr.failures.map((f) => f.rule.message).join(", ")}`;
    }
    case "evaluation": {
      const er = event.data.evaluationResult;
      if (!er) return null;
      const icon = er.passed ? "PASS" : "FAIL";
      return `${icon} score=${er.score.toFixed(2)} (${er.action})`;
    }
    case "error":
      return `ERROR: ${event.data.error}`;
    default:
      return null;
  }
}

function formatMs(ms?: number): string {
  if (ms === undefined) return "?ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

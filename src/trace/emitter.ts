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

/**
 * Trace Emitter
 *
 * Core of the observable framework.
 * Event emission + pluggable outputs, not a custom platform.
 *
 * Outputs:
 * - stdout: Human-readable summary (always)
 * - jsonl: Machine-readable full trace (optional)
 * - langfuse/otel: External integration (optional)
 */
export class TraceEmitter {
  private traceId: string;
  private events: TraceEvent[] = [];
  private listeners: TraceListener[] = [];

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
  ): TraceEvent {
    const event: TraceEvent = {
      timestamp: new Date().toISOString(),
      traceId: this.traceId,
      stepId,
      type,
      context,
      data,
    };

    this.events.push(event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not break execution
      }
    }

    return event;
  }

  // ─── Convenience Methods ─────────────────────────────────

  workflowStart(workflowName: string): TraceEvent {
    return this.emit("__workflow__", "workflow_start", {
      output: workflowName,
    });
  }

  workflowEnd(status: string, totalMs: number): TraceEvent {
    return this.emit("__workflow__", "workflow_end", {
      output: status,
      latencyMs: totalMs,
    });
  }

  stepStart(stepId: string, context: ExecutionContext): TraceEvent {
    return this.emit(stepId, "step_start", {}, context);
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
    return this.emit(stepId, "step_end", data);
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
    return this.emit(stepId, "llm_call", data);
  }

  validation(
    stepId: string,
    result: ValidationResult,
  ): TraceEvent {
    return this.emit(stepId, "validation", { validationResult: result });
  }

  evaluation(
    stepId: string,
    result: EvaluationResult,
  ): TraceEvent {
    return this.emit(stepId, "evaluation", { evaluationResult: result });
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

// ─── Formatting ──────────────────────────────────────────────

function formatPrefix(event: TraceEvent): string {
  const typeTag = `[${event.type.toUpperCase().replace("_", " ")}]`;
  const step = event.stepId === "__workflow__" ? "" : ` ${event.stepId}`;
  return `${typeTag}${step}`;
}

function formatDetail(event: TraceEvent): string | null {
  switch (event.type) {
    case "workflow_start":
      return `→ ${event.data.output}`;
    case "workflow_end":
      return `← ${event.data.output} (${formatMs(event.data.latencyMs)})`;
    case "step_start":
      return `→ ${event.context?.identity.role ?? "unknown"}`;
    case "step_end": {
      const tokens = event.data.inputTokens
        ? ` (${((event.data.inputTokens ?? 0) + (event.data.outputTokens ?? 0)).toLocaleString()} tokens)`
        : "";
      return `← done ${formatMs(event.data.latencyMs)}${tokens}`;
    }
    case "llm_call":
      return `${event.data.model} (${event.data.inputTokens}→${event.data.outputTokens} tokens, ${formatMs(event.data.latencyMs)})`;
    case "validation": {
      const vr = event.data.validationResult;
      if (!vr) return null;
      return vr.passed
        ? "✓ PASS"
        : `✗ FAIL: ${vr.failures.map((f) => f.rule.message).join(", ")}`;
    }
    case "evaluation": {
      const er = event.data.evaluationResult;
      if (!er) return null;
      const icon = er.passed ? "✓" : "✗";
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

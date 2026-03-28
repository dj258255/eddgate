import type { TraceEvent } from "../../types/index.js";

/**
 * OpenTelemetry Trace Adapter
 *
 * Exports trace events as OpenTelemetry spans.
 * Requires: @opentelemetry/api, @opentelemetry/sdk-trace-base
 *
 * Install: npm install @opentelemetry/api @opentelemetry/sdk-trace-base
 *
 * Compatible with: Jaeger, Grafana Tempo, Datadog, Honeycomb
 */
export function createOtelListener(options?: {
  serviceName?: string;
}): (event: TraceEvent) => void {
  const serviceName = options?.serviceName ?? "eddgate";

  let tracer: OtelTracer | null = null;
  let initPromise: Promise<void> | null = null;
  const spans = new Map<string, OtelSpan>();

  async function init(): Promise<void> {
    try {
      // @ts-ignore -- optional dependency, may not be installed
      const otelApi = await import("@opentelemetry/api");
      tracer = otelApi.trace.getTracer(serviceName) as OtelTracer;
    } catch {
      console.warn(
        "[otel] @opentelemetry/api not installed. Run: npm install @opentelemetry/api @opentelemetry/sdk-trace-base",
      );
    }
  }

  return (event: TraceEvent) => {
    if (!initPromise) initPromise = init();

    initPromise.then(() => {
      if (!tracer) return;

      try {
        switch (event.type) {
          case "workflow_start": {
            const span = tracer.startSpan(`workflow:${event.data.output}`);
            span.setAttribute("trace.id", event.traceId);
            spans.set("__workflow__", span);
            break;
          }

          case "step_start": {
            const span = tracer.startSpan(`step:${event.stepId}`);
            span.setAttribute("step.role", event.context?.identity.role ?? "");
            span.setAttribute("step.state", event.context?.state ?? "");
            spans.set(event.stepId, span);
            break;
          }

          case "llm_call": {
            const span = tracer.startSpan(`llm:${event.stepId}`);
            span.setAttribute("gen_ai.system", "claude");
            span.setAttribute("gen_ai.request.model", event.data.model ?? "");
            span.setAttribute("gen_ai.usage.input_tokens", event.data.inputTokens ?? 0);
            span.setAttribute("gen_ai.usage.output_tokens", event.data.outputTokens ?? 0);
            span.end();
            break;
          }

          case "step_end": {
            const span = spans.get(event.stepId);
            if (span) {
              span.setAttribute("step.latency_ms", event.data.latencyMs ?? 0);
              span.end();
              spans.delete(event.stepId);
            }
            break;
          }

          case "workflow_end": {
            const span = spans.get("__workflow__");
            if (span) {
              span.setAttribute("workflow.status", String(event.data.output));
              span.setAttribute("workflow.duration_ms", event.data.latencyMs ?? 0);
              span.end();
              spans.delete("__workflow__");
            }
            break;
          }

          case "error": {
            const span = spans.get(event.stepId);
            if (span) {
              span.setAttribute("error", true);
              span.setAttribute("error.message", event.data.error ?? "");
            }
            break;
          }
        }
      } catch {
        // OTel errors should not break workflow execution
      }
    });
  };
}

// Minimal types for dynamic import
interface OtelTracer {
  startSpan(name: string): OtelSpan;
}

interface OtelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

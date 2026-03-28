import type { TraceEvent } from "../../types/index.js";

/**
 * Langfuse Trace Adapter
 *
 * Sends trace events to Langfuse for visualization.
 * Requires: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY env vars.
 *
 * Install: npm install langfuse
 */
export function createLangfuseListener(options?: {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
}): (event: TraceEvent) => void {
  const publicKey = options?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = options?.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = options?.baseUrl ?? process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";

  if (!publicKey || !secretKey) {
    console.warn(
      "[langfuse] LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY required. Langfuse disabled.",
    );
    return () => {};
  }

  // Dynamic import to avoid requiring langfuse as a mandatory dependency
  let langfuseClient: LangfuseClient | null = null;
  let initPromise: Promise<void> | null = null;

  async function init(): Promise<void> {
    try {
      // @ts-ignore -- optional dependency, may not be installed
      const { Langfuse } = await import("langfuse");
      langfuseClient = new Langfuse({
        publicKey,
        secretKey,
        baseUrl,
      }) as LangfuseClient;
    } catch {
      console.warn("[langfuse] langfuse package not installed. Run: npm install langfuse");
    }
  }

  return (event: TraceEvent) => {
    if (!initPromise) initPromise = init();

    initPromise.then(() => {
      if (!langfuseClient) return;

      try {
        switch (event.type) {
          case "workflow_start":
            langfuseClient.trace({
              id: event.traceId,
              name: String(event.data.output ?? "workflow"),
            });
            break;

          case "step_start":
            langfuseClient.span({
              traceId: event.traceId,
              name: event.stepId,
              metadata: {
                role: event.context?.identity.role,
                state: event.context?.state,
              },
            });
            break;

          case "llm_call":
            langfuseClient.generation({
              traceId: event.traceId,
              name: `${event.stepId}/llm`,
              model: event.data.model,
              usage: {
                input: event.data.inputTokens,
                output: event.data.outputTokens,
              },
              metadata: {
                latencyMs: event.data.latencyMs,
                cost: event.data.cost,
              },
            });
            break;

          case "evaluation":
            langfuseClient.score({
              traceId: event.traceId,
              name: "evaluation",
              value: event.data.evaluationResult?.score ?? 0,
              comment: event.data.evaluationResult?.reasoning,
            });
            break;

          case "workflow_end":
            langfuseClient.flush?.();
            break;
        }
      } catch {
        // Langfuse errors should not break workflow execution
      }
    });
  };
}

// Minimal type for dynamic import
interface LangfuseClient {
  trace(params: Record<string, unknown>): void;
  span(params: Record<string, unknown>): void;
  generation(params: Record<string, unknown>): void;
  score(params: Record<string, unknown>): void;
  flush?(): void;
}

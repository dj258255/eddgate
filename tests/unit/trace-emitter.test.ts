import { describe, it, expect, vi, beforeEach } from "vitest";
import { TraceEmitter } from "../../src/trace/emitter.js";

describe("TraceEmitter", () => {
  let tracer: TraceEmitter;

  beforeEach(() => {
    tracer = new TraceEmitter("test-trace-id");
  });

  // ---- Basic emit() ----

  describe("emit()", () => {
    it("creates events with correct structure", () => {
      const event = tracer.emit("step-1", "step_start", { output: "starting" });

      expect(event.traceId).toBe("test-trace-id");
      expect(event.stepId).toBe("step-1");
      expect(event.type).toBe("step_start");
      expect(event.data.output).toBe("starting");
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe("string");
    });

    it("stores events in internal buffer", () => {
      tracer.emit("s1", "step_start", {});
      tracer.emit("s1", "step_end", { latencyMs: 50 });

      const events = tracer.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("step_start");
      expect(events[1].type).toBe("step_end");
    });

    it("includes context when provided", () => {
      const ctx = {
        state: "generate" as const,
        identity: { role: "tester", constraints: ["be concise"] },
        tools: ["file_read"],
      };
      const event = tracer.emit("s1", "step_start", {}, ctx);
      expect(event.context).toBeDefined();
      expect(event.context!.identity.role).toBe("tester");
    });
  });

  // ---- parentSpanId ----

  describe("parentSpanId", () => {
    it("sets parentSpanId when step is active", () => {
      tracer.stepStart("s1", {
        state: "generate",
        identity: { role: "tester", constraints: [] },
        tools: [],
      });

      const event = tracer.emit("s1", "llm_call", {
        model: "sonnet",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 100,
      });
      expect(event.parentSpanId).toBeDefined();
    });

    it("uses explicit parentSpanId when provided", () => {
      const event = tracer.emit("s1", "step_start", {}, undefined, "custom-span-id");
      expect(event.parentSpanId).toBe("custom-span-id");
    });

    it("has no parentSpanId when no step is active", () => {
      const event = tracer.emit("s1", "step_start", {});
      expect(event.parentSpanId).toBeUndefined();
    });
  });

  // ---- toolCall() ----

  describe("toolCall()", () => {
    it("emits tool_call events with correct data", () => {
      tracer.stepStart("s1", {
        state: "retrieve",
        identity: { role: "searcher", constraints: [] },
        tools: [],
      });

      const event = tracer.toolCall("s1", {
        toolName: "web_search",
        toolInput: { query: "test" },
        toolOutput: { results: [] },
        latencyMs: 200,
      });

      expect(event.type).toBe("tool_call");
      expect(event.data.toolName).toBe("web_search");
      expect(event.data.toolInput).toEqual({ query: "test" });
      expect(event.data.toolOutput).toEqual({ results: [] });
      expect(event.data.latencyMs).toBe(200);
      expect(event.parentSpanId).toBeDefined();
    });
  });

  // ---- flush() ----

  describe("flush()", () => {
    it("returns all buffered events and clears buffer", () => {
      tracer.emit("s1", "step_start", {});
      tracer.emit("s1", "step_end", { latencyMs: 10 });
      tracer.emit("s2", "step_start", {});

      const flushed = tracer.flush();
      expect(flushed).toHaveLength(3);

      const remaining = tracer.getEvents();
      expect(remaining).toHaveLength(0);
    });

    it("returns empty array when nothing buffered", () => {
      const flushed = tracer.flush();
      expect(flushed).toHaveLength(0);
    });

    it("allows further events after flush", () => {
      tracer.emit("s1", "step_start", {});
      tracer.flush();

      tracer.emit("s2", "step_start", {});
      const events = tracer.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].stepId).toBe("s2");
    });
  });

  // ---- MAX_BUFFER_SIZE ----

  describe("MAX_BUFFER_SIZE", () => {
    it("prevents unbounded growth beyond 10,000 events", () => {
      for (let i = 0; i < 10_050; i++) {
        tracer.emit(`s-${i}`, "step_start", {});
      }

      const events = tracer.getEvents();
      expect(events.length).toBe(10_000);
    });

    it("still returns events from emit even when buffer is full", () => {
      for (let i = 0; i < 10_001; i++) {
        tracer.emit(`s-${i}`, "step_start", {});
      }

      const event = tracer.emit("overflow", "error", { error: "overflow" });
      expect(event).toBeDefined();
      expect(event.stepId).toBe("overflow");

      expect(tracer.getEvents().length).toBe(10_000);
    });
  });

  // ---- Listener error handling ----

  describe("listener error handling", () => {
    it("catches sync listener errors (does not propagate)", () => {
      tracer.onEvent(() => {
        throw new Error("sync listener crash");
      });

      expect(() => {
        tracer.emit("s1", "step_start", {});
      }).not.toThrow();
    });

    it("catches async listener errors (does not propagate)", () => {
      tracer.onEvent(async () => {
        throw new Error("async listener crash");
      });

      expect(() => {
        tracer.emit("s1", "step_start", {});
      }).not.toThrow();
    });

    it("calls all listeners even if one throws", () => {
      const callLog: string[] = [];

      tracer.onEvent(() => {
        callLog.push("first");
        throw new Error("first listener crash");
      });

      tracer.onEvent(() => {
        callLog.push("second");
      });

      tracer.emit("s1", "step_start", {});

      expect(callLog).toContain("first");
      expect(callLog).toContain("second");
    });

    it("notifies listeners for each event", () => {
      const received: string[] = [];
      tracer.onEvent((event) => {
        received.push(event.type);
      });

      tracer.emit("s1", "step_start", {});
      tracer.emit("s1", "step_end", { latencyMs: 10 });

      expect(received).toEqual(["step_start", "step_end"]);
    });
  });

  // ---- workflowStart / workflowEnd ----

  describe("workflowStart/End", () => {
    it("workflowStart sets active span and emits event", () => {
      const event = tracer.workflowStart("my-workflow");

      expect(event.type).toBe("workflow_start");
      expect(event.stepId).toBe("__workflow__");
      expect(event.data.output).toBe("my-workflow");
    });

    it("workflowEnd clears active span and emits event", () => {
      tracer.workflowStart("my-workflow");
      const event = tracer.workflowEnd("success", 1500);

      expect(event.type).toBe("workflow_end");
      expect(event.data.output).toBe("success");
      expect(event.data.latencyMs).toBe(1500);
    });

    it("stepStart gets workflow span as parent after workflowStart", () => {
      tracer.workflowStart("wf");

      const stepEvent = tracer.stepStart("s1", {
        state: "generate",
        identity: { role: "tester", constraints: [] },
        tools: [],
      });

      expect(stepEvent.parentSpanId).toBeDefined();
    });
  });

  // ---- stepStart / stepEnd ----

  describe("stepStart/End", () => {
    it("stepStart sets active span for the step", () => {
      const event = tracer.stepStart("s1", {
        state: "generate",
        identity: { role: "tester", constraints: [] },
        tools: [],
      });

      expect(event.type).toBe("step_start");
      expect(event.stepId).toBe("s1");
    });

    it("stepEnd clears active span for the step", () => {
      tracer.stepStart("s1", {
        state: "generate",
        identity: { role: "tester", constraints: [] },
        tools: [],
      });

      const endEvent = tracer.stepEnd("s1", { latencyMs: 100 });
      expect(endEvent.type).toBe("step_end");

      const laterEvent = tracer.emit("s1", "error", { error: "late" });
      expect(laterEvent.parentSpanId).toBeUndefined();
    });

    it("stepEnd includes token counts when provided", () => {
      tracer.stepStart("s1", {
        state: "generate",
        identity: { role: "tester", constraints: [] },
        tools: [],
      });

      const event = tracer.stepEnd("s1", {
        latencyMs: 200,
        inputTokens: 500,
        outputTokens: 250,
      });

      expect(event.data.inputTokens).toBe(500);
      expect(event.data.outputTokens).toBe(250);
    });
  });

  // ---- Convenience methods ----

  describe("convenience methods", () => {
    it("validation() emits validation event", () => {
      const event = tracer.validation("s1", {
        passed: true,
        failures: [],
      });
      expect(event.type).toBe("validation");
      expect(event.data.validationResult!.passed).toBe(true);
    });

    it("error() emits error event", () => {
      const event = tracer.error("s1", "something went wrong");
      expect(event.type).toBe("error");
      expect(event.data.error).toBe("something went wrong");
    });

    it("assessment() emits assessment event", () => {
      const event = tracer.evaluation("s1", {
        score: 0.85,
        passed: true,
        action: "flag",
        reasoning: "good",
      });
      expect(event.type).toBe("evaluation");
      expect(event.data.evaluationResult!.score).toBe(0.85);
    });

    it("decision() emits decision event", () => {
      const event = tracer.decision("s1", {
        status: "recorded",
        reason: "audit trail",
        outputPath: "traces/test.json",
      });
      expect(event.type).toBe("decision");
      expect(event.data.decision!.status).toBe("recorded");
    });

    it("retrieval() emits retrieval event", () => {
      const event = tracer.retrieval("s1", [
        { chunkId: "c1", source: "doc1", score: 0.9, text: "chunk text" },
      ]);
      expect(event.type).toBe("retrieval");
      expect(event.data.retrievalResults).toHaveLength(1);
      expect(event.data.retrievalResults![0].score).toBe(0.9);
    });

    it("llmCall() emits llm_call event with parent span", () => {
      tracer.stepStart("s1", {
        state: "generate",
        identity: { role: "tester", constraints: [] },
        tools: [],
      });

      const event = tracer.llmCall("s1", {
        model: "sonnet",
        inputTokens: 1000,
        outputTokens: 500,
        latencyMs: 2000,
        cost: 0.012,
      });

      expect(event.type).toBe("llm_call");
      expect(event.data.model).toBe("sonnet");
      expect(event.parentSpanId).toBeDefined();
    });
  });

  // ---- getTraceId ----

  describe("getTraceId()", () => {
    it("returns the trace ID set in constructor", () => {
      expect(tracer.getTraceId()).toBe("test-trace-id");
    });

    it("generates a UUID when no ID provided", () => {
      const autoTracer = new TraceEmitter();
      const id = autoTracer.getTraceId();
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThan(0);
      expect(id).toMatch(/^[0-9a-f-]+$/i);
    });
  });
});

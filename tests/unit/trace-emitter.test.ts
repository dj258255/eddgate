import { describe, it, expect } from "vitest";
import { TraceEmitter, createStdoutListener, createJsonlListener } from "../../src/trace/emitter.js";

describe("TraceEmitter", () => {
  it("generates a trace ID", () => {
    const emitter = new TraceEmitter();
    expect(emitter.getTraceId()).toBeDefined();
    expect(emitter.getTraceId().length).toBeGreaterThan(0);
  });

  it("uses provided trace ID", () => {
    const emitter = new TraceEmitter("custom-id");
    expect(emitter.getTraceId()).toBe("custom-id");
  });

  it("records events", () => {
    const emitter = new TraceEmitter("test");
    emitter.emit("step1", "step_start", {});
    emitter.emit("step1", "step_end", { latencyMs: 100 });

    const events = emitter.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("step_start");
    expect(events[1].type).toBe("step_end");
    expect(events[1].data.latencyMs).toBe(100);
  });

  it("notifies listeners", () => {
    const emitter = new TraceEmitter("test");
    const received: string[] = [];

    emitter.onEvent((event) => {
      received.push(event.type);
    });

    emitter.emit("s1", "step_start", {});
    emitter.emit("s1", "step_end", {});

    expect(received).toEqual(["step_start", "step_end"]);
  });

  it("convenience methods work", () => {
    const emitter = new TraceEmitter("test");

    emitter.workflowStart("test-workflow");
    emitter.stepStart("s1", {
      state: "classify",
      identity: { role: "tester", constraints: [] },
      tools: [],
    });
    emitter.llmCall("s1", {
      model: "sonnet",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 500,
    });
    emitter.validation("s1", { passed: true, failures: [] });
    emitter.stepEnd("s1", { latencyMs: 600 });
    emitter.workflowEnd("success", 700);

    const events = emitter.getEvents();
    expect(events).toHaveLength(6);
    expect(events.map((e) => e.type)).toEqual([
      "workflow_start",
      "step_start",
      "llm_call",
      "validation",
      "step_end",
      "workflow_end",
    ]);
  });

  it("createJsonlListener produces valid JSON lines", () => {
    const emitter = new TraceEmitter("test");
    const lines: string[] = [];

    emitter.onEvent(createJsonlListener((line) => lines.push(line)));

    emitter.emit("s1", "step_start", {});
    emitter.emit("s1", "llm_call", { model: "sonnet", inputTokens: 10, outputTokens: 5, latencyMs: 100 });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const parsed = JSON.parse(lines[1]);
    expect(parsed.data.model).toBe("sonnet");
  });

  it("listener errors do not break emission", () => {
    const emitter = new TraceEmitter("test");

    emitter.onEvent(() => {
      throw new Error("listener crash");
    });

    // should not throw
    emitter.emit("s1", "step_start", {});
    expect(emitter.getEvents()).toHaveLength(1);
  });
});

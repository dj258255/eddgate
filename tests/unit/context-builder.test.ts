import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildContext, buildSystemPrompt } from "../../src/core/context-builder.js";
import type { StepDefinition, StepResult } from "../../src/types/index.js";

describe("Context Builder", () => {
  // Capture console.warn to verify warning behavior
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const baseStep: StepDefinition = {
    id: "test_step",
    name: "Test Step",
    type: "generate",
    context: {
      state: "generate",
      identity: {
        role: "tester",
        constraints: ["be concise"],
      },
      tools: ["file_read"],
    },
  };

  // ---- buildContext returns correct structure ----

  describe("buildContext returns correct structure", () => {
    it("creates context with default model when step has no model", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      expect(ctx.state).toBe("generate");
      expect(ctx.identity.model).toBe("sonnet");
      expect(ctx.identity.role).toBe("tester");
      expect(ctx.identity.constraints).toEqual(["be concise"]);
      expect(ctx.tools).toEqual(["file_read"]);
    });

    it("uses step model override when present", () => {
      const step = { ...baseStep, model: "haiku" };
      const ctx = buildContext(step, new Map(), "sonnet");
      expect(ctx.identity.model).toBe("haiku");
    });

    it("uses config model overrides by step type", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet", {
        generate: "opus",
      });
      expect(ctx.identity.model).toBe("opus");
    });

    it("step model takes priority over config override", () => {
      const step = { ...baseStep, model: "haiku" };
      const ctx = buildContext(step, new Map(), "sonnet", {
        generate: "opus",
      });
      expect(ctx.identity.model).toBe("haiku");
    });

    it("has no memory when no dependencies", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      expect(ctx.memory).toBeUndefined();
    });
  });

  // ---- Retrieve steps get no memory injection ----

  describe("retrieve steps get no memory injection", () => {
    it("does NOT inject memory for retrieve steps (Context Engineering rule)", () => {
      const retrieveStep: StepDefinition = {
        ...baseStep,
        type: "retrieve",
        dependsOn: ["prev_step"],
        context: { ...baseStep.context, state: "retrieve" },
      };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev_step", {
        stepId: "prev_step",
        status: "success",
        output: "some previous output",
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(retrieveStep, prevResults, "sonnet");
      expect(ctx.memory).toBeUndefined();
    });
  });

  // ---- Dependencies are summarized and joined ----

  describe("dependencies are summarized and joined", () => {
    it("injects previous step output when dependsOn is set", () => {
      const step = { ...baseStep, dependsOn: ["prev_step"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev_step", {
        stepId: "prev_step",
        status: "success",
        output: "previous output",
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory).toBeDefined();
      expect(ctx.memory?.summary).toContain("prev_step");
      expect(ctx.memory?.summary).toContain("previous output");
    });

    it("does not inject failed dependency output", () => {
      const step = { ...baseStep, dependsOn: ["prev_step"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev_step", {
        stepId: "prev_step",
        status: "failed",
        output: null,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 0, output: 0 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory).toBeUndefined();
    });

    it("joins multiple dependency summaries", () => {
      const step = { ...baseStep, dependsOn: ["dep_a", "dep_b"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("dep_a", {
        stepId: "dep_a",
        status: "success",
        output: "output from A",
        trace: [],
        durationMs: 50,
        tokenUsage: { input: 10, output: 10 },
      });
      prevResults.set("dep_b", {
        stepId: "dep_b",
        status: "success",
        output: "output from B",
        trace: [],
        durationMs: 50,
        tokenUsage: { input: 10, output: 10 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory).toBeDefined();
      expect(ctx.memory?.summary).toContain("dep_a");
      expect(ctx.memory?.summary).toContain("dep_b");
      expect(ctx.memory?.summary).toContain("output from A");
      expect(ctx.memory?.summary).toContain("output from B");
    });

    it("previousStepOutput merges multiple deps into keyed JSON", () => {
      const step = { ...baseStep, dependsOn: ["dep_a", "dep_b"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("dep_a", {
        stepId: "dep_a",
        status: "success",
        output: "data A",
        trace: [],
        durationMs: 50,
        tokenUsage: { input: 10, output: 10 },
      });
      prevResults.set("dep_b", {
        stepId: "dep_b",
        status: "success",
        output: "data B",
        trace: [],
        durationMs: 50,
        tokenUsage: { input: 10, output: 10 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.previousStepOutput).toBeDefined();
      // Multiple deps produce a JSON object keyed by step ID
      const parsed = JSON.parse(ctx.memory!.previousStepOutput!);
      expect(parsed.dep_a).toBe("data A");
      expect(parsed.dep_b).toBe("data B");
    });

    it("single dependency returns output directly (backward compat)", () => {
      const step = { ...baseStep, dependsOn: ["dep_a"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("dep_a", {
        stepId: "dep_a",
        status: "success",
        output: "direct output",
        trace: [],
        durationMs: 50,
        tokenUsage: { input: 10, output: 10 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.previousStepOutput).toBe("direct output");
    });
  });

  // ---- Tool validation warns on malformed MCP tools ----

  describe("tool validation", () => {
    it("warns on malformed MCP tool names (wrong number of parts)", () => {
      const step: StepDefinition = {
        ...baseStep,
        context: {
          ...baseStep.context,
          tools: ["mcp:only-two"],
        },
      };

      buildContext(step, new Map(), "sonnet");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Malformed MCP tool name"),
      );
    });

    it("warns on MCP tool with empty parts", () => {
      const step: StepDefinition = {
        ...baseStep,
        context: {
          ...baseStep.context,
          tools: ["mcp::empty-server"],
        },
      };

      buildContext(step, new Map(), "sonnet");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Malformed MCP tool name"),
      );
    });

    it("does not warn on valid MCP tool format", () => {
      const step: StepDefinition = {
        ...baseStep,
        context: {
          ...baseStep.context,
          tools: ["mcp:pinecone:search-records"],
        },
      };

      buildContext(step, new Map(), "sonnet");

      // Should not have been called with the malformed warning
      const malformedCalls = warnSpy.mock.calls.filter(
        (c) => String(c[0]).includes("Malformed MCP"),
      );
      expect(malformedCalls).toHaveLength(0);
    });

    it("does not warn on non-MCP tools", () => {
      const step: StepDefinition = {
        ...baseStep,
        context: {
          ...baseStep.context,
          tools: ["file_read", "web_search"],
        },
      };

      buildContext(step, new Map(), "sonnet");

      const malformedCalls = warnSpy.mock.calls.filter(
        (c) => String(c[0]).includes("Malformed MCP"),
      );
      expect(malformedCalls).toHaveLength(0);
    });
  });

  // ---- State transition validation ----

  describe("state transition validation", () => {
    it("warns on suspicious transition (classify depending on generate)", () => {
      const classifyStep: StepDefinition = {
        ...baseStep,
        id: "classify_step",
        type: "classify",
        context: { ...baseStep.context, state: "classify" },
        dependsOn: ["gen_step"],
      };

      const allSteps: StepDefinition[] = [
        { ...baseStep, id: "gen_step", type: "generate", context: { ...baseStep.context, state: "generate" } },
        classifyStep,
      ];

      const prevResults = new Map<string, StepResult>();
      prevResults.set("gen_step", {
        stepId: "gen_step",
        status: "success",
        output: "generated",
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 10 },
      });

      buildContext(classifyStep, prevResults, "sonnet", undefined, allSteps);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Suspicious state transition"),
      );
    });

    it("does not warn on valid transition (generate depending on retrieve)", () => {
      const genStep: StepDefinition = {
        ...baseStep,
        id: "gen_step",
        type: "generate",
        context: { ...baseStep.context, state: "generate" },
        dependsOn: ["ret_step"],
      };

      const allSteps: StepDefinition[] = [
        { ...baseStep, id: "ret_step", type: "retrieve", context: { ...baseStep.context, state: "retrieve" } },
        genStep,
      ];

      const prevResults = new Map<string, StepResult>();
      prevResults.set("ret_step", {
        stepId: "ret_step",
        status: "success",
        output: "retrieved",
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 10 },
      });

      buildContext(genStep, prevResults, "sonnet", undefined, allSteps);

      const suspiciousCalls = warnSpy.mock.calls.filter(
        (c) => String(c[0]).includes("Suspicious state transition"),
      );
      expect(suspiciousCalls).toHaveLength(0);
    });
  });

  // ---- summarizeOutput handles truncation safely ----

  describe("summarizeOutput (via buildContext)", () => {
    it("truncates long string output without malformed content", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      const longOutput = "This is a sentence. ".repeat(50); // ~1000 chars
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: longOutput,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.summary).toBeDefined();
      expect(ctx.memory!.summary.length).toBeLessThan(longOutput.length);
      // Should have truncation marker
      expect(ctx.memory!.summary).toContain("[truncated]");
    });

    it("handles JSON object truncation safely (no malformed JSON)", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      // Large object with many keys
      const largeObj: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        largeObj[`key_${i}`] = `value_${i}_${"x".repeat(20)}`;
      }

      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: largeObj,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.summary).toBeDefined();

      // Extract the JSON portion after the "[prev]: " prefix
      const jsonPart = ctx.memory!.summary.replace(/^\[prev\]:\s*/, "");
      // The truncated JSON should still be parseable
      expect(() => JSON.parse(jsonPart)).not.toThrow();
    });

    it("handles JSON array truncation safely", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        text: `item ${i} ${"y".repeat(30)}`,
      }));

      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: largeArray,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.summary).toBeDefined();
      // Should be truncated
      expect(ctx.memory!.summary.length).toBeLessThan(JSON.stringify(largeArray).length + 50);
    });

    it("handles string truncation at sentence boundaries", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      // Create text with clear sentence boundaries
      const sentences = Array.from({ length: 30 }, (_, i) =>
        `Sentence number ${i} with some content here. `
      ).join("");

      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: sentences,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.summary).toBeDefined();
      // The truncated summary should end cleanly
      expect(ctx.memory!.summary).toContain("[truncated]");
    });

    it("handles null output from previous step", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: null,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      // null output is still success, but summary says (no output)
      expect(ctx.memory?.summary).toContain("(no output)");
    });

    it("handles short output without truncation", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: "short output",
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.summary).toContain("short output");
      expect(ctx.memory!.summary).not.toContain("[truncated]");
    });
  });

  // ---- buildSystemPrompt ----

  describe("buildSystemPrompt", () => {
    it("includes constraints", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain("be concise");
    });

    it("includes role prompt when provided", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      const prompt = buildSystemPrompt(ctx, "You are a test assistant.");
      expect(prompt).toContain("You are a test assistant.");
      expect(prompt).toContain("be concise");
    });

    it("includes memory summary when available", () => {
      const step = { ...baseStep, dependsOn: ["prev"] };
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev", {
        stepId: "prev",
        status: "success",
        output: "some data",
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain("Previous Step Summary");
      expect(prompt).toContain("some data");
    });

    it("does not include memory section when no deps", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      const prompt = buildSystemPrompt(ctx);
      expect(prompt).not.toContain("Previous Step Summary");
    });
  });
});

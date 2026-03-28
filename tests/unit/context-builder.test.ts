import { describe, it, expect } from "vitest";
import { buildContext, buildSystemPrompt } from "../../src/core/context-builder.js";
import type { StepDefinition, StepResult } from "../../src/types/index.js";

describe("Context Builder", () => {
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

  describe("buildContext", () => {
    it("creates context with default model when step has no model", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      expect(ctx.identity.model).toBe("sonnet");
      expect(ctx.identity.role).toBe("tester");
      expect(ctx.tools).toEqual(["file_read"]);
    });

    it("uses step model override when present", () => {
      const step = { ...baseStep, model: "haiku" };
      const ctx = buildContext(step, new Map(), "sonnet");
      expect(ctx.identity.model).toBe("haiku");
    });

    it("has no memory when no dependencies", () => {
      const ctx = buildContext(baseStep, new Map(), "sonnet");
      expect(ctx.memory).toBeUndefined();
    });

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

    it("truncates long outputs in summary", () => {
      const step = { ...baseStep, dependsOn: ["prev_step"] };
      const longOutput = "x".repeat(1000);
      const prevResults = new Map<string, StepResult>();
      prevResults.set("prev_step", {
        stepId: "prev_step",
        status: "success",
        output: longOutput,
        trace: [],
        durationMs: 100,
        tokenUsage: { input: 10, output: 20 },
      });

      const ctx = buildContext(step, prevResults, "sonnet");
      expect(ctx.memory?.summary).toBeDefined();
      expect(ctx.memory!.summary.length).toBeLessThan(longOutput.length);
    });
  });

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
      expect(prompt).toContain("some data");
    });
  });
});

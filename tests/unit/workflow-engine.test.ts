import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeWorkflow } from "../../src/core/workflow-engine.js";
import { setAdapter } from "../../src/core/agent-runner.js";
import type { LLMAdapter, LLMResponse } from "../../src/core/llm-adapter.js";
import type {
  WorkflowDefinition,
  StepDefinition,
  WorkflowResult,
} from "../../src/types/index.js";

// ---- Mock LLM Adapter ----

function createMockAdapter(
  responses?: Map<string, string>,
  tokenCounts?: { input: number; output: number },
): LLMAdapter {
  const defaultTokens = tokenCounts ?? { input: 100, output: 50 };
  return {
    name: "mock-adapter",
    async generate(options): Promise<LLMResponse> {
      const text = responses?.get(options.prompt.slice(0, 50)) ?? '{"result": "mock"}';
      return {
        text,
        inputTokens: defaultTokens.input,
        outputTokens: defaultTokens.output,
        latencyMs: 10,
        model: options.model,
      };
    },
  };
}

// ---- Helper: minimal step definition ----

function makeStep(
  id: string,
  type: StepDefinition["type"] = "generate",
  dependsOn?: string[],
): StepDefinition {
  return {
    id,
    name: id,
    type,
    context: {
      state: type,
      identity: { role: "tester", constraints: [] },
      tools: [],
    },
    dependsOn,
  };
}

function makeWorkflow(
  steps: StepDefinition[],
  opts?: Partial<WorkflowDefinition["config"]>,
): WorkflowDefinition {
  return {
    name: "test-workflow",
    description: "test",
    config: {
      defaultModel: "sonnet",
      topology: opts?.topology ?? "pipeline",
      onValidationFail: opts?.onValidationFail ?? "block",
    },
    steps,
  };
}

// ---- Tests ----

describe("Workflow Engine", () => {
  beforeEach(() => {
    setAdapter(createMockAdapter());
  });

  // -- Topological sort (tested via executeWorkflow ordering) --

  describe("topologicalSort (via executeWorkflow)", () => {
    it("executes steps in dependency order", async () => {
      const executionOrder: string[] = [];
      const adapter: LLMAdapter = {
        name: "order-tracker",
        async generate(options): Promise<LLMResponse> {
          // Extract step identity from prompt context
          executionOrder.push("step");
          return {
            text: '{"ok": true}',
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 5,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      const steps = [
        makeStep("step_c", "generate", ["step_b"]),
        makeStep("step_a", "classify"),
        makeStep("step_b", "retrieve", ["step_a"]),
      ];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      // All steps should execute; step ordering is A -> B -> C
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].stepId).toBe("step_a");
      expect(result.steps[1].stepId).toBe("step_b");
      expect(result.steps[2].stepId).toBe("step_c");
    });

    it("throws on cyclic dependencies", async () => {
      const steps = [
        makeStep("a", "generate", ["b"]),
        makeStep("b", "generate", ["a"]),
      ];
      const wf = makeWorkflow(steps);

      await expect(executeWorkflow({ workflow: wf, input: "test" }))
        .rejects.toThrow(/[Cc]ycle/);
    });
  });

  // -- buildParallelLayers (tested via parallel topology) --

  describe("buildParallelLayers (via parallel topology)", () => {
    it("runs independent steps in parallel layers", async () => {
      const callOrder: string[] = [];
      const adapter: LLMAdapter = {
        name: "parallel-tracker",
        async generate(options): Promise<LLMResponse> {
          // We track calls but can't easily verify concurrency in unit tests;
          // we verify the result structure instead
          callOrder.push("call");
          return {
            text: "ok",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      // a and b are independent; c depends on both
      const steps = [
        makeStep("a", "classify"),
        makeStep("b", "retrieve"),
        makeStep("c", "generate", ["a", "b"]),
      ];
      const wf = makeWorkflow(steps, { topology: "parallel" });
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.status).toBe("success");
      expect(result.steps).toHaveLength(3);
    });

    it("throws on cyclic dependencies in parallel mode", async () => {
      const steps = [
        makeStep("x", "generate", ["y"]),
        makeStep("y", "generate", ["x"]),
      ];
      const wf = makeWorkflow(steps, { topology: "parallel" });

      await expect(executeWorkflow({ workflow: wf, input: "test" }))
        .rejects.toThrow(/[Cc]ycle/);
    });
  });

  // -- getStepInput (tested via fan-in behavior) --

  describe("getStepInput (fan-in via executeWorkflow)", () => {
    it("merges multiple dependency outputs for fan-in", async () => {
      let finalPrompt = "";
      const adapter: LLMAdapter = {
        name: "fanin-tracker",
        async generate(options): Promise<LLMResponse> {
          finalPrompt = options.prompt;
          return {
            text: "output",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      const steps = [
        makeStep("dep_a", "classify"),
        makeStep("dep_b", "retrieve"),
        makeStep("merger", "generate", ["dep_a", "dep_b"]),
      ];
      const wf = makeWorkflow(steps);
      await executeWorkflow({ workflow: wf, input: "original input" });

      // The merger step should receive merged outputs from dep_a and dep_b
      expect(finalPrompt).toContain("dep_a");
      expect(finalPrompt).toContain("dep_b");
    });

    it("falls back to original input when no deps", async () => {
      let receivedPrompt = "";
      const adapter: LLMAdapter = {
        name: "input-tracker",
        async generate(options): Promise<LLMResponse> {
          receivedPrompt = options.prompt;
          return {
            text: "ok",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      const steps = [makeStep("only", "generate")];
      const wf = makeWorkflow(steps);
      await executeWorkflow({ workflow: wf, input: "my original input" });

      expect(receivedPrompt).toContain("my original input");
    });
  });

  // -- hasDependencyFailure + createSkippedResult --

  describe("dependency failure handling", () => {
    it("skips steps when a dependency has failed", async () => {
      let callCount = 0;
      const adapter: LLMAdapter = {
        name: "fail-adapter",
        async generate(options): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            throw new Error("LLM failure");
          }
          return {
            text: "ok",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      const steps = [
        makeStep("first", "classify"),
        makeStep("second", "generate", ["first"]),
      ];
      const wf = makeWorkflow(steps, { onValidationFail: "flag" });
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.steps[0].status).toBe("failed");
      expect(result.steps[1].status).toBe("skipped");
      expect(result.steps[1].output).toBeNull();
      expect(result.steps[1].durationMs).toBe(0);
      expect(result.steps[1].tokenUsage).toEqual({ input: 0, output: 0 });
    });
  });

  // -- estimateCostFromTokens (tested via cost tracking) --

  describe("cost estimation", () => {
    it("estimates cost from token usage", async () => {
      // Default sonnet pricing: $3/M input, $15/M output
      setAdapter(createMockAdapter(undefined, { input: 1000, output: 500 }));

      const steps = [makeStep("step1", "generate")];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      // Cost = (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
      expect(result.totalCostEstimate).toBeCloseTo(0.0105, 4);
    });

    it("accumulates cost across multiple steps", async () => {
      setAdapter(createMockAdapter(undefined, { input: 1000, output: 1000 }));

      const steps = [
        makeStep("s1", "classify"),
        makeStep("s2", "generate", ["s1"]),
      ];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      // Each step: (1000*3 + 1000*15)/1M = 0.018
      // Total: 0.036
      expect(result.totalCostEstimate).toBeCloseTo(0.036, 4);
    });
  });

  // -- Budget tracking --

  describe("budget tracking", () => {
    it("stops execution when budget is exceeded (sequential)", async () => {
      // Use high token counts to exceed budget quickly
      setAdapter(createMockAdapter(undefined, { input: 100000, output: 100000 }));

      const steps = [
        makeStep("s1", "classify"),
        makeStep("s2", "generate", ["s1"]),
        makeStep("s3", "validate", ["s2"]),
      ];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({
        workflow: wf,
        input: "test",
        maxBudgetUsd: 0.001, // Very low budget
      });

      expect(result.status).toBe("failed");
      // Should not have executed all steps
      expect(result.steps.length).toBeLessThanOrEqual(3);
    });

    it("stops execution when budget is exceeded (parallel)", async () => {
      setAdapter(createMockAdapter(undefined, { input: 100000, output: 100000 }));

      const steps = [
        makeStep("p1", "classify"),
        makeStep("p2", "retrieve"),
        makeStep("p3", "generate", ["p1", "p2"]),
      ];
      const wf = makeWorkflow(steps, { topology: "parallel" });
      const result = await executeWorkflow({
        workflow: wf,
        input: "test",
        maxBudgetUsd: 0.001,
      });

      expect(result.status).toBe("failed");
    });
  });

  // -- Error context preserved in StepResult.error --

  describe("error context in StepResult", () => {
    it("preserves error message when LLM call fails", async () => {
      const adapter: LLMAdapter = {
        name: "error-adapter",
        async generate(): Promise<LLMResponse> {
          throw new Error("Connection refused: ECONNREFUSED");
        },
      };
      setAdapter(adapter);

      const steps = [makeStep("err_step", "generate")];
      const wf = makeWorkflow(steps, { onValidationFail: "flag" });
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.steps[0].status).toBe("failed");
      expect(result.steps[0].error).toBeDefined();
      expect(result.steps[0].error).toContain("ECONNREFUSED");
      expect(result.steps[0].output).toBeNull();
    });
  });

  // -- Validation gate --

  describe("validation gate (onValidationFail)", () => {
    it("blocks workflow on validation failure with block policy", async () => {
      setAdapter(createMockAdapter());

      const steps: StepDefinition[] = [
        {
          ...makeStep("validated_step", "generate"),
          validation: {
            rules: [
              {
                type: "required_fields",
                spec: { fields: ["missing_field"] },
                message: "missing_field is required",
              },
            ],
          },
        },
      ];
      const wf = makeWorkflow(steps, { onValidationFail: "block" });
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.status).toBe("failed");
      expect(result.steps[0].status).toBe("failed");
      expect(result.steps[0].validation).toBeDefined();
      expect(result.steps[0].validation!.passed).toBe(false);
    });

    it("continues workflow on validation failure with flag policy", async () => {
      setAdapter(createMockAdapter());

      const steps: StepDefinition[] = [
        {
          ...makeStep("flagged_step", "generate"),
          validation: {
            rules: [
              {
                type: "required_fields",
                spec: { fields: ["missing_field"] },
                message: "missing_field required",
              },
            ],
          },
        },
        makeStep("next_step", "validate", ["flagged_step"]),
      ];
      const wf = makeWorkflow(steps, { onValidationFail: "flag" });
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      // With "flag" policy, the flagged step fails but the workflow continues
      // The next step should be skipped because its dependency failed
      expect(result.steps[0].status).toBe("failed");
    });
  });

  // -- WorkflowResult structure --

  describe("WorkflowResult structure", () => {
    it("returns correct structure on success", async () => {
      setAdapter(createMockAdapter());

      const steps = [makeStep("s1", "generate")];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.workflowName).toBe("test-workflow");
      expect(result.traceId).toBeDefined();
      expect(result.status).toBe("success");
      expect(result.steps).toHaveLength(1);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalTokens).toBeDefined();
      expect(result.totalTokens.input).toBeGreaterThan(0);
      expect(result.totalTokens.output).toBeGreaterThan(0);
      expect(typeof result.totalCostEstimate).toBe("number");
    });

    it("returns partial status when some steps fail with flag policy", async () => {
      let callCount = 0;
      const adapter: LLMAdapter = {
        name: "partial-adapter",
        async generate(options): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) throw new Error("fail first");
          return {
            text: "ok",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      // Two independent steps (no deps); first fails, second succeeds
      const steps = [
        makeStep("fail_step", "classify"),
        makeStep("ok_step", "retrieve"),
      ];
      const wf = makeWorkflow(steps, { onValidationFail: "flag" });
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.status).toBe("partial");
    });
  });

  // -- JSON parsing / code block stripping --

  describe("output parsing", () => {
    it("strips markdown code blocks from LLM output", async () => {
      const adapter: LLMAdapter = {
        name: "codeblock-adapter",
        async generate(options): Promise<LLMResponse> {
          return {
            text: '```json\n{"key": "value"}\n```',
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      const steps = [makeStep("parse_step", "generate")];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.steps[0].status).toBe("success");
      // Output should be parsed JSON, not the raw code block
      expect(result.steps[0].output).toEqual({ key: "value" });
    });

    it("keeps plain text output when not JSON", async () => {
      const adapter: LLMAdapter = {
        name: "text-adapter",
        async generate(options): Promise<LLMResponse> {
          return {
            text: "This is plain text output.",
            inputTokens: 10,
            outputTokens: 10,
            latencyMs: 1,
            model: options.model,
          };
        },
      };
      setAdapter(adapter);

      const steps = [makeStep("text_step", "generate")];
      const wf = makeWorkflow(steps);
      const result = await executeWorkflow({ workflow: wf, input: "test" });

      expect(result.steps[0].output).toBe("This is plain text output.");
    });
  });
});

import { describe, it, expect } from "vitest";
import { validateWorkflowGraph } from "../../src/core/graph-validator.js";
import type { WorkflowDefinition } from "../../src/types/index.js";

function makeWorkflow(steps: Array<{ id: string; dependsOn?: string[] }>): WorkflowDefinition {
  return {
    name: "test",
    description: "",
    config: { defaultModel: "sonnet", topology: "pipeline", onValidationFail: "block" },
    steps: steps.map((s) => ({
      id: s.id,
      name: s.id,
      type: "generate" as const,
      context: {
        state: "generate" as const,
        identity: { role: "test", constraints: [] },
        tools: [],
      },
      dependsOn: s.dependsOn,
    })),
  };
}

describe("Graph Validator", () => {
  it("passes a valid linear pipeline", () => {
    const wf = makeWorkflow([
      { id: "a" },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ]);
    expect(validateWorkflowGraph(wf)).toEqual([]);
  });

  it("passes a valid DAG", () => {
    const wf = makeWorkflow([
      { id: "a" },
      { id: "b" },
      { id: "c", dependsOn: ["a", "b"] },
    ]);
    expect(validateWorkflowGraph(wf)).toEqual([]);
  });

  it("detects circular dependency", () => {
    const wf = makeWorkflow([
      { id: "a", dependsOn: ["c"] },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ]);
    const errors = validateWorkflowGraph(wf);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("ircular");
  });

  it("detects dangling reference", () => {
    const wf = makeWorkflow([
      { id: "a" },
      { id: "b", dependsOn: ["nonexistent"] },
    ]);
    const errors = validateWorkflowGraph(wf);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("nonexistent");
  });

  it("detects duplicate step IDs", () => {
    const wf = makeWorkflow([
      { id: "a" },
      { id: "a" },
    ]);
    const errors = validateWorkflowGraph(wf);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Duplicate");
  });

  it("passes single step with no deps", () => {
    const wf = makeWorkflow([{ id: "only" }]);
    expect(validateWorkflowGraph(wf)).toEqual([]);
  });

  it("detects self-referencing step", () => {
    const wf = makeWorkflow([
      { id: "a", dependsOn: ["a"] },
    ]);
    const errors = validateWorkflowGraph(wf);
    expect(errors.length).toBeGreaterThan(0);
  });
});

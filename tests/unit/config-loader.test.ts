import { describe, it, expect } from "vitest";
import { workflowSchema, projectConfigSchema } from "../../src/config/schemas.js";

describe("Config Schemas", () => {
  describe("workflowSchema", () => {
    it("validates a minimal workflow", () => {
      const result = workflowSchema.safeParse({
        name: "test",
        config: {
          defaultModel: "sonnet",
          topology: "pipeline",
          onValidationFail: "block",
        },
        steps: [
          {
            id: "step1",
            name: "Step 1",
            type: "classify",
            context: {
              state: "classify",
              identity: { role: "tester" },
              tools: [],
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects workflow without steps", () => {
      const result = workflowSchema.safeParse({
        name: "test",
        config: {
          defaultModel: "sonnet",
          topology: "pipeline",
          onValidationFail: "block",
        },
        steps: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid topology", () => {
      const result = workflowSchema.safeParse({
        name: "test",
        config: {
          defaultModel: "sonnet",
          topology: "invalid",
          onValidationFail: "block",
        },
        steps: [
          {
            id: "s1",
            name: "S1",
            type: "classify",
            context: {
              state: "classify",
              identity: { role: "r" },
              tools: [],
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("validates step with evaluation config", () => {
      const result = workflowSchema.safeParse({
        name: "test",
        config: {
          defaultModel: "sonnet",
          topology: "pipeline",
          onValidationFail: "block",
        },
        steps: [
          {
            id: "s1",
            name: "S1",
            type: "generate",
            context: {
              state: "generate",
              identity: { role: "gen" },
              tools: [],
            },
            evaluation: {
              enabled: true,
              type: "groundedness",
              threshold: 0.7,
              onFail: "flag",
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("projectConfigSchema", () => {
    it("validates minimal config", () => {
      const result = projectConfigSchema.safeParse({
        model: { default: "sonnet" },
      });
      expect(result.success).toBe(true);
    });

    it("validates config with trace outputs", () => {
      const result = projectConfigSchema.safeParse({
        model: { default: "sonnet" },
        trace: {
          outputs: [
            { type: "stdout" },
            { type: "jsonl", config: { path: "./traces" } },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty model default", () => {
      const result = projectConfigSchema.safeParse({
        model: { default: "" },
      });
      expect(result.success).toBe(false);
    });
  });
});

import { describe, it, expect } from "vitest";
import { validateOutput } from "../../src/eval/tier1-rules.js";
import type { ValidationRule } from "../../src/types/index.js";

describe("Tier 1 Rules", () => {
  describe("required_fields", () => {
    const rule: ValidationRule = {
      type: "required_fields",
      spec: { fields: ["topics", "summary"] },
      message: "topics and summary required",
    };

    it("passes when all fields present", () => {
      const result = validateOutput(
        { topics: ["a", "b"], summary: "test" },
        [rule],
      );
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("fails when field missing", () => {
      const result = validateOutput({ topics: ["a"] }, [rule]);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
    });

    it("fails when field is empty string", () => {
      const result = validateOutput({ topics: ["a"], summary: "" }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails when field is null", () => {
      const result = validateOutput({ topics: ["a"], summary: null }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails on non-object input", () => {
      const result = validateOutput("just a string", [rule]);
      expect(result.passed).toBe(false);
    });
  });

  describe("schema", () => {
    const rule: ValidationRule = {
      type: "schema",
      spec: { topics: "array", minItems: 1 },
      message: "topics must be non-empty array",
    };

    it("passes with valid array", () => {
      const result = validateOutput({ topics: ["a"] }, [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails with empty array when minItems set", () => {
      const result = validateOutput({ topics: [] }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails when field is not array", () => {
      const result = validateOutput({ topics: "not array" }, [rule]);
      expect(result.passed).toBe(false);
    });
  });

  describe("regex", () => {
    const rule: ValidationRule = {
      type: "regex",
      spec: { pattern: "^https?://", field: "urls" },
      message: "URLs must start with http/https",
    };

    it("passes with valid URLs", () => {
      const result = validateOutput(
        { urls: ["https://example.com", "http://test.com"] },
        [rule],
      );
      expect(result.passed).toBe(true);
    });

    it("fails with invalid URL", () => {
      const result = validateOutput(
        { urls: ["https://ok.com", "ftp://bad.com"] },
        [rule],
      );
      expect(result.passed).toBe(false);
    });
  });

  describe("length", () => {
    it("passes when within range", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { min: 10, max: 100 },
        message: "length out of range",
      };
      const result = validateOutput("this is a valid length string", [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails when too short", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { min: 100 },
        message: "too short",
      };
      const result = validateOutput("short", [rule]);
      expect(result.passed).toBe(false);
    });
  });

  describe("format", () => {
    it("passes valid JSON", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "json" },
        message: "must be JSON",
      };
      const result = validateOutput('{"key": "value"}', [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails invalid JSON", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "json" },
        message: "must be JSON",
      };
      const result = validateOutput("not json at all", [rule]);
      expect(result.passed).toBe(false);
    });
  });

  describe("custom", () => {
    it("reference_consistency passes with matching refs", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "reference_consistency" },
        message: "ref mismatch",
      };
      const text = "Some claim [1] and another [2].\n\n## Reference\n(1) https://a.com\n(2) https://b.com";
      const result = validateOutput(text, [rule]);
      expect(result.passed).toBe(true);
    });

    it("no_empty_sections fails with empty section", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "no_empty_sections" },
        message: "empty section",
      };
      const text = "# Title\nContent here\n## Empty\n\n## Another\nMore content";
      const result = validateOutput(text, [rule]);
      expect(result.passed).toBe(false);
    });
  });

  describe("multiple rules", () => {
    it("all pass", () => {
      const rules: ValidationRule[] = [
        { type: "required_fields", spec: { fields: ["a"] }, message: "a required" },
        { type: "length", spec: { min: 5 }, message: "too short" },
      ];
      const result = validateOutput({ a: "hello world" }, rules);
      expect(result.passed).toBe(true);
    });

    it("collects all failures", () => {
      const rules: ValidationRule[] = [
        { type: "required_fields", spec: { fields: ["a", "b"] }, message: "fields required" },
        { type: "length", spec: { min: 1000 }, message: "too short" },
      ];
      const result = validateOutput({}, rules);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(2);
    });
  });
});

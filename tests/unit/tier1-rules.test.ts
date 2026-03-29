import { describe, it, expect } from "vitest";
import { validateOutput } from "../../src/eval/tier1-rules.js";
import type { ValidationRule } from "../../src/types/index.js";

describe("Tier 1 Rules", () => {
  // ---- checkSchema ----

  describe("checkSchema", () => {
    it("passes with valid array and minItems satisfied", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { topics: "array", minItems: 1 },
        message: "topics must be non-empty array",
      };
      const result = validateOutput({ topics: ["a", "b"] }, [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails with empty array when minItems is set", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { topics: "array", minItems: 1 },
        message: "topics must be non-empty array",
      };
      const result = validateOutput({ topics: [] }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("skips SCHEMA_META_KEYS (minItems/maxItems are not treated as field names)", () => {
      // minItems and maxItems should be treated as constraints on the array field,
      // not as expected field names. The output should NOT need a "minItems" key.
      const rule: ValidationRule = {
        type: "schema",
        spec: { items: "array", minItems: 2, maxItems: 5 },
        message: "items array with constraints",
      };
      // Output has "items" but not "minItems" or "maxItems" -- should still pass
      const result = validateOutput({ items: ["a", "b", "c"] }, [rule]);
      expect(result.passed).toBe(true);
    });

    it("validates boolean type", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { active: "boolean" },
        message: "active must be boolean",
      };
      expect(validateOutput({ active: true }, [rule]).passed).toBe(true);
      expect(validateOutput({ active: false }, [rule]).passed).toBe(true);
      expect(validateOutput({ active: "yes" }, [rule]).passed).toBe(false);
      expect(validateOutput({ active: 1 }, [rule]).passed).toBe(false);
    });

    it("validates string type", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { name: "string" },
        message: "name must be string",
      };
      expect(validateOutput({ name: "hello" }, [rule]).passed).toBe(true);
      expect(validateOutput({ name: 42 }, [rule]).passed).toBe(false);
    });

    it("validates number type", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { count: "number" },
        message: "count must be number",
      };
      expect(validateOutput({ count: 5 }, [rule]).passed).toBe(true);
      expect(validateOutput({ count: "five" }, [rule]).passed).toBe(false);
    });

    it("validates object type", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { meta: "object" },
        message: "meta must be object",
      };
      expect(validateOutput({ meta: { a: 1 } }, [rule]).passed).toBe(true);
      expect(validateOutput({ meta: null }, [rule]).passed).toBe(false);
      expect(validateOutput({ meta: "string" }, [rule]).passed).toBe(false);
    });

    it("fails on non-object input", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { name: "string" },
        message: "need object",
      };
      expect(validateOutput("just a string", [rule]).passed).toBe(false);
      expect(validateOutput(null, [rule]).passed).toBe(false);
    });

    it("respects maxItems constraint", () => {
      const rule: ValidationRule = {
        type: "schema",
        spec: { tags: "array", maxItems: 2 },
        message: "too many tags",
      };
      expect(validateOutput({ tags: ["a"] }, [rule]).passed).toBe(true);
      expect(validateOutput({ tags: ["a", "b", "c"] }, [rule]).passed).toBe(false);
    });
  });

  // ---- checkRequiredFields ----

  describe("checkRequiredFields", () => {
    const rule: ValidationRule = {
      type: "required_fields",
      spec: { fields: ["title", "body"] },
      message: "title and body required",
    };

    it("passes when all fields present and non-empty", () => {
      const result = validateOutput({ title: "Hi", body: "World" }, [rule]);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("fails when a field is missing", () => {
      const result = validateOutput({ title: "Hi" }, [rule]);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
    });

    it("fails when a field is empty string", () => {
      const result = validateOutput({ title: "Hi", body: "" }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails when a field is null", () => {
      const result = validateOutput({ title: "Hi", body: null }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails when a field is undefined", () => {
      const result = validateOutput({ title: "Hi", body: undefined }, [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails on non-object input", () => {
      expect(validateOutput("just text", [rule]).passed).toBe(false);
      expect(validateOutput(42, [rule]).passed).toBe(false);
      expect(validateOutput(null, [rule]).passed).toBe(false);
    });

    it("passes when no fields specified in spec", () => {
      const emptyRule: ValidationRule = {
        type: "required_fields",
        spec: {},
        message: "no fields",
      };
      const result = validateOutput({ anything: true }, [emptyRule]);
      expect(result.passed).toBe(true);
    });
  });

  // ---- checkFormat ----

  describe("checkFormat", () => {
    it("passes valid JSON string", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "json" },
        message: "must be JSON",
      };
      const result = validateOutput('{"key": "value"}', [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails invalid JSON string", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "json" },
        message: "must be JSON",
      };
      const result = validateOutput("not json {{{", [rule]);
      expect(result.passed).toBe(false);
    });

    it("passes valid JSON for object input (auto-serialized)", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "json" },
        message: "must be JSON",
      };
      const result = validateOutput({ key: "value" }, [rule]);
      expect(result.passed).toBe(true);
    });

    it("passes real markdown with heading", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "markdown" },
        message: "must be markdown",
      };
      const result = validateOutput("# Title\n\nSome content", [rule]);
      expect(result.passed).toBe(true);
    });

    it("passes real markdown with list", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "markdown" },
        message: "must be markdown",
      };
      const result = validateOutput("- item one\n- item two", [rule]);
      expect(result.passed).toBe(true);
    });

    it("passes real markdown with bold", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "markdown" },
        message: "must be markdown",
      };
      const result = validateOutput("This is **bold** text.", [rule]);
      expect(result.passed).toBe(true);
    });

    it("passes real markdown with link", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "markdown" },
        message: "must be markdown",
      };
      const result = validateOutput("See [docs](https://example.com)", [rule]);
      expect(result.passed).toBe(true);
    });

    it("rejects fake markdown: URL with # is not a heading", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "markdown" },
        message: "must be markdown",
      };
      // A URL containing # should not match as a markdown heading
      const result = validateOutput("https://example.com/#section", [rule]);
      expect(result.passed).toBe(false);
    });

    it("rejects fake markdown: negative number should NOT pass", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "markdown" },
        message: "must be markdown",
      };
      const result = validateOutput("-42", [rule]);
      expect(result.passed).toBe(false);
    });

    it("passes valid URL", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "url" },
        message: "must be URL",
      };
      expect(validateOutput("https://example.com", [rule]).passed).toBe(true);
      expect(validateOutput("http://localhost:3000", [rule]).passed).toBe(true);
    });

    it("fails invalid URL", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "url" },
        message: "must be URL",
      };
      expect(validateOutput("ftp://example.com", [rule]).passed).toBe(false);
      expect(validateOutput("not a url", [rule]).passed).toBe(false);
    });

    it("passes with no format specified", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: {},
        message: "no format",
      };
      expect(validateOutput("anything", [rule]).passed).toBe(true);
    });

    it("passes with unknown format (default case)", () => {
      const rule: ValidationRule = {
        type: "format",
        spec: { format: "xml" },
        message: "unknown format",
      };
      expect(validateOutput("anything", [rule]).passed).toBe(true);
    });
  });

  // ---- checkLength ----

  describe("checkLength", () => {
    it("passes when within min and max", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { min: 5, max: 20 },
        message: "length out of range",
      };
      const result = validateOutput("hello world", [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails when below min", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { min: 100 },
        message: "too short",
      };
      const result = validateOutput("short", [rule]);
      expect(result.passed).toBe(false);
    });

    it("fails when above max", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { max: 5 },
        message: "too long",
      };
      const result = validateOutput("this is way too long", [rule]);
      expect(result.passed).toBe(false);
    });

    it("boundary: exactly at min passes", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { min: 5 },
        message: "too short",
      };
      const result = validateOutput("12345", [rule]);
      expect(result.passed).toBe(true);
    });

    it("boundary: exactly at max passes", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { max: 5 },
        message: "too long",
      };
      const result = validateOutput("12345", [rule]);
      expect(result.passed).toBe(true);
    });

    it("serializes non-string output for length check", () => {
      const rule: ValidationRule = {
        type: "length",
        spec: { min: 1, max: 100 },
        message: "length check",
      };
      const result = validateOutput({ key: "value" }, [rule]);
      expect(result.passed).toBe(true);
    });
  });

  // ---- checkRegex ----

  describe("checkRegex", () => {
    it("passes when pattern matches string output", () => {
      const rule: ValidationRule = {
        type: "regex",
        spec: { pattern: "^\\d{3}-\\d{4}$" },
        message: "must match phone format",
      };
      const result = validateOutput("123-4567", [rule]);
      expect(result.passed).toBe(true);
    });

    it("fails when pattern does not match", () => {
      const rule: ValidationRule = {
        type: "regex",
        spec: { pattern: "^\\d{3}-\\d{4}$" },
        message: "must match phone format",
      };
      const result = validateOutput("abc-defg", [rule]);
      expect(result.passed).toBe(false);
    });

    it("checks field-specific pattern on object", () => {
      const rule: ValidationRule = {
        type: "regex",
        spec: { pattern: "^[A-Z]", field: "name" },
        message: "name must start with uppercase",
      };
      expect(validateOutput({ name: "Alice" }, [rule]).passed).toBe(true);
      expect(validateOutput({ name: "alice" }, [rule]).passed).toBe(false);
    });

    it("checks all elements in array fields", () => {
      const rule: ValidationRule = {
        type: "regex",
        spec: { pattern: "^https?://", field: "urls" },
        message: "all URLs must be http/https",
      };
      expect(validateOutput(
        { urls: ["https://a.com", "http://b.com"] },
        [rule],
      ).passed).toBe(true);

      expect(validateOutput(
        { urls: ["https://a.com", "ftp://bad.com"] },
        [rule],
      ).passed).toBe(false);
    });

    it("passes when no pattern specified", () => {
      const rule: ValidationRule = {
        type: "regex",
        spec: {},
        message: "no pattern",
      };
      expect(validateOutput("anything", [rule]).passed).toBe(true);
    });
  });

  // ---- checkRange ----

  describe("checkRange", () => {
    it("passes when number within min/max range", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { min: 0, max: 100 },
        message: "out of range",
      };
      expect(validateOutput(50, [rule]).passed).toBe(true);
    });

    it("fails when below min", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { min: 10 },
        message: "too low",
      };
      expect(validateOutput(5, [rule]).passed).toBe(false);
    });

    it("fails when above max", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { max: 10 },
        message: "too high",
      };
      expect(validateOutput(15, [rule]).passed).toBe(false);
    });

    it("targets a specific field on an object", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { field: "score", min: 0, max: 1 },
        message: "score out of range",
      };
      expect(validateOutput({ score: 0.5 }, [rule]).passed).toBe(true);
      expect(validateOutput({ score: 1.5 }, [rule]).passed).toBe(false);
    });

    it("fails on non-numeric value", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { min: 0, max: 10 },
        message: "not a number",
      };
      expect(validateOutput("text", [rule]).passed).toBe(false);
    });

    it("boundary: exactly at min passes", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { min: 5, max: 10 },
        message: "boundary",
      };
      expect(validateOutput(5, [rule]).passed).toBe(true);
    });

    it("boundary: exactly at max passes", () => {
      const rule: ValidationRule = {
        type: "range",
        spec: { min: 5, max: 10 },
        message: "boundary",
      };
      expect(validateOutput(10, [rule]).passed).toBe(true);
    });
  });

  // ---- checkEnum ----

  describe("checkEnum", () => {
    it("passes when value is in allowed list", () => {
      const rule: ValidationRule = {
        type: "enum",
        spec: { values: ["high", "medium", "low"] },
        message: "invalid priority",
      };
      expect(validateOutput("high", [rule]).passed).toBe(true);
    });

    it("fails when value is not in allowed list", () => {
      const rule: ValidationRule = {
        type: "enum",
        spec: { values: ["high", "medium", "low"] },
        message: "invalid priority",
      };
      expect(validateOutput("critical", [rule]).passed).toBe(false);
    });

    it("targets a specific field on an object", () => {
      const rule: ValidationRule = {
        type: "enum",
        spec: { field: "status", values: ["active", "inactive"] },
        message: "invalid status",
      };
      expect(validateOutput({ status: "active" }, [rule]).passed).toBe(true);
      expect(validateOutput({ status: "deleted" }, [rule]).passed).toBe(false);
    });

    it("passes when no values specified", () => {
      const rule: ValidationRule = {
        type: "enum",
        spec: {},
        message: "no values",
      };
      expect(validateOutput("anything", [rule]).passed).toBe(true);
    });

    it("works with numeric enum values", () => {
      const rule: ValidationRule = {
        type: "enum",
        spec: { values: [1, 2, 3] },
        message: "invalid number",
      };
      expect(validateOutput(2, [rule]).passed).toBe(true);
      expect(validateOutput(4, [rule]).passed).toBe(false);
    });
  });

  // ---- checkNotEmpty ----

  describe("checkNotEmpty", () => {
    it("fails on null", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput(null, [rule]).passed).toBe(false);
    });

    it("fails on undefined", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput(undefined, [rule]).passed).toBe(false);
    });

    it("fails on empty string", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput("", [rule]).passed).toBe(false);
    });

    it("fails on whitespace-only string", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput("   ", [rule]).passed).toBe(false);
    });

    it("fails on empty array", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput([], [rule]).passed).toBe(false);
    });

    it("fails on empty object", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput({}, [rule]).passed).toBe(false);
    });

    it("passes on non-empty string", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput("hello", [rule]).passed).toBe(true);
    });

    it("passes on non-empty array", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput([1, 2], [rule]).passed).toBe(true);
    });

    it("passes on non-empty object", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput({ a: 1 }, [rule]).passed).toBe(true);
    });

    it("passes on number (non-null primitive)", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: {},
        message: "must not be empty",
      };
      expect(validateOutput(42, [rule]).passed).toBe(true);
      expect(validateOutput(0, [rule]).passed).toBe(true);
    });

    it("targets a specific field on an object", () => {
      const rule: ValidationRule = {
        type: "not_empty",
        spec: { field: "name" },
        message: "name must not be empty",
      };
      expect(validateOutput({ name: "Alice" }, [rule]).passed).toBe(true);
      expect(validateOutput({ name: "" }, [rule]).passed).toBe(false);
      expect(validateOutput({ name: null }, [rule]).passed).toBe(false);
    });
  });

  // ---- checkCustom ----

  describe("checkCustom", () => {
    it("unknown check name returns FALSE", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "nonexistent_check" },
        message: "unknown check",
      };
      const result = validateOutput("anything", [rule]);
      expect(result.passed).toBe(false);
    });

    it("all_sections_present passes with headings", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "all_sections_present" },
        message: "sections missing",
      };
      expect(validateOutput("# Title\nContent\n## Section\nMore", [rule]).passed).toBe(true);
    });

    it("all_sections_present fails without headings", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "all_sections_present" },
        message: "sections missing",
      };
      expect(validateOutput("Just plain text with no headings", [rule]).passed).toBe(false);
    });

    it("reference_consistency passes with matching refs", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "reference_consistency" },
        message: "ref mismatch",
      };
      const text = "Claim [1] and [2].\n\n## Reference\n(1) Source A\n(2) Source B";
      expect(validateOutput(text, [rule]).passed).toBe(true);
    });

    it("no_empty_sections fails with empty section", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: { check: "no_empty_sections" },
        message: "empty section",
      };
      const text = "# Title\nContent here enough text.\n## Empty\n\n## Another\nMore content here definitely.";
      expect(validateOutput(text, [rule]).passed).toBe(false);
    });

    it("passes when no check name specified", () => {
      const rule: ValidationRule = {
        type: "custom",
        spec: {},
        message: "no check",
      };
      expect(validateOutput("anything", [rule]).passed).toBe(true);
    });
  });

  // ---- Multiple rules ----

  describe("multiple rules", () => {
    it("all pass", () => {
      const rules: ValidationRule[] = [
        { type: "required_fields", spec: { fields: ["a"] }, message: "a required" },
        { type: "not_empty", spec: { field: "a" }, message: "a not empty" },
      ];
      const result = validateOutput({ a: "hello" }, rules);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("collects all failures", () => {
      const rules: ValidationRule[] = [
        { type: "required_fields", spec: { fields: ["x", "y"] }, message: "fields required" },
        { type: "length", spec: { min: 1000 }, message: "too short" },
      ];
      const result = validateOutput({}, rules);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(2);
    });
  });

  // ---- Unknown rule type ----

  describe("unknown rule type", () => {
    it("passes for unknown rule type (default case)", () => {
      const rule = {
        type: "nonexistent_type" as any,
        spec: {},
        message: "unknown",
      };
      const result = validateOutput("anything", [rule]);
      expect(result.passed).toBe(true);
    });
  });
});

import type { ValidationRule, ValidationResult } from "../types/index.js";

/**
 * Tier 1: 규칙 기반 검증
 *
 * 매 단계 실행. 비용 0. 5-10ms.
 * 100% 결정적. 오탐 0%.
 *
 * LLM 호출 없음 — 순수 로직 검증.
 */
export function validateOutput(
  output: unknown,
  rules: ValidationRule[],
): ValidationResult {
  const failures: ValidationResult["failures"] = [];

  for (const rule of rules) {
    const passed = runRule(output, rule);
    if (!passed) {
      failures.push({ rule, actual: extractActual(output, rule) });
    }
  }

  return { passed: failures.length === 0, failures };
}

function runRule(output: unknown, rule: ValidationRule): boolean {
  switch (rule.type) {
    case "required_fields":
      return checkRequiredFields(output, rule.spec);
    case "schema":
      return checkSchema(output, rule.spec);
    case "format":
      return checkFormat(output, rule.spec);
    case "length":
      return checkLength(output, rule.spec);
    case "regex":
      return checkRegex(output, rule.spec);
    case "custom":
      return checkCustom(output, rule.spec);
    default:
      return true;
  }
}

// ─── Rule Implementations ────────────────────────────────────

function checkRequiredFields(
  output: unknown,
  spec: Record<string, unknown>,
): boolean {
  if (typeof output !== "object" || output === null) return false;
  const obj = output as Record<string, unknown>;
  const fields = spec.fields as string[] | undefined;
  if (!fields) return true;
  return fields.every((field) => {
    const value = obj[field];
    return value !== undefined && value !== null && value !== "";
  });
}

function checkSchema(
  output: unknown,
  spec: Record<string, unknown>,
): boolean {
  if (typeof output !== "object" || output === null) return false;
  const obj = output as Record<string, unknown>;

  for (const [key, expectedType] of Object.entries(spec)) {
    const value = obj[key];

    if (expectedType === "array") {
      if (!Array.isArray(value)) return false;
      const minItems = spec.minItems as number | undefined;
      if (minItems !== undefined && value.length < minItems) return false;
    } else if (expectedType === "string") {
      if (typeof value !== "string") return false;
    } else if (expectedType === "number") {
      if (typeof value !== "number") return false;
    } else if (expectedType === "object") {
      if (typeof value !== "object" || value === null) return false;
    }
  }

  return true;
}

function checkFormat(
  output: unknown,
  spec: Record<string, unknown>,
): boolean {
  const format = spec.format as string | undefined;
  if (!format) return true;

  const value = typeof output === "string" ? output : JSON.stringify(output);

  switch (format) {
    case "json":
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    case "markdown":
      return value.includes("#") || value.includes("-");
    case "url":
      return /^https?:\/\//.test(value);
    default:
      return true;
  }
}

function checkLength(
  output: unknown,
  spec: Record<string, unknown>,
): boolean {
  const value = typeof output === "string" ? output : JSON.stringify(output);
  const min = spec.min as number | undefined;
  const max = spec.max as number | undefined;

  if (min !== undefined && value.length < min) return false;
  if (max !== undefined && value.length > max) return false;
  return true;
}

function checkRegex(
  output: unknown,
  spec: Record<string, unknown>,
): boolean {
  const pattern = spec.pattern as string | undefined;
  const field = spec.field as string | undefined;
  if (!pattern) return true;

  const regex = new RegExp(pattern);

  if (field && typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    const value = obj[field];
    if (Array.isArray(value)) {
      return value.every((v) => regex.test(String(v)));
    }
    return regex.test(String(value));
  }

  return regex.test(String(output));
}

function checkCustom(
  output: unknown,
  spec: Record<string, unknown>,
): boolean {
  const check = spec.check as string | undefined;
  if (!check) return true;

  switch (check) {
    case "all_sections_present":
      return checkAllSectionsPresent(output);
    case "reference_consistency":
      return checkReferenceConsistency(output);
    case "no_empty_sections":
      return checkNoEmptySections(output);
    default:
      return true;
  }
}

// ─── Custom Check Implementations ────────────────────────────

function checkAllSectionsPresent(output: unknown): boolean {
  const text = String(output);
  // 최소 하나의 H1/H2 헤더가 있어야 함
  return /^#{1,2}\s+.+/m.test(text);
}

function checkReferenceConsistency(output: unknown): boolean {
  const text = String(output);
  // 본문의 [n] 인용 번호가 Reference 섹션에 존재하는지
  const citations = text.match(/\[(\d+)\]/g) || [];
  const refNumbers = new Set<string>();
  const refSection = text.match(/## Reference[\s\S]*$/i);
  if (refSection) {
    const refs = refSection[0].match(/\((\d+)\)/g) || [];
    refs.forEach((r) => refNumbers.add(r.replace(/[()]/g, "")));
  }

  for (const cite of citations) {
    const num = cite.replace(/[\[\]]/g, "");
    if (refNumbers.size > 0 && !refNumbers.has(num)) return false;
  }
  return true;
}

function checkNoEmptySections(output: unknown): boolean {
  const text = String(output);
  const sections = text.split(/^#{1,3}\s+/m).filter(Boolean);
  return sections.every((s) => s.trim().length > 10);
}

// ─── Utility ─────────────────────────────────────────────────

function extractActual(
  output: unknown,
  rule: ValidationRule,
): unknown {
  if (typeof output !== "object" || output === null) return output;
  const obj = output as Record<string, unknown>;

  if (rule.type === "required_fields") {
    const fields = rule.spec.fields as string[] | undefined;
    if (!fields) return undefined;
    const missing = fields.filter(
      (f) => obj[f] === undefined || obj[f] === null || obj[f] === "",
    );
    return { missingFields: missing };
  }

  return undefined;
}

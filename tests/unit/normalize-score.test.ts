import { describe, it, expect } from "vitest";
import { normalizeScore } from "../../src/eval/normalize-score.js";

describe("normalizeScore", () => {
  // ---- 0-1 range passes through ----

  describe("0-1 range (pass-through)", () => {
    it("returns 0 as-is", () => {
      expect(normalizeScore(0)).toBe(0);
    });

    it("returns 0.5 as-is", () => {
      expect(normalizeScore(0.5)).toBe(0.5);
    });

    it("returns 0.99 as-is", () => {
      expect(normalizeScore(0.99)).toBe(0.99);
    });

    it("returns exactly 1 as-is", () => {
      expect(normalizeScore(1)).toBe(1);
    });

    it("returns 0.001 as-is", () => {
      expect(normalizeScore(0.001)).toBe(0.001);
    });
  });

  // ---- 0-5 scale ----

  describe("0-5 scale (normalized to /5)", () => {
    it("normalizes 2.5 to 0.5", () => {
      expect(normalizeScore(2.5)).toBe(0.5);
    });

    it("normalizes 3 to 0.6", () => {
      expect(normalizeScore(3)).toBeCloseTo(0.6);
    });

    it("normalizes 4 to 0.8", () => {
      expect(normalizeScore(4)).toBeCloseTo(0.8);
    });

    it("normalizes exactly 5 to 1.0", () => {
      expect(normalizeScore(5)).toBe(1);
    });

    it("normalizes 1.5 to 0.3", () => {
      expect(normalizeScore(1.5)).toBeCloseTo(0.3);
    });
  });

  // ---- 0-10 scale ----

  describe("0-10 scale (normalized to /10)", () => {
    it("normalizes 7 to 0.7", () => {
      expect(normalizeScore(7)).toBeCloseTo(0.7);
    });

    it("normalizes 5.5 to 0.55", () => {
      expect(normalizeScore(5.5)).toBeCloseTo(0.55);
    });

    it("normalizes exactly 10 to 1.0", () => {
      expect(normalizeScore(10)).toBe(1);
    });

    it("normalizes 8.5 to 0.85", () => {
      expect(normalizeScore(8.5)).toBeCloseTo(0.85);
    });

    it("normalizes 6 to 0.6", () => {
      expect(normalizeScore(6)).toBeCloseTo(0.6);
    });
  });

  // ---- 0-100 scale ----

  describe("0-100 scale (normalized to /100)", () => {
    it("normalizes 50 to 0.5", () => {
      expect(normalizeScore(50)).toBe(0.5);
    });

    it("normalizes 75 to 0.75", () => {
      expect(normalizeScore(75)).toBeCloseTo(0.75);
    });

    it("normalizes exactly 100 to 1.0", () => {
      expect(normalizeScore(100)).toBe(1);
    });

    it("normalizes 85 to 0.85", () => {
      expect(normalizeScore(85)).toBeCloseTo(0.85);
    });

    it("normalizes 11 to 0.11", () => {
      expect(normalizeScore(11)).toBeCloseTo(0.11);
    });

    it("normalizes 99 to 0.99", () => {
      expect(normalizeScore(99)).toBeCloseTo(0.99);
    });
  });

  // ---- Edge cases ----

  describe("edge cases", () => {
    it("clamps negative numbers to 0", () => {
      expect(normalizeScore(-1)).toBe(0);
      expect(normalizeScore(-100)).toBe(0);
      expect(normalizeScore(-0.5)).toBe(0);
    });

    it("clamps numbers > 100 to 1", () => {
      expect(normalizeScore(101)).toBe(1);
      expect(normalizeScore(500)).toBe(1);
      expect(normalizeScore(1000)).toBe(1);
    });

    it("handles boundary between 0-1 and 0-5 scale (value > 1 and <= 5)", () => {
      // 1.01 should be treated as 0-5 scale
      expect(normalizeScore(1.01)).toBeCloseTo(1.01 / 5);
    });

    it("handles boundary between 0-5 and 0-10 scale (value > 5 and <= 10)", () => {
      // 5.01 should be treated as 0-10 scale
      expect(normalizeScore(5.01)).toBeCloseTo(5.01 / 10);
    });

    it("handles boundary between 0-10 and 0-100 scale (value > 10 and <= 100)", () => {
      // 10.01 should be treated as 0-100 scale
      expect(normalizeScore(10.01)).toBeCloseTo(10.01 / 100);
    });
  });
});

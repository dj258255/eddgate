/**
 * Normalize LLM evaluation score to 0-1 range.
 * LLM judges may return 0-1, 0-5, 0-10, or 0-100 scales.
 */
export function normalizeScore(score: number): number {
  if (score >= 0 && score <= 1) return score;
  if (score > 1 && score <= 5) return score / 5;
  if (score > 5 && score <= 10) return score / 10;
  if (score > 10 && score <= 100) return score / 100;
  return Math.min(1, Math.max(0, score));
}

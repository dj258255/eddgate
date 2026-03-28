/**
 * Available Claude models for eddgate.
 * Maps to Claude Code CLI model aliases.
 */

export interface ModelOption {
  value: string;
  label: string;
  hint: string;
  hintKo: string;
}

export const MODELS: ModelOption[] = [
  { value: "sonnet", label: "Sonnet 4.6", hint: "Most efficient for everyday tasks", hintKo: "일상 작업에 가장 효율적" },
  { value: "opus", label: "Opus 4.6", hint: "Most capable for complex tasks", hintKo: "고난도 작업에 가장 강력" },
  { value: "haiku", label: "Haiku 4.5", hint: "Fastest responses", hintKo: "가장 빠른 응답" },
  { value: "claude-opus-4-5", label: "Opus 4.5", hint: "Previous generation, still strong", hintKo: "이전 세대, 여전히 강력" },
  { value: "claude-sonnet-4-5", label: "Sonnet 4.5", hint: "Previous generation balanced", hintKo: "이전 세대 균형형" },
];

export const EFFORTS = [
  { value: "low", label: "low", hint: "Quick", hintKo: "빠르게" },
  { value: "medium", label: "medium", hint: "Standard (default)", hintKo: "표준 (기본)" },
  { value: "high", label: "high", hint: "Thorough", hintKo: "꼼꼼하게" },
  { value: "max", label: "max", hint: "Maximum quality", hintKo: "최대 품질" },
];

export const THINKING_OPTIONS = [
  { value: "disabled", label: "Off", hint: "Standard mode", hintKo: "일반 모드" },
  { value: "adaptive", label: "Adaptive", hint: "Think when needed", hintKo: "필요할 때 사고" },
  { value: "enabled", label: "Extended", hint: "Always think deeply", hintKo: "항상 깊이 사고" },
];

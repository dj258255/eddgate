import type {
  ExecutionContext,
  StepDefinition,
  StepResult,
} from "../types/index.js";

/**
 * Context Builder
 *
 * 최소 실행 컨텍스트 생성. 재현 가능성이 핵심.
 *
 * 원칙:
 * - 100토큰 요약 > 10,000토큰 raw
 * - 이전 단계 결과는 필요할 때만 명시적으로 주입
 * - Context rot 방지: 50K 토큰 이전에 열화 시작 (Chroma 연구)
 */
export function buildContext(
  step: StepDefinition,
  previousResults: Map<string, StepResult>,
  defaultModel: string,
): ExecutionContext {
  const ctx: ExecutionContext = {
    state: step.type,
    identity: {
      role: step.context.identity.role,
      model: step.model ?? step.context.identity.model ?? defaultModel,
      constraints: step.context.identity.constraints,
    },
    tools: step.context.tools,
  };

  // 이전 단계 결과 주입 (dependsOn이 있을 때만)
  if (step.dependsOn?.length) {
    const summaries: string[] = [];

    for (const depId of step.dependsOn) {
      const result = previousResults.get(depId);
      if (result && result.status === "success") {
        summaries.push(summarizeOutput(depId, result.output));
      }
    }

    if (summaries.length > 0) {
      ctx.memory = {
        summary: summaries.join("\n"),
        previousStepOutput: getPrimaryDependencyOutput(
          step.dependsOn,
          previousResults,
        ),
      };
    }
  }

  return ctx;
}

/**
 * 이전 단계 출력을 요약.
 * "적을수록 낫다" — 핵심 정보만 추출.
 */
function summarizeOutput(stepId: string, output: unknown): string {
  if (output === null || output === undefined) {
    return `[${stepId}]: (출력 없음)`;
  }

  const str = typeof output === "string" ? output : JSON.stringify(output);

  // 400자(≈100토큰) 이하면 그대로
  if (str.length <= 400) {
    return `[${stepId}]: ${str}`;
  }

  // 초과 시 앞뒤 잘라서 요약
  const head = str.slice(0, 200);
  const tail = str.slice(-150);
  return `[${stepId}]: ${head}...[중략]...${tail}`;
}

/**
 * 첫 번째 의존성의 전체 출력 반환.
 * 직전 단계의 산출물이 다음 단계의 주 입력이 되는 경우.
 */
function getPrimaryDependencyOutput(
  dependsOn: string[],
  results: Map<string, StepResult>,
): string | undefined {
  if (dependsOn.length === 0) return undefined;
  const primary = results.get(dependsOn[dependsOn.length - 1]);
  if (!primary || primary.status !== "success") return undefined;

  const output = primary.output;
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}

/**
 * 시스템 프롬프트 생성.
 * 역할 + 제약 + 메모리를 하나의 프롬프트로 조합.
 */
export function buildSystemPrompt(
  context: ExecutionContext,
  rolePrompt?: string,
): string {
  const parts: string[] = [];

  // 역할 프롬프트 (파일에서 로드된 것)
  if (rolePrompt) {
    parts.push(rolePrompt);
  }

  // 제약 조건
  if (context.identity.constraints.length > 0) {
    parts.push(
      "## 제약 조건\n" +
        context.identity.constraints.map((c) => `- ${c}`).join("\n"),
    );
  }

  // 이전 단계 컨텍스트 (있으면)
  if (context.memory?.summary) {
    parts.push("## 이전 단계 결과 요약\n" + context.memory.summary);
  }

  return parts.join("\n\n");
}

# Harness Engineering -- eddgate

eddgate 프로젝트에 적용된 하네스 엔지니어링 구조를 정리한 문서.

---

## 하네스 구성 요소

| 구성 요소 | 파일 | 목적 |
|-----------|------|------|
| **ESLint** | `eslint.config.js` | 코드 품질 + 아키텍처 의존성 규칙 강제 |
| **아키텍처 테스트** | `tests/arch/layer-boundaries.test.ts` | 레이어 간 import 위반 감지 |
| **비밀값 스캔** | `scripts/guard-secrets.sh` | 하드코딩된 API key/토큰 차단 |
| **통합 검증** | `scripts/verify.sh` | typecheck+lint+test+arch+secrets 한번에 실행 |
| **에이전트 지침** | `CLAUDE.md` | AI가 이 프로젝트에서 작업할 때의 규칙 |
| **CI 파이프라인** | `.github/workflows/ci.yml` | PR/push 시 자동 검증 |

---

## 레이어 구조

```
types/   (최하위 -- 순수 타입 정의)
  |
trace/   (observability -- types만 import)
  |
config/  (설정 로더 -- types만 import)
  |
eval/    (Tier 1/2/3 평가 -- types, trace, core만 import)
  |
core/    (워크플로우 엔진 -- types, trace, config, eval만 import)
  |
cli/     (최상위 -- CLI, TUI)
render/  (출력 렌더링 -- types, trace만 import)
i18n/    (다국어 -- 독립)
```

### 금지 규칙

| 레이어 | import 금지 대상 |
|--------|-----------------|
| `types/` | 모든 src/ 모듈 |
| `trace/` | core/, eval/, cli/, render/ |
| `eval/` | cli/, render/ |
| `core/` | cli/, render/ |
| `render/` | cli/ |

위반 시 `npm run test:arch`에서 실패한다.

---

## 검증 파이프라인

### 로컬 실행

```bash
npm run verify
```

순서: typecheck -> lint -> test -> test:arch -> guard:secrets

### CI 실행 (.github/workflows/ci.yml)

PR 또는 main push 시 자동 실행:
1. Type check (`npm run typecheck`)
2. Lint (`npm run lint`)
3. Build (`npm run build`)
4. Unit tests (`npm test`)
5. Architecture boundary tests (`npm run test:arch`)
6. Secret scan (`npm run guard:secrets`)
7. Dependency audit (`npm audit`)
8. Workflow dry-run (모든 워크플로우 검증)

---

## ESLint 규칙

| 규칙 | 레벨 | 목적 |
|------|------|------|
| `@typescript-eslint/no-explicit-any` | warn | any 타입 사용 억제 (기존 코드 점진적 제거) |
| `@typescript-eslint/consistent-type-imports` | error | 타입 전용 import 일관성 |
| `@typescript-eslint/no-unused-vars` | error | 미사용 변수 제거 (`_` 접두사 허용) |
| `no-restricted-imports` | error | 레이어별 금지 import 패턴 강제 |

---

## 비밀값 스캔

`scripts/guard-secrets.sh`가 다음 패턴을 검사:

1. **API key 패턴**: `api_key`, `apikey`, `secret`, `token`, `password` 뒤에 20자 이상 문자열
2. **sk- 패턴**: Anthropic/OpenAI API key 형태 (`sk-ant-`, `sk-`)
3. **.env 파일**: git에 추가된 `.env` 또는 `.env.local`

---

## 이미 내장된 평가 하네스 (eddgate 코어)

eddgate는 자체적으로 3-tier 평가 시스템을 내장하고 있다:

| Tier | 파일 | 목적 | 비용 |
|------|------|------|------|
| Tier 1 | `src/eval/tier1-rules.ts` | 규칙 기반 검증 (9가지 룰 타입) | 0 |
| Tier 2 | `src/eval/tier2-llm.ts` | LLM-as-Judge (핵심 전환점에서만) | LLM 호출 |
| Tier 3 | `src/eval/tier3-offline.ts` | 오프라인 배치 평가 + 회귀 감지 | LLM 호출 |

### 추가 내장 기능

| 기능 | 파일 | 설명 |
|------|------|------|
| 성공률 추적 | `src/core/run-memory.ts` | `successRate`, `avgScores`, `topIssues` 자동 집계 |
| Retry loop | `src/core/workflow-engine.ts` | step/workflow 레벨 자동 재시도 |
| Budget gate | `src/core/workflow-engine.ts` | `maxBudgetUsd` 초과 시 중단 |
| Human approval | `src/core/workflow-engine.ts` | `human_approval` step type |
| Trace/Observability | `src/trace/emitter.ts` | stdout/jsonl/langfuse/otel 출력 |
| A/B 테스트 | `src/types/index.ts` | 프롬프트 A/B 비교 |
| 회귀 감지 | `src/eval/tier3-offline.ts` | baseline vs current 점수 비교 |

---

## 스크립트 요약

| 명령 | 설명 |
|------|------|
| `npm run verify` | 전체 검증 (typecheck+lint+test+arch+secrets) |
| `npm run lint` | ESLint 실행 |
| `npm run test` | 단위 테스트 |
| `npm run test:arch` | 아키텍처 경계 테스트 |
| `npm run guard:secrets` | 비밀값 스캔 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run build` | 빌드 |

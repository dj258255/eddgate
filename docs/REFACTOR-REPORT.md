# eddgate Refactor Report

> 2024-03-29 -- 비관적 코드 리뷰 기반 전면 수정 + Liquid Glass TUI 테마 + UX 개선

---

## 1. 수정 범위 요약

| 카테고리 | 수정 파일 | 핵심 변경 |
|----------|----------|----------|
| Types | `src/types/index.ts` | StepResult.error, parentSpanId, toolName/Input/Output, range/enum/not_empty, sourceContext, AB 통계 |
| Core Engine | `src/core/workflow-engine.ts` | 사이클 감지, fan-in 병합, 병렬 예산, retry 정책, p-limit 동시성, 에러 보존 |
| Agent Runner | `src/core/agent-runner.ts` | jitter, 구조적 에러감지, 점수 안전추출, groundedness 소스전달, 평가 재시도 |
| Evaluation | `src/eval/tier1-rules.ts` | minItems 메타키 분리, markdown 실검증, range/enum/not_empty, custom default=false |
| Evaluation | `src/eval/tier2-llm.ts` | dead code -> 실제 연결, sourceContext 전달 |
| Trace | `src/trace/emitter.ts` | async 에러, span 계층, toolCall(), flush(), 버퍼 제한, Langfuse/OTel re-export |
| Context | `src/core/context-builder.ts` | 상태전이 검증, JSON 안전 요약, MCP 도구 검증, 전체 의존성 병합 |
| RAG | `src/core/rag-pipeline.ts` | heading-aware 청킹, 에러 로깅, 다양성 리랭킹, tracer 연동 |
| A/B Test | `src/cli/commands/ab-test.ts` | Welch's t-test, ABABAB 인터리빙, 역할명 검증, structuredClone |
| Schema | `src/config/schemas.ts` | Zod에 range/enum/not_empty + sourceContext |
| Package | `package.json` | p-limit, peerDeps(langfuse, OTel), pretest hook |
| Theme | `src/cli/theme.ts` | Liquid Glass 디자인 시스템 (NEW) |
| TUI | `src/cli/blessed-tui.ts` | 전체 Liquid Glass 테마 적용 |
| TUI | `src/cli/blessed-runner.ts` | 실행 대시보드 Liquid Glass 테마 |
| TUI | `src/cli/blessed-panels.ts` | 분석/모니터 패널 Liquid Glass 테마 |
| TUI | `src/cli/split-view.ts` | 비교 뷰 Liquid Glass 테마 |
| Tests | 6개 테스트 파일 | 219개 테스트 신규 작성 |

---

## 2. CRITICAL 버그 수정 상세

### 2.1 workflow-engine.ts

| 버그 | 수정 전 | 수정 후 |
|------|--------|--------|
| 병렬 예산 추적 없음 | parallel 브랜치에서 `accumulatedCost` 미갱신 | 매 레이어 결과마다 비용 누적 + 예산 초과 시 즉시 중단 |
| 사이클 감지 없음 | `visited` set만 사용 | `inProgress` set 추가, 백엣지 탐지 시 명시적 throw |
| fan-in 마지막만 사용 | `dependsOn[last]`만 사용 | 모든 의존성 출력을 `## Output from [stepId]` 형식으로 병합 |
| retry 정책 미구현 | `"retry"` 값 무시 | 워크플로우 레벨 재시도 2회 구현 |
| 에러 컨텍스트 유실 | `output: null`, error 없음 | `StepResult.error` 필드에 에러 메시지 보존 |
| 동시성 무제한 | bare `Promise.all` | `p-limit(5)`로 동시 LLM 호출 제한 |
| `buildParallelLayers` silent break | `layer.length === 0 -> break` | 미해결 스텝 ID 포함한 명시적 에러 throw |

### 2.2 agent-runner.ts

| 버그 | 수정 전 | 수정 후 |
|------|--------|--------|
| Thundering herd | `1000 * 2^attempt` 고정 | `baseDelay * (0.5 + Math.random() * 0.5)` jitter |
| 문자열 에러 감지 | `message.includes("rate_limit")` | `statusCode` 직접 검사 + 문자열 fallback |
| 점수 추출 위험 | 첫 숫자를 맹목적 채택 | 0-10 범위만 허용, non-score 숫자 거부, parse 실패 시 `score: 0` + 이유 기록 |
| Groundedness에 소스 없음 | 평가 프롬프트에 근거 문서 미포함 | `sourceContext` 파라미터 추가, 프롬프트에 Source/Evidence 섹션 포함 |
| 평가 재시도 없음 | 평가 LLM 실패 시 전파 | 2회 재시도 + 최종 실패 시 `score: 0` + `[eval-error]` 태그 |
| 평가 토큰 분리 불가 | 같은 stepId로 기록 | `${stepId}/eval`로 평가 전용 trace 분리 |

### 2.3 tier1-rules.ts

| 버그 | 수정 전 | 수정 후 |
|------|--------|--------|
| minItems가 스키마 필드로 처리 | `Object.entries(spec)` 순회 시 `minItems`도 키로 취급 | `SCHEMA_META_KEYS` Set으로 메타키 필터링 |
| markdown 검증 무의미 | `includes("#") \|\| includes("-")` | 정규식: heading, list, bold, link 패턴 |
| custom unknown = true | 알 수 없는 체크 이름이 자동 통과 | `default: return false` |
| range/enum/not_empty 미지원 | 6가지 규칙만 | 9가지로 확장 |

### 2.4 tier2-llm.ts

- **수정 전**: dead code (어디서도 import 하지 않음)
- **수정 후**: `workflow-engine.ts`의 `runLLMEvaluation`이 `runTier2Evaluation`을 직접 호출

### 2.5 trace/emitter.ts

| 항목 | 수정 전 | 수정 후 |
|------|--------|--------|
| async 에러 | 미처리 Promise rejection | `.catch(() => {})` 안전 처리 |
| span 계층 | flat 이벤트만 | `parentSpanId` + `activeSpans` Map |
| tool_call | 선언만 존재 | `toolCall()` 편의 메서드 구현 |
| 메모리 | 무한 증가 | `MAX_BUFFER_SIZE = 10,000` + `flush()` |
| Langfuse/OTel | 선언만 | `re-export` + dynamic import 패턴 유지 |

---

## 3. 테스트 커버리지

| 테스트 파일 | 테스트 수 | 커버 영역 |
|------------|----------|----------|
| `workflow-engine.test.ts` | 18 | 토폴로지 정렬, 사이클 감지, fan-in, 예산, 에러, 검증 게이트 |
| `tier1-rules.test.ts` | 72 | 9가지 규칙 타입 전부 (schema, required, format, length, regex, range, enum, not_empty, custom) |
| `normalize-score.test.ts` | 26 | 0-1/5/10/100 스케일 변환, 경계값, 클램핑 |
| `trace-emitter.test.ts` | 30 | emit, span, toolCall, flush, 버퍼, 에러 처리 |
| `context-builder.test.ts` | 27 | 컨텍스트 빌드, 메모리, 도구 검증, 상태 전이, 요약 |
| `rag-pipeline.test.ts` | 18 | 청킹, heading 분할, overlap, 경계 |
| **합계** | **219** | |

---

## 4. Liquid Glass TUI 테마

### 4.1 디자인 원칙

Apple Liquid Glass(WWDC 2025)를 터미널 환경에 적응:

1. **Layered Depth**: 3단계 배경 (`#0a0e14` -> `#111820` -> `#1a2332`)으로 깊이감
2. **Frosted Borders**: 미세한 `#2a3a4a` 기본 보더 -> 포커스 시 `#5b8fb9` -> 액센트 `#7ec8e3`
3. **Cool Palette**: 블루-시안 그라디언트 중심, 웜 톤 배제
4. **Unicode Glyphs**: 체크마크(\u2713), 다이아몬드(\u25C6), 풀블록(\u2588) 등 시각적 요소
5. **Muted Secondary**: 보조 텍스트 `#8b9bb4`, 힌트 `#546478`으로 시각적 소음 감소

### 4.2 색상 팔레트

```
Background Layers:
  #0a0e14  Deep (screen, headers, status bars)
  #111820  Surface (panels, menu)
  #1a2332  Elevated (selection, hover)

Border Progression:
  #2a3a4a  Subtle (default)
  #3d5066  Soft (active)
  #5b8fb9  Focus (selected)
  #7ec8e3  Accent (highlight)
  #a8e0f7  Glow (emphasis)

Semantic:
  #4ade80  Success / Pass
  #f87171  Error / Fail
  #fbbf24  Warning / Flag
  #60a5fa  Info / LLM
  #22d3ee  Running / Active
  #a78bfa  Lavender / Tools / RAG
```

### 4.3 적용 범위

| 컴포넌트 | 파일 | 적용 내용 |
|---------|------|----------|
| 메인 화면 | `blessed-tui.ts` | 헤더, 메뉴, 컨텐츠, 스테이터스바, `runCapturedCommand` |
| 실행 대시보드 | `blessed-runner.ts` | 헤더, Steps 패널, Log 패널, 스테이터스바, 이벤트 로그 |
| 분석/모니터 패널 | `blessed-panels.ts` | textBar, textGauge, textTable, 모든 패널 |
| 비교 뷰 | `split-view.ts` | 헤더, 좌/우 패널, 스테이터스바 |
| 테마 시스템 | `theme.ts` | 팔레트, 글리프, 스타일 프리셋, 포매팅 헬퍼 (NEW) |

### 4.4 모든 출력이 blessed 내부에서 동작

- **`runCapturedCommand`**: 모든 비-run 명령어의 `console.log`를 가로채서 blessed log 위젯에 렌더링
- chalk ANSI 코드를 `\x1b\[[0-9;]*m` 정규식으로 스트립하여 blessed 태그 시스템과 충돌 방지
- 각 명령어별 전용 헤더/상태바/출력 패널 생성
- 완료 후 elapsed time 표시, 키 입력 대기, 메인 메뉴 복귀

---

## 5. 빌드/테스트 결과

```
TypeScript:  0 errors
Tests:       219 passed / 0 failed
Duration:    2.6s
```

---

## 6. UX 개선 (추가)

### 6.1 경로 입력 -> 파일 브라우저 전환

모든 경로/파일 입력 지점을 파일 브라우저 선택 UI로 전환:

| 위치 | 수정 전 | 수정 후 |
|------|--------|--------|
| Report path | `blessedInput` (직접 타이핑) | 3-way 선택: Browse / Default / Type |
| Trace path | `blessedInput` (직접 타이핑) | 3-way 선택: Browse / Default / Type |
| A/B Prompt A/B | `blessedInput` (경로 타이핑) | `blessedFileBrowser` (탐색 선택) |
| Step debug input | `blessedInput` (텍스트만) | File/Text 2-way 선택 |

### 6.2 도움말 시스템

| 기능 | 설명 |
|------|------|
| `?` 키 오버레이 | 현재 선택된 메뉴에 맞는 상세 도움말 표시 |
| 메뉴별 도움말 | 9개 메뉴 각각에 대한 상세 설명 (기능, 사용법, 키보드 단축키) |
| 패널 힌트 | 모든 패널 하단에 "Press ? for detailed help" 안내 |
| 스테이터스바 | `?` 키가 도움말임을 표시 |
| A/B 테스트 가이드 | 실행 전 Variant A/B 설명 메시지 표시 |

도움말 오버레이 내용:
- 해당 메뉴의 기능 설명
- 하위 명령어 목록
- 키보드 단축키 전체 목록
- Self-Improving Loop 시각화

---

## 7. 남은 과제 (향후)

| 우선순위 | 항목 | 설명 |
|---------|------|------|
| P1 | Web UI | HTML 리포트를 넘어 실시간 대시보드 |
| P1 | 다중 LLM Provider | OpenAI/Gemini 직접 지원 |
| P2 | Red teaming | 프롬프트 인젝션/안전성 스캔 |
| P2 | Human-in-the-loop 강화 | 체크포인트 기반 승인 워크플로우 |
| P3 | Production monitoring | 실시간 메트릭 수집 |
| P3 | Prompt playground | TUI 내 프롬프트 편집/테스트 |

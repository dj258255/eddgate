# EDDOps CLI

평가가 내장된 멀티에이전트 워크플로우 엔진.

[EDDOps (Evaluation-Driven Development and Operations)](https://arxiv.org/abs/2411.13768) 원칙을 실용적으로 구현 — 코드가 워크플로우를 제어하고, 결정적 검증으로 품질을 보장합니다.

## 핵심 특징

- **결정적 검증 게이트** — Zod 스키마 기반 Tier 1 검증 (오탐 0%, 5ms)
- **LLM 평가 내장** — 핵심 전환점에서 groundedness/relevance 자동 평가
- **재현 가능한 실행** — 같은 입력 → 같은 실행 경로
- **검색↔생성 강제 분리** — 코드로 아키텍처 제약 강제
- **구조화 트레이스** — JSONL + HTML 리포트 + TUI 대시보드
- **Claude Code 연동** — Claude Agent SDK로 Max 구독 활용 (API 키 불필요)

## 설치

```bash
npm install -g eddops
```

**요구사항**: Node.js 20+, Claude Code CLI 설치 (Max/Pro 구독)

## 빠른 시작

```bash
# 워크플로우 목록 확인
eddops list workflows -d templates/workflows

# 워크플로우 구조 미리보기
eddops run document-pipeline --dry-run -w templates/workflows

# 실행
eddops run document-pipeline \
  --input query.txt \
  --output result.md \
  --report report.html \
  -w templates/workflows \
  -p templates/prompts

# TUI 대시보드로 결과 확인
eddops run document-pipeline \
  --input query.txt \
  --tui \
  -w templates/workflows \
  -p templates/prompts
```

## 아키텍처

```
코드가 제어 (결정적)          Claude가 실행 (Max 구독)
─────────────────────       ────────────────────────
Workflow Engine              query() → Claude Code CLI
 ├── 토폴로지 정렬            ├── 각 단계 LLM 호출
 ├── 의존성 해결              ├── 웹서칭, 파일 작업
 ├── Tier 1 Zod 검증         └── 구조화 출력 (JSON Schema)
 ├── Tier 2 LLM 평가
 ├── 재시도 로직
 └── 트레이스 기록
```

## 3-Tier 평가 모델

| Tier | 방식 | 비용 | 타이밍 | 정확도 |
|------|------|------|--------|--------|
| **Tier 1** | 규칙 기반 (Zod) | $0 | 매 단계, 5ms | 100% (결정적) |
| **Tier 2** | LLM-as-judge | ~$0.01/회 | 핵심 전환점만 | ~85% |
| **Tier 3** | 오프라인 분석 | 가변 | 비동기 | 데이터셋 의존 |

## 워크플로우 정의

YAML로 정의, Git으로 버전 관리:

```yaml
name: "문서 파이프라인"
config:
  defaultModel: "sonnet"
  topology: "pipeline"
  onValidationFail: "block"

steps:
  - id: "classify"
    name: "문제 구체화"
    type: "classify"
    context:
      state: "classify"
      identity:
        role: "problem_analyzer"
        constraints: ["답변 섹션 제목 형태로 정리"]
      tools: []
    validation:
      rules:
        - type: "required_fields"
          spec: { fields: ["topics"] }
          message: "topics 필수"
```

## 기본 워크플로우

| 워크플로우 | 단계 | 용도 |
|-----------|------|------|
| `document-pipeline` | 8 | 문의 분석 → 링크 수집 → 답변 생성 → 검증 |
| `code-review` | 3 | 변경 분석 → 이슈 탐지 → 리뷰 리포트 |
| `bug-fix` | 4 | 재현 → 원인 분석 → 수정 → 검증 |

## 출력

- **stdout** — 실시간 실행 로그
- **JSONL** — 구조화 트레이스 (`--trace-jsonl`)
- **HTML** — 시각적 리포트 (`--report`)
- **TUI** — 인터랙티브 터미널 대시보드 (`--tui`)

## 배경

- [RESEARCH_ANALYSIS.md](RESEARCH_ANALYSIS.md) — 논문 40+편, 프레임워크 16개 시장 분석
- [CRITICAL_ANALYSIS.md](CRITICAL_ANALYSIS.md) — 비관적 분석: "왜 안 만들었는가"
- [ARCHITECTURE.md](ARCHITECTURE.md) — 아키텍처 스펙 및 설계 근거

## 라이선스

MIT

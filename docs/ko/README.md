<p align="center">
  <img src="../../assets/logo.svg" width="80" height="80" alt="eddgate logo">
</p>

<h1 align="center">eddgate</h1>

<p align="center">LLM 워크플로우를 위한 자가 개선 평가 루프</p>

<p align="center">풀스크린 터미널 UI. 워크플로우 실행, 실패 분석, 규칙 자동 생성, 회귀 테스트. 하나의 도구, 하나의 루프.</p>

> **Promptfoo에서 오셨나요?** eddgate는 Promptfoo가 열어둔 루프를 닫습니다: 실패를 분석하고, 규칙을 자동 생성하고, 다음 실행에 적용합니다. 어떤 AI 제공자에게도 데이터를 보내지 않습니다. 완전한 셀프호스팅.

```
run -> analyze -> test -> run (개선됨) -> ...
```

## 설치

```bash
npm install -g eddgate
```

요구사항: Node.js 20+, Claude CLI (아무 구독) 또는 ANTHROPIC_API_KEY

## 시작하기

```bash
eddgate
```

이것만 실행하면 됩니다. 풀스크린 터미널 UI가 시작됩니다. 메뉴에서 실행, 분석, 테스트를 선택하세요.

```
+---------------------------+----------------------------------------------------+
|  eddgate                  |                                                    |
+---------------------------+                                                    |
|                           |                                                    |
|  > 실행                    |   워크플로우, 모델, 노력 수준, 입력을               |
|    분석                    |   선택하면 라이브로 실행 과정을 볼 수 있습니다.      |
|    테스트                  |                                                    |
|    MCP                    |   왼쪽 패널: 단계별 진행 상태                        |
|    플러그인                |   오른쪽 패널: 스트리밍 로그                         |
|    설정                    |   헤더: 토큰, 비용, 경과 시간                       |
|    종료                    |                                                    |
|                           |                                                    |
+---------------------------+----------------------------------------------------+
|  방향키: 이동  |  Enter: 선택  |  Esc: 뒤로  |  q: 종료                         |
+------------------------------------------------------------------------+
```

모든 것이 TUI 안에서 이루어집니다: 라이브 대시보드로 워크플로우 실행, 실패 분석, 회귀 테스트, MCP 서버 관리, 플러그인 가져오기, 언어 전환.

### CLI 모드 (CI/자동화용)

TUI의 모든 기능은 스크립팅과 CI 파이프라인을 위한 CLI 명령어로도 사용할 수 있습니다:

```bash
eddgate init                          # 프로젝트 생성
eddgate doctor                        # 환경 확인
eddgate run example -i input.txt      # 워크플로우 실행
eddgate analyze -d traces             # 실패 패턴 분석
eddgate test snapshot -d traces       # 현재 동작 기준선 저장
eddgate test diff -d traces           # 회귀 감지
```

## 루프

```
1. 실행          검증 게이트와 함께 워크플로우 실행
      |
2. 분석          실패 패턴 분석, 규칙 자동 생성
      |
3. 실행          다시 실행 -- 생성된 규칙 자동 적용
      |
4. 테스트 스냅샷  현재 동작을 기준선으로 저장
      |
   (프롬프트/워크플로우 수정)
      |
5. 테스트 비교   기준선 대비 회귀 감지
      |
   ... 반복
```

다른 도구는 이걸 못 합니다. Promptfoo는 평가만. Braintrust는 모니터링만. LangWatch는 추적만. 실패 분석에서 실행 개선까지 하나의 도구로 연결하는 건 eddgate뿐입니다.

## 검증 게이트

모든 단계가 게이트를 통과해야 합니다. 실패 = 파이프라인 중단.

```
입력 -> [단계 1] -> [게이트] -> [단계 2] -> [게이트] -> [단계 3] -> [게이트] -> 출력
                      |                     |                     |
                    통과?                  통과?                 통과?
                    실패 = 멈춤            실패 = 멈춤           실패 = 멈춤
```

두 단계:
- **Tier 1**: Zod 스키마 검증. 결정적. 0% 오탐. 5ms. 매 단계.
- **Tier 2**: LLM 평가. 근거기반성/관련성. 핵심 전환점에서만.

## 실패 분석

```bash
eddgate analyze -d traces
```

```
  105개 실패, 2개 패턴:

  C1 "validate_final"에서 평가 게이트 실패 (평균 점수: 0.75, 103회)
     103회 발생 (98%)
     점수 범위: 0.42 - 0.85
     수정: 임계값을 낮추거나 프롬프트 구체화
     규칙: validate_final_adjusted_threshold.yaml

  C2 "validate_final"에서 Rate limit (2회)
     수정: 단계 간 딜레이 추가 또는 maxRetries 줄이기
```

```bash
eddgate analyze -d traces --generate-rules    # 규칙 자동 생성
eddgate analyze -d traces --context           # 컨텍스트 윈도우 프로파일러
```

생성된 규칙은 다음 `eddgate run`에서 자동 로드됩니다.

## 회귀 테스트

```bash
eddgate test snapshot -d traces     # 기준선 저장
# ... 프롬프트 수정 ...
eddgate run my-workflow -i input.txt --trace-jsonl traces/new.jsonl
eddgate test diff -d traces         # 기준선과 비교
```

```
  회귀 (1):
    validate_final.evalScore
      이전: 0.78
      이후: 0.65
      -> 회귀 감지

  통과: 회귀 없음.  (또는)  실패: 회귀 감지됨.
```

CI에서 exit code 1 반환. GitHub Actions 연동 가능.

## 컨텍스트 윈도우 프로파일러

```bash
eddgate analyze -d traces --context
```

```
  단계별 분석:

  단계                        호출  입력       출력       전체       비율
  retrieve                  1      935        3,655      4,590      15.4%  ====
  generate_citation         2      6          6,908      6,914      23.2%  ======
  validate_final            48     63,744     38,400     102,144    34.3%  =========

  낭비 감지:
    "validate_final"이 48회 호출 (예상 2회) -- 재시도로 ~100K 토큰 낭비

  권장사항:
    "validate_final"의 재시도 횟수를 줄이거나 평가 임계값을 낮추세요
```

## TUI

`eddgate`를 실행하면 풀스크린 터미널 UI가 시작됩니다. 명령어를 외울 필요 없이 메뉴에서 모든 기능에 접근할 수 있습니다.

| 메뉴 | 설명 |
|------|------|
| **실행** | 워크플로우, 모델, 노력 수준, 사고 모드, 입력 선택. 실행 옵션(HTML 리포트, JSONL 트레이스, 예산 한도, 드라이 런) 설정. 라이브 대시보드. 완료 후 결과 패널에 단계별 테이블 표시. |
| **분석** | 실패 분석, 컨텍스트 프로파일러, 오프라인 평가, A/B 프롬프트 테스트, diff-eval, version-diff. |
| **테스트** | 스냅샷 저장, 기준선 비교, 스냅샷 목록, 배포 게이트(임계값 확인). |
| **모니터** | 상태 개요(성공률 게이지, 메트릭 테이블), 비용 분석(모델별 바 차트, 단계별 테이블), 품질 점수(평가 평균과 분포 바). 저장된 트레이스 기반. |
| **트레이스** | 저장된 트레이스 파일 탐색. 선택하면 단계 요약(왼쪽) + 전체 이벤트 타임라인(오른쪽)을 컬러 코딩된 이벤트로 표시. |
| **MCP** | YAML 편집 없이 MCP 서버 추가/제거/목록. |
| **플러그인** | 워크플로우/역할 확인, 워크플로우 시각화, 단일 단계 디버그, RAG 인덱스/검색(Pinecone MCP), 파일 가져오기. |
| **설정** | 기본 모델, 언어(한국어/영어), 설정 보기, Doctor(환경 진단), Init(프로젝트 생성). |

키보드: 방향키로 이동, Enter로 선택, Esc로 뒤로, q로 종료, Tab으로 패널 전환.

### 실행 옵션

워크플로우/모델/노력/사고 모드 선택 후, 실행 옵션 메뉴에서 추가 설정:

| 옵션 | 설명 |
|------|------|
| **바로 실행** | 현재 설정으로 진행. |
| **HTML 리포트 저장** | 경로 입력 -- 실행 후 다크모드 HTML 리포트 생성. |
| **JSONL 트레이스 저장** | 경로 입력 -- 실행 중 모든 이벤트 기록. |
| **예산 한도 설정** | USD 금액 입력 -- 비용 초과 시 워크플로우 중단. |
| **드라이 런** | 토글 -- 실행 없이 워크플로우 구조만 미리보기. |

여러 옵션을 동시에 설정한 후 "바로 실행"으로 시작할 수 있습니다.

### 실행 대시보드

워크플로우 실행 중 라이브 오케스트레이션 대시보드가 표시됩니다:

```
+---------------------------+----------------------------------------------------+
|  document-pipeline        |  워크플로우: document-pipeline                       |
|  sonnet | high | 42s      |  모델: sonnet  노력: high                           |
+---------------------------+  경과: 42s  토큰: 12,450  비용: $0.02               |
|                           +----------------------------------------------------+
|  [완료] classify_input    |  [단계 시작] classify_input -> classifier            |
|  [완료] retrieve_docs     |  [검증] 통과                                        |
|  [실행] generate_draft    |  [단계 종료] 완료 3.2s (2,100 토큰)                 |
|  [ .. ] validate_final    |  [단계 시작] retrieve_docs -> researcher             |
|  [ .. ] format_output     |  [검색] 3개 청크 (평균 점수: 0.82)                  |
|                           |  [단계 종료] 완료 5.1s (4,350 토큰)                 |
|                           |  [단계 시작] generate_draft -> writer                |
|                           |  ...                                                |
+---------------------------+----------------------------------------------------+
```

## CLI 명령어 (CI/자동화용)

TUI의 모든 기능은 스크립팅과 CI 파이프라인을 위한 명령어로도 사용할 수 있습니다.

### 핵심

| 명령어 | 설명 |
|--------|------|
| `eddgate run <workflow>` | 검증 게이트와 함께 워크플로우 실행. 잘못된 출력 시 즉시 중단. |
| `eddgate analyze` | 실패 패턴 클러스터링, 수정 제안. `--generate-rules`로 YAML 규칙 생성. `--context`로 토큰 사용량 확인. |
| `eddgate test snapshot` | 트레이스에서 현재 동작 기준선 저장. |
| `eddgate test diff` | 기준선과 비교. 회귀 시 exit 1 (CI 친화적). |
| `eddgate test list` | 저장된 스냅샷 목록. |
| `eddgate init` | 프로젝트 구조 생성. |
| `eddgate doctor` | Node.js, Claude CLI, 설정 유효성, 그래프 무결성 확인. |
| `eddgate list workflows` | 사용 가능한 워크플로우 YAML 파일 목록. |
| `eddgate list roles` | 사용 가능한 역할 정의 목록. |

### 실행 플래그

| 플래그 | 설명 |
|--------|------|
| `-i, --input <file>` | 입력 파일 또는 텍스트. 파일이면 내용을 읽음. |
| `-m, --model <model>` | 모델 오버라이드: `sonnet`, `opus`, `haiku`, `claude-opus-4-5`, `claude-sonnet-4-5` |
| `-e, --effort <level>` | 노력: `low`, `medium`, `high`, `max` |
| `--report <path>` | HTML 리포트 생성 (다크모드, 접이식 단계, 점수 게이지). |
| `--trace-jsonl <path>` | 분석용 구조화된 JSONL 트레이스 저장. |
| `--max-budget-usd <n>` | 누적 비용 초과 시 워크플로우 중단. |
| `--dry-run` | 실행 없이 워크플로우 구조 미리보기. |
| `--json` | 기계 판독 가능 JSON 출력. |
| `--quiet` | 오류만 출력. |

### 고급

| 명령어 | 설명 |
|--------|------|
| `eddgate advanced eval <workflow>` | 저장된 트레이스를 LLM 판사로 재평가. |
| `eddgate advanced diff-eval <workflow>` | git 커밋 간 평가 점수 비교. |
| `eddgate advanced gate` | 배포 게이트. 임계값 미달 시 exit 1. |
| `eddgate advanced monitor status` | 성공률, p50/p95 지연시간, 토큰, 비용. |
| `eddgate advanced monitor cost` | 모델별, 단계별 비용 분석. |
| `eddgate advanced monitor quality` | 시간별 평가 점수 추세. |
| `eddgate advanced viz <workflow>` | Mermaid 다이어그램 또는 ASCII 시각화. |
| `eddgate advanced step <workflow> <step-id>` | 디버깅을 위한 단일 단계 실행. |
| `eddgate advanced trace <file>` | JSONL 트레이스 타임라인 뷰어. |
| `eddgate advanced mcp <action>` | MCP 서버 관리: `list`, `add`, `remove`. |
| `eddgate advanced version-diff` | git 커밋 간 프롬프트/워크플로우 변경. |
| `eddgate advanced rag index` | 문서 청킹 후 Pinecone MCP로 업서트. |
| `eddgate advanced rag search <query>` | Pinecone 인덱스 검색, 순위별 청크 반환. |
| `eddgate advanced ab-test` | 같은 워크플로우를 두 프롬프트 변형으로 실행, 점수 비교. |

## RAG 파이프라인 (Pinecone MCP)

문서를 Pinecone에 인덱싱하고, 워크플로우에서 벡터 검색을 사용합니다.

```bash
# 문서 인덱싱
eddgate advanced rag index -d docs/ --index my-docs

# 검색
eddgate advanced rag search "인증은 어떻게 동작하나요?" --index my-docs
```

또는 TUI에서: **플러그인 > RAG index / RAG search**.

내장 `rag-pipeline` 워크플로우: 쿼리 분류 -> 벡터 검색 -> 근거 기반 생성 -> 근거 검증.

```yaml
steps:
  - id: "retrieve_context"
    type: "retrieve"
    context:
      tools: ["mcp:pinecone:search-records"]
  - id: "generate_answer"
    type: "generate"
    evaluation:
      type: "groundedness"
      threshold: 0.7
```

`eddgate.config.yaml`에 Pinecone MCP 서버 설정이 필요합니다.

## A/B 프롬프트 테스트

같은 워크플로우와 입력으로 두 프롬프트 변형을 비교합니다.

```bash
eddgate advanced ab-test \
  --workflow document-pipeline \
  --prompt-a templates/prompts/analyzer.md \
  --prompt-b templates/prompts/analyzer.v2.md \
  -i input.txt \
  -n 3
```

또는 TUI에서: **분석 > A/B prompt test**.

출력 예시:

```
  Metric               Variant A      Variant B      Delta
  ──────────────────── ────────────── ────────────── ──────────────
  Avg Score            0.742          0.819          +0.077
  Avg Tokens           8,450          7,200          -1,250
  Avg Cost             $0.0234        $0.0198        -0.0036
  Avg Time             12.3s          10.8s          -1.5s

  Winner: Variant B
  Score advantage: 0.077
```

승자 로직: 높은 점수 우선. 점수 차이 0.02 이내면 낮은 비용 우선.

## 워크플로우 정의

```yaml
name: "My Pipeline"
config:
  defaultModel: "sonnet"
  topology: "pipeline"
  onValidationFail: "block"

steps:
  - id: "analyze"
    type: "classify"
    context:
      identity:
        role: "analyzer"
        constraints: ["output JSON"]
      tools: []
    validation:
      rules:
        - type: "required_fields"
          spec: { fields: ["topics"] }
          message: "topics required"

  - id: "generate"
    type: "generate"
    dependsOn: ["analyze"]
    evaluation:
      enabled: true
      type: "groundedness"
      threshold: 0.7
      onFail: "block"
```

## 병렬 실행

`topology: "parallel"`로 독립 단계를 자동 병렬 실행:

```yaml
config:
  topology: "parallel"  # 독립 단계를 동시에 실행

steps:
  - id: "search_docs"
    type: "retrieve"
    tools: ["web_search"]

  - id: "search_code"
    type: "retrieve"
    tools: ["file_read"]

  - id: "combine"
    type: "generate"
    dependsOn: ["search_docs", "search_code"]  # 둘 다 완료될 때까지 대기
```

`search_docs`와 `search_code`가 동시에 실행됩니다. `combine`은 둘 다 완료될 때까지 기다립니다. 독립적인 검색 단계가 있는 워크플로우에서 보통 30-40% 속도 향상.

## LLM 지원

자동 감지:

| 백엔드 | 설정 | 비용 |
|--------|------|------|
| Claude CLI | 아무 Claude 구독 | 구독에 포함 |
| Anthropic API | `ANTHROPIC_API_KEY` | 토큰당 과금 |

## 기본 워크플로우

| 워크플로우 | 단계 | 용도 |
|-----------|------|------|
| document-pipeline | 8 | 문서 처리 + 인용 |
| code-review | 3 | 변경 분석, 이슈, 리포트 |
| bug-fix | 4 | 재현, 원인, 수정, 검증 |
| api-design | 3 | 요구사항, 엔드포인트, 문서 |
| translation | 3 | 분석, 번역, 검증 |
| rag-pipeline | 4 | 쿼리 분류, 벡터 검색, 근거 기반 생성, 검증 |

## 평가 임계값

기본: **0.7** (LLM-as-judge 업계 표준)

| 점수 | 의미 |
|------|------|
| 0.7+ | 통과 -- 허용 가능한 품질 |
| 0.8+ | 좋음 -- bug-fix, translation에서 사용 |
| 0.9+ | 대부분의 LLM 태스크에서 비현실적 (판사 일치도 ~80-85%) |
| < 0.7 | 실패 -- 게이트 차단, 재시도 또는 중단 |

워크플로우 YAML에서 단계별 설정 가능. `eddgate analyze`가 관찰된 점수 범위를 기반으로 조정된 임계값을 제안합니다.

## CI/CD 연동

```yaml
# .github/workflows/eddgate-loop.yml
name: eddgate loop
on:
  push:
    paths: ['templates/prompts/**', 'templates/workflows/**']

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build

      # 워크플로우 그래프 검증
      - run: node dist/cli/index.js doctor --ci -w templates/workflows

      # 회귀 확인
      - run: node dist/cli/index.js test diff -d traces

      # 배포 게이트
      - run: node dist/cli/index.js advanced gate --results eval-results.json --rules templates/gate-rules.yaml
```

`test diff`는 회귀 시 exit 1. `gate`는 임계값 미달 시 exit 1. CI가 머지를 차단합니다.

## 문서

- [아키텍처](../en/ARCHITECTURE.md)

## 라이선스

MIT

---

<p align="center">
  <a href="../../README.md">English</a>
</p>

<p align="center">
  <img src="../../assets/logo.svg" width="80" height="80" alt="eddgate logo">
</p>

<h1 align="center">eddgate</h1>

<p align="center">LLM 워크플로우를 위한 자가 개선 평가 루프</p>

검증 게이트로 워크플로우를 실행하고, 실패를 분석하고, 규칙을 자동 생성하고, 회귀 테스트. 하나의 CLI, 하나의 루프.

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
eddgate          # TUI 모드 -- 실행 / 분석 / 테스트 선택
```

또는 명령어로:

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
1. eddgate run          검증 게이트와 함께 워크플로우 실행
        |
2. eddgate analyze      실패 패턴 분석, 규칙 자동 생성
        |
3. eddgate run          다시 실행 -- 생성된 규칙 자동 적용
        |
4. eddgate test snapshot    현재 동작을 기준선으로 저장
        |
   (프롬프트/워크플로우 수정)
        |
5. eddgate test diff    기준선 대비 회귀 감지
        |
   ... 반복
```

다른 도구는 이걸 안 해. Promptfoo는 평가만. Braintrust는 모니터링만. LangWatch는 추적만. 실패 분석에서 실행 개선까지 하나의 CLI로 연결하는 건 eddgate뿐.

## 검증 게이트

모든 단계가 게이트를 통과해야 함. 실패 = 파이프라인 중단.

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

  C2 "validate_final"에서 Rate limit (2회)
     수정: 단계 간 딜레이 추가 또는 maxRetries 줄이기
```

```bash
eddgate analyze -d traces --generate-rules    # 규칙 자동 생성
eddgate analyze -d traces --context           # 컨텍스트 윈도우 프로파일러
```

생성된 규칙은 다음 `eddgate run`에서 자동 로드.

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

## 평가 임계값

기본: **0.7** (LLM-as-judge 업계 표준)

| 점수 | 의미 |
|------|------|
| 0.7+ | 통과 -- 허용 가능한 품질 |
| 0.8+ | 좋음 -- bug-fix, translation에서 사용 |
| 0.9+ | 대부분의 LLM 태스크에서 비현실적 (판사 일치도 ~80-85%) |
| < 0.7 | 실패 -- 게이트 차단, 재시도 또는 중단 |

워크플로우 YAML에서 단계별 설정 가능. `eddgate analyze`가 관찰된 점수 범위를 기반으로 조정된 임계값 제안.

## 명령어

```bash
eddgate                    # TUI: 실행 / 분석 / 테스트
eddgate run <workflow>     # 게이트와 함께 실행
eddgate analyze            # 실패 패턴 + 규칙 생성
eddgate test <action>      # snapshot / diff / list
eddgate init               # 프로젝트 생성
eddgate doctor             # 환경 확인
eddgate list <type>        # workflows / roles
eddgate advanced ...       # eval, gate, monitor, viz, mcp 등
```

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

## 라이선스

MIT

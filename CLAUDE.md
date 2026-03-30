# CLAUDE.md

## Project Context

eddgate는 LLM 에이전트용 평가 기반 워크플로우 엔진이다.
핵심 목표는 "평가를 통과하지 못한 에이전트 출력은 다음 단계로 넘어가지 않는다"는 원칙을 기계적으로 강제하는 것이다.

## Architecture Intent

```
types/   (최하위 -- 아무것도 import 안 함)
trace/   (types만 import -- observability 인프라)
config/  (types만 import)
eval/    (types, trace, core만 import -- 평가 로직)
core/    (types, trace, config, eval만 import -- 워크플로우 엔진)
i18n/    (독립)
render/  (types, trace만 import -- 출력 렌더링)
cli/     (최상위 -- 모두 import 가능)
```

## Hard Rules

- eval/ 에서 cli/ 또는 render/ import 금지
- core/ 에서 cli/ 또는 render/ import 금지
- render/ 에서 cli/ import 금지
- types/ 에서 다른 src/ 모듈 import 금지
- trace/ 에서 core/, eval/, cli/, render/ import 금지
- 테스트 없는 신규 기능 추가 금지
- lint/typecheck/test/arch 실패 상태 커밋 금지
- 코드에 API key, 토큰, 비밀번호 하드코딩 금지

## Verification

변경 후 반드시 `npm run verify` 실행. 이 스크립트는 다음을 순서대로 수행:
1. `typecheck` -- TypeScript 타입 검사
2. `lint` -- ESLint 규칙 검사
3. `test` -- 단위 테스트
4. `test:arch` -- 아키텍처 경계 테스트
5. `guard:secrets` -- 비밀값 스캔

## Do Not

- `any` 타입 신규 추가 금지 (기존 것은 점진적으로 제거)
- console.log를 디버깅 용도로 남기고 커밋 금지
- node_modules나 dist를 커밋에 포함 금지
- .env 파일을 git에 추가 금지

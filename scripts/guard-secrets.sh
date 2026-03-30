#!/usr/bin/env bash
set -euo pipefail

# 패턴 기반 비밀값 스캔 (gitleaks 없이도 동작)
VIOLATIONS=0

echo "scanning for hardcoded secrets..."

# API key 패턴
if grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  -E '(api[_-]?key|apikey|secret|token|password)\s*[:=]\s*["\x27][A-Za-z0-9_\-]{20,}["\x27]' \
  src/ templates/ 2>/dev/null; then
  echo "FAIL: potential hardcoded secret found"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# sk-ant- / sk- 패턴 (Anthropic/OpenAI keys)
if grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  -E 'sk-[a-zA-Z0-9_\-]{20,}' \
  src/ templates/ 2>/dev/null; then
  echo "FAIL: potential API key found (sk-*)"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# .env 파일이 git에 추가되었는지
if git ls-files --cached | grep -E '\.env$|\.env\.local$' 2>/dev/null; then
  echo "FAIL: .env file tracked by git"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "secret scan FAILED: $VIOLATIONS violation(s)"
  exit 1
fi

echo "secret scan passed"

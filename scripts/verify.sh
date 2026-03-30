#!/usr/bin/env bash
set -euo pipefail

echo "=== verify: typecheck ==="
npm run typecheck

echo "=== verify: lint ==="
npm run lint

echo "=== verify: test ==="
npm run test

echo "=== verify: arch ==="
npm run test:arch

echo "=== verify: secrets ==="
npm run guard:secrets

echo ""
echo "ALL_CHECKS_PASSED"

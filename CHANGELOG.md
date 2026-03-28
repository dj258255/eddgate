# Changelog

## 0.1.0 (2026-03-28)

Initial release.

### Core
- Workflow engine: pipeline/parallel/single topology
- Tier 1 validation: Zod schema checks (deterministic, 0% false positives)
- Tier 2 evaluation: LLM-as-judge at key transition points
- Tier 3 offline: batch evaluation with regression detection
- LLM adapter pattern: Claude SDK (any subscription) or Anthropic API
- Context Engineering: retrieve steps isolated from execution context (code-enforced)
- Graph validator: cycle detection, dangling refs, duplicate IDs
- Error recovery: exponential backoff retry on transient failures
- Cost budget control (--max-budget-usd)
- E2E trace with retrieval chunk metadata
- record_decision step type for audit trail

### Commands
- Core: init, doctor, run, list
- Advanced: step, trace, eval, diff-eval, gate, monitor, version-diff, mcp, viz

### Output
- stdout, JSONL trace, HTML report (dark mode), TUI dashboard, JSON
- Langfuse and OpenTelemetry adapters (optional)

### Templates
- 5 workflows: document-pipeline, code-review, bug-fix, api-design, translation
- 8 role definitions, 8 role prompts
- gate-rules.yaml for deployment gates

### CI/CD
- GitHub Actions: ci.yml (build/test), eval.yml (prompt change validation)

### Tests
- 60 tests passing (unit + integration)

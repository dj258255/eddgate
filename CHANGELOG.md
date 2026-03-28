# Changelog

## 0.1.0 (2026-03-29)

Initial release. Self-improving evaluation loop for LLM workflows.

### The Loop

```
run -> analyze -> test -> run (improved)
```

### Core Commands
- `run`: Execute workflow with Tier 1 (Zod) + Tier 2 (LLM) validation gates
- `analyze`: Cluster failure patterns from traces, auto-generate rules, context profiler
- `test`: Behavioral snapshots + regression diff with CI exit codes

### Engine
- Pipeline/parallel/single topology with topological sort
- Deterministic Tier 1 validation (0% false positives, 5ms)
- LLM evaluation at key transitions with score normalization (0-1)
- Error recovery with exponential backoff (3 retries)
- Cost budget control (--max-budget-usd)
- Graph validator (cycle detection, dangling refs)
- Context Engineering: retrieve steps isolated from execution context
- record_decision step type for audit trail
- Auto-load generated rules from eval/rules/ on next run

### TUI
- @clack/prompts for setup (workflow, model, effort selection)
- Ink real-time dashboard during execution (steps + log panels)
- File picker with folder navigation
- Korean/English language selection
- Mode selector: Run / Analyze / Test

### Adapters
- Claude SDK (any subscription, no API key)
- Anthropic API (ANTHROPIC_API_KEY)
- LLM adapter interface for custom backends

### Templates
- 5 workflows (document-pipeline, code-review, bug-fix, api-design, translation)
- 8 role definitions + prompts
- gate-rules.yaml for deployment gates

### Output
- stdout, JSONL trace, HTML report, TUI dashboard, JSON
- Langfuse and OpenTelemetry adapters (optional)

### CI/CD
- GitHub Actions: ci.yml (build/test), eval.yml (prompt change validation)
- `eddgate test diff` exits 1 on regression
- `eddgate advanced gate` with configurable rules

### Tests
- 63 tests passing (unit + integration)

# Changelog

## 0.1.0 (2026-03-29)

Initial release. Self-improving evaluation loop for LLM workflows.

### Core Loop

```
run -> analyze -> test -> run (improved)
```

Three things combined that don't exist together anywhere else:
1. Validation gates (EDDOps) -- deterministic checks between workflow steps
2. Error analysis (Hamel Husain's approach) -- cluster failures, auto-generate rules
3. Regression testing (Percy/Chromatic for agents) -- snapshot behavior, diff changes

### Commands

Core:
- `run`: Execute workflow with Tier 1 (Zod) + Tier 2 (LLM) validation gates
- `analyze`: Cluster failure patterns, auto-generate rules, context window profiler
- `test`: Behavioral snapshots + regression diff with CI exit codes
- `init`, `doctor`, `list`

Advanced:
- `eval`, `diff-eval`, `gate`, `monitor`, `version-diff`, `mcp`, `viz`, `step`, `trace`

### TUI (Terminal UI)

- @clack/prompts for all interactions (no raw CLI args needed)
- Main menu: Run / Analyze / Test / MCP Servers / Settings
- Model selection: Opus 4.6, Sonnet 4.6, Haiku 4.5, Opus 4.5, Sonnet 4.5
- Effort levels: low / medium / high / max
- Extended thinking: off / adaptive / enabled
- File picker with folder navigation
- Korean/English language selection
- Ink real-time dashboard during execution (steps + log panels)
- MCP server manager (add/remove/list from TUI)
- Settings manager (model, traces, Langfuse from TUI)

### Engine

- Pipeline/parallel/single topology with topological sort
- Deterministic Tier 1 validation (Zod, 0% false positives, 5ms)
- LLM evaluation at key transitions with score normalization (0-1)
- Threshold: 0.7 default (industry standard, 0.9+ unreachable for LLM judges)
- Error recovery: exponential backoff retry (3 attempts, no infinite recursion)
- Cost budget control (--max-budget-usd)
- Graph validator (cycle detection, dangling refs, duplicate IDs)
- Context Engineering: retrieve steps isolated from execution context (code-enforced)
- Auto-load generated rules from eval/rules/ on next run (loop closure)
- record_decision step type for audit trail

### Adapters

- LLM adapter interface for pluggable backends
- Claude SDK adapter (any subscription, no API key needed)
- Anthropic API adapter (ANTHROPIC_API_KEY)
- Extended thinking support (disabled/adaptive/enabled)

### Templates

- 5 workflows: document-pipeline, code-review, bug-fix, api-design, translation
- 8 role definitions + prompts
- gate-rules.yaml for deployment gates

### Output

- stdout real-time log
- JSONL structured traces
- HTML report (dark mode, collapsible steps, score gauges)
- TUI interactive dashboard (Ink)
- JSON machine-readable output
- Langfuse and OpenTelemetry adapters (optional)

### CI/CD

- GitHub Actions: ci.yml (build/test), eval.yml (prompt change validation)
- `test diff` exits 1 on regression
- `gate` exits 1 on threshold failure

### Docs

- docs/en/ARCHITECTURE.md
- docs/ko/README.md (Korean)
- docs/ko/ARCHITECTURE.md (Korean)

### Tests

- 63 tests passing (unit + integration)

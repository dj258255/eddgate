# Changelog

## 0.1.0 (2026-03-28)

Initial release.

### Features

- Workflow engine with pipeline/parallel/single topology
- Tier 1 rule-based validation (Zod, deterministic, 0% false positives)
- Tier 2 LLM evaluation at key transition points
- Tier 3 offline batch evaluation with regression detection
- Claude Agent SDK integration (Max subscription, no API key needed)
- Context Builder with minimal execution context
- Graph validator (cycle detection, dangling refs, duplicate IDs)
- Error recovery with exponential backoff retry
- Cost budget control (--max-budget-usd)
- human_approval step type

### CLI Commands

- `eddgate init` -- scaffold project structure
- `eddgate doctor` -- health check (Node, Claude CLI, config, graph)
- `eddgate run` -- execute workflow (--report, --tui, --json, --quiet, --verbose)
- `eddgate step` -- run single step for debugging
- `eddgate trace` -- view saved traces
- `eddgate eval` -- offline evaluation on saved traces
- `eddgate list` -- list workflows and roles

### Output

- stdout real-time logging
- JSONL structured traces
- HTML report (dark mode, collapsible steps, score gauges)
- TUI interactive dashboard

### Templates

- document-pipeline (8 steps)
- code-review (3 steps)
- bug-fix (4 steps)
- 8 role YAML definitions
- 8 role prompt files

### Trace Adapters

- Langfuse (optional, requires langfuse package)
- OpenTelemetry (optional, requires @opentelemetry/api)

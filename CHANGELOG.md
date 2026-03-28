# Changelog

## 0.2.0 (2026-03-28)

GenAIOps pipeline complete. All 4 stages covered.

### New Commands
- `gate` -- deployment gate with configurable rules (avg_score, pass_rate thresholds)
- `monitor` -- aggregated metrics from traces (status, cost by model/step, quality trends)
- `version-diff` -- prompt/workflow change tracking between git commits

### Engine
- `record_decision` step type for audit trail logging
- E2E trace with retrieval chunk ID/source metadata
- Context Engineering enforced: retrieve steps cannot access execution context (code-enforced)
- Model overrides from config now connected to workflow engine (classify=haiku, generate=sonnet)

### Templates
- gate-rules.yaml for deployment gate configuration

### Tests
- 60 tests passing (Context Engineering isolation test added)

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

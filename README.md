# eddgate

Evaluation-gated multi-agent workflow engine.

Deterministic validation gates, structured traces, reproducible execution.
Powered by Claude Agent SDK (Max subscription, no API key needed).

## Core Features

- **Deterministic validation gates** -- Zod schema-based Tier 1 checks (0% false positives, 5ms)
- **LLM evaluation at key transitions** -- groundedness/relevance scoring at critical points
- **Reproducible execution** -- same input produces same execution path
- **Search/generation separation enforced** -- retrieve steps cannot access execution context (code-enforced)
- **GenAIOps pipeline** -- build/evaluate/deploy/operate lifecycle fully covered
- **Structured traces** -- JSONL + HTML report + TUI dashboard + Langfuse/OTel adapters

## Install

```bash
npm install -g eddgate
```

Requirements: Node.js 20+, Claude Code CLI (Max/Pro subscription)

## Quick Start

```bash
eddgate init                                    # scaffold project
eddgate doctor                                  # check environment
eddgate run example --input input.txt --dry-run # preview workflow
eddgate run example --input input.txt           # execute workflow
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Scaffold project structure |
| `doctor` | Health check (Node, Claude CLI, config, graph validation) |
| `run` | Execute workflow (--report, --tui, --json, --max-budget-usd) |
| `step` | Run single step for debugging |
| `trace` | View saved traces (summary or JSON) |
| `eval` | Offline evaluation on saved traces |
| `diff-eval` | Compare evaluation scores between git commits |
| `gate` | Deployment gate check with configurable rules |
| `monitor` | Aggregated metrics: status, cost by model/step, quality trends |
| `version-diff` | Show prompt/workflow changes between commits |
| `mcp` | Manage MCP servers (list/add/remove) |
| `viz` | Workflow visualization (Mermaid/ASCII) |
| `list` | List workflows and roles |

## GenAIOps Pipeline

eddgate covers the full GenAIOps lifecycle:

```
build:    Git + version-diff        (prompt/workflow versioning)
evaluate: eval + diff-eval          (offline evaluation + regression detection)
deploy:   gate                      (configurable rules, CI integration)
operate:  monitor + trace           (cost/quality/status aggregation)
```

## 3-Tier Evaluation

| Tier | Method | Cost | Timing | Accuracy |
|------|--------|------|--------|----------|
| 1 | Rule-based (Zod) | $0 | Every step, 5ms | 100% deterministic |
| 2 | LLM-as-judge | ~$0.01/call | Key transitions only | ~85% |
| 3 | Offline batch | Variable | Async (CI/CD) | Dataset-dependent |

## Architecture

```
Code controls (deterministic)        Claude executes (Max subscription)
----------------------------        --------------------------------
Workflow Engine                      query() via Claude Agent SDK
  Topological sort                     LLM calls per step
  Dependency resolution                Web search, file ops
  Tier 1 Zod validation               Structured output (JSON Schema)
  Tier 2 LLM evaluation
  Budget control
  Graph validation
  Retry with exponential backoff
  Trace recording
```

## Context Engineering

Enforced rules in code, not just prompts:

- **Retrieve steps cannot access execution context** -- search queries contain only the user's original input, preventing context leakage
- **Minimal context** -- 100-token summaries instead of raw output (prevents context rot)
- **Fixed execution context structure** -- state/identity/tools as reproducible JSON

## Workflow Definition

YAML files, Git-versioned:

```yaml
name: "Document Pipeline"
config:
  defaultModel: "sonnet"
  topology: "pipeline"
  onValidationFail: "block"

steps:
  - id: "classify"
    type: "classify"
    context:
      identity:
        role: "analyzer"
        constraints: ["structured JSON output"]
      tools: []
    validation:
      rules:
        - type: "required_fields"
          spec: { fields: ["topics"] }
          message: "topics required"

  - id: "retrieve"
    type: "retrieve"
    dependsOn: ["classify"]
    context:
      identity:
        role: "researcher"
        constraints: ["official sources only"]
      tools: ["web_search"]

  - id: "generate"
    type: "generate"
    dependsOn: ["retrieve"]
    evaluation:
      enabled: true
      type: "groundedness"
      threshold: 0.7
      onFail: "flag"
```

## Step Types

| Type | Description |
|------|-------------|
| `classify` | Analyze and categorize input |
| `retrieve` | Search for evidence (context isolation enforced) |
| `generate` | Produce output content |
| `validate` | Check output quality (no modification) |
| `transform` | Restructure without changing content |
| `human_approval` | Wait for human approve/deny |
| `record_decision` | Log execution result for audit trail |

## Deployment Gate

```yaml
# gate-rules.yaml
rules:
  - metric: "avg_score"
    condition: ">= 0.75"
  - metric: "pass_rate"
    condition: ">= 0.8"
  - metric: "groundedness_avg"
    condition: ">= 0.7"
```

```bash
eddgate eval my-workflow --output results.json
eddgate gate --results results.json --rules gate-rules.yaml
```

## Monitoring

```bash
eddgate monitor status -p 7d    # success rate, latency, tokens, cost
eddgate monitor cost -p 30d     # cost breakdown by model and step
eddgate monitor quality -p 7d   # evaluation score trends
```

## Built-in Workflows

| Workflow | Steps | Use Case |
|----------|-------|----------|
| document-pipeline | 8 | Query analysis, link collection, answer generation, validation |
| code-review | 3 | Diff analysis, issue detection, review report |
| bug-fix | 4 | Reproduce, root cause, fix, verify |
| api-design | 3 | Requirements, endpoint design, documentation |
| translation | 3 | Source analysis, translation, quality check |

## Output Formats

- **stdout** -- real-time execution log
- **JSONL** -- structured trace (--trace-jsonl)
- **HTML** -- visual report with dark mode (--report)
- **TUI** -- interactive terminal dashboard (--tui)
- **JSON** -- machine-readable output (--json)

## Trace Adapters

- **Langfuse** -- auto-enabled via LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY
- **OpenTelemetry** -- compatible with Jaeger, Grafana Tempo, Datadog

## Research

- [RESEARCH_ANALYSIS.md](RESEARCH_ANALYSIS.md) -- 40+ papers, 16 frameworks analysis
- [CRITICAL_ANALYSIS.md](CRITICAL_ANALYSIS.md) -- pessimistic validation of each feature
- [ARCHITECTURE.md](ARCHITECTURE.md) -- architecture spec and design rationale

## License

MIT

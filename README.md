<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="eddgate logo">
</p>

<h1 align="center">eddgate</h1>

<p align="center">Self-improving evaluation loop for LLM workflows.</p>

Run workflows with validation gates, analyze failures, auto-generate rules, regression test. One CLI, one loop.

> **Coming from Promptfoo?** eddgate closes the loop that Promptfoo left open: failures are analyzed, rules are auto-generated, and applied on the next run. No data sent to any AI provider. Fully self-hosted.

```
run -> analyze -> test -> run (improved) -> ...
```

## Install

```bash
npm install -g eddgate
```

Requirements: Node.js 20+, Claude CLI (any subscription) or ANTHROPIC_API_KEY

## Quick Start

```bash
eddgate          # TUI mode -- select Run / Analyze / Test from menu
```

Or with commands:

```bash
eddgate init                          # scaffold project
eddgate doctor                        # check setup
eddgate run example -i input.txt      # run workflow
eddgate analyze -d traces             # find failure patterns
eddgate test snapshot -d traces       # save behavioral baseline
eddgate test diff -d traces           # detect regressions
```

## The Loop

```
1. eddgate run          Execute workflow with validation gates
        |
2. eddgate analyze      Find failure patterns, auto-generate rules
        |
3. eddgate run          Run again -- generated rules auto-applied
        |
4. eddgate test snapshot    Save current behavior as baseline
        |
   (modify prompts/workflows)
        |
5. eddgate test diff    Compare against baseline, catch regressions
        |
   ... repeat
```

No other tool does this. Promptfoo evaluates. Braintrust monitors. LangWatch traces. None of them close the loop from failure analysis back to execution improvement in one CLI.

## Validation Gates

Every step hits a gate. Fail = pipeline stops.

```
input -> [Step 1] -> [GATE] -> [Step 2] -> [GATE] -> [Step 3] -> [GATE] -> output
                       |                     |                     |
                     pass?                 pass?                 pass?
                     fail = STOP           fail = STOP           fail = STOP
```

Two tiers:
- **Tier 1**: Zod schema checks. Deterministic. 0% false positives. 5ms. Every step.
- **Tier 2**: LLM-as-judge. Groundedness/relevance. Key transitions only.

## Failure Analysis

```bash
eddgate analyze -d traces
```

```
  105 failures in 2 patterns:

  C1 Eval gate failed at "validate_final" (avg score: 0.75, 103 times)
     103 occurrences (98%)
     Score range: 0.42 - 0.85
     Fix: lower threshold or improve prompt specificity
     Rule: validate_final_adjusted_threshold.yaml

  C2 Rate limit hit at "validate_final" (2 times)
     Fix: add delay between steps or reduce maxRetries
```

```bash
eddgate analyze -d traces --generate-rules    # auto-create rules
eddgate analyze -d traces --context           # context window profiler
```

Generated rules are auto-loaded on next `eddgate run`.

## Regression Testing

```bash
eddgate test snapshot -d traces     # save baseline
# ... modify prompts ...
eddgate run my-workflow -i input.txt --trace-jsonl traces/new.jsonl
eddgate test diff -d traces         # compare against baseline
```

```
  REGRESSIONS (1):
    validate_final.evalScore
      before: 0.78
      after:  0.65
      -> REGRESSION

  PASS: No regressions.  (or)  FAIL: Regressions detected.
```

CI exit code 1 on regression. Plug into GitHub Actions.

## Context Window Profiler

```bash
eddgate analyze -d traces --context
```

```
  Per-step breakdown:

  Step                      Calls  Input      Output     Total      % of Total
  retrieve                  1      935        3,655      4,590      15.4%  ====
  generate_citation         2      6          6,908      6,914      23.2%  ======
  validate_final            48     63,744     38,400     102,144    34.3%  =========

  Waste detected:
    "validate_final" made 48 calls (2 expected) -- ~100K tokens wasted on retries

  Recommendations:
    Reduce retries for "validate_final" or lower eval threshold
```

## Commands

```bash
eddgate                    # TUI: Run / Analyze / Test
eddgate run <workflow>     # execute with gates
eddgate analyze            # failure patterns + rule generation
eddgate test <action>      # snapshot / diff / list
eddgate init               # scaffold project
eddgate doctor             # health check
eddgate list <type>        # workflows / roles
eddgate advanced ...       # eval, gate, monitor, viz, mcp, etc.
```

## Workflow Definition

```yaml
name: "My Pipeline"
config:
  defaultModel: "sonnet"
  topology: "pipeline"
  onValidationFail: "block"

steps:
  - id: "analyze"
    type: "classify"
    context:
      identity:
        role: "analyzer"
        constraints: ["output JSON"]
      tools: []
    validation:
      rules:
        - type: "required_fields"
          spec: { fields: ["topics"] }
          message: "topics required"

  - id: "generate"
    type: "generate"
    dependsOn: ["analyze"]
    evaluation:
      enabled: true
      type: "groundedness"
      threshold: 0.7
      onFail: "block"
```

## Parallel Execution

Independent steps run in parallel automatically with `topology: "parallel"`:

```yaml
config:
  topology: "parallel"  # independent steps run concurrently

steps:
  - id: "search_docs"
    type: "retrieve"
    tools: ["web_search"]

  - id: "search_code"
    type: "retrieve"
    tools: ["file_read"]

  - id: "combine"
    type: "generate"
    dependsOn: ["search_docs", "search_code"]  # waits for both
```

`search_docs` and `search_code` run simultaneously. `combine` waits for both. Typical speedup: 30-40% for workflows with independent retrieval steps.

## LLM Support

Auto-detects backend:

| Backend | Setup | Cost |
|---------|-------|------|
| Claude CLI | Any Claude subscription | Included |
| Anthropic API | `ANTHROPIC_API_KEY` | Per token |

## Built-in Workflows

| Workflow | Steps | Use |
|----------|-------|-----|
| document-pipeline | 8 | Document processing with citation |
| code-review | 3 | Diff analysis, issues, report |
| bug-fix | 4 | Reproduce, root cause, fix, verify |
| api-design | 3 | Requirements, endpoints, docs |
| translation | 3 | Analyze, translate, verify |

## Evaluation Thresholds

Default: **0.7** (industry standard for LLM-as-judge).

| Score | Meaning |
|-------|---------|
| 0.7+ | Pass -- acceptable quality |
| 0.8+ | Good -- bug-fix and translation use this |
| 0.9+ | Unrealistic for most LLM tasks (judge agreement is ~80-85%) |
| < 0.7 | Fail -- gate blocks, retry or stop |

Configurable per step in workflow YAML. `eddgate analyze` suggests adjusted thresholds based on observed score ranges.

## CI/CD Integration

```yaml
# .github/workflows/eddgate-loop.yml
name: eddgate loop
on:
  push:
    paths: ['templates/prompts/**', 'templates/workflows/**']

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build

      # Validate workflow graphs
      - run: node dist/cli/index.js doctor --ci -w templates/workflows

      # Check for regressions
      - run: node dist/cli/index.js test diff -d traces

      # Deployment gate
      - run: node dist/cli/index.js advanced gate --results eval-results.json --rules templates/gate-rules.yaml
```

`test diff` exits 1 on regression. `gate` exits 1 on threshold failure. CI blocks the merge.

## Docs

- [Architecture](docs/en/ARCHITECTURE.md)

## License

MIT

---

<p align="center">
  <a href="docs/ko/README.md">한국어</a>
</p>

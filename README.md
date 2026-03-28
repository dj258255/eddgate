<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="eddgate logo">
</p>

<h1 align="center">eddgate</h1>

<p align="center">Self-improving evaluation loop for LLM workflows.</p>

<p align="center">Full-screen terminal UI. Run workflows, analyze failures, auto-generate rules, regression test. One tool, one loop.</p>

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
eddgate
```

That's it. A full-screen terminal UI launches. Select Run, Analyze, or Test from the menu.

```
+---------------------------+----------------------------------------------------+
|  eddgate                  |                                                    |
+---------------------------+                                                    |
|                           |                                                    |
|  > Run                    |   Select a workflow, model, effort level,           |
|    Analyze                |   and input -- then watch it execute live.          |
|    Test                   |                                                    |
|    MCP                    |   Step progress on the left.                       |
|    Plugins                |   Streaming log on the right.                      |
|    Settings               |   Tokens, cost, elapsed time in the header.        |
|    Exit                   |                                                    |
|                           |                                                    |
+---------------------------+----------------------------------------------------+
|  Arrow keys: navigate  |  Enter: select  |  Esc: back  |  q: quit            |
+------------------------------------------------------------------------+
```

Everything happens inside the TUI: workflow execution with live dashboard, failure analysis, regression testing, MCP server management, plugin import, language switching.

### CLI mode (for CI/automation)

All TUI actions are also available as CLI commands for scripting and CI pipelines:

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
1. Run            Execute workflow with validation gates
      |
2. Analyze        Find failure patterns, auto-generate rules
      |
3. Run            Run again -- generated rules auto-applied
      |
4. Test snapshot  Save current behavior as baseline
      |
   (modify prompts/workflows)
      |
5. Test diff      Compare against baseline, catch regressions
      |
   ... repeat
```

No other tool does this. Promptfoo evaluates. Braintrust monitors. LangWatch traces. None of them close the loop from failure analysis back to execution improvement.

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

## TUI

Run `eddgate` for the full-screen terminal UI. Everything is accessible from menus -- no commands to memorize.

| Menu | What it does |
|------|-------------|
| **Run** | Select workflow, model, effort, thinking mode, input. Configure run options (HTML report, JSONL trace, budget limit, dry run). Live dashboard during execution. Results panel with step table after completion. |
| **Analyze** | Failure analysis, context profiler, offline eval, A/B prompt test, diff-eval, version-diff. |
| **Test** | Snapshot, diff, list snapshots, deployment gate (check thresholds). |
| **Monitor** | Status overview (success rate gauge, metrics table), cost breakdown (bar chart by model, table by step), quality scores (eval averages with distribution bars). All from saved traces. |
| **Traces** | Browse saved trace files. Select one to view: steps summary (left) + full event timeline (right) with color-coded events, token counts, scores. |
| **MCP** | Add/remove/list MCP servers without editing YAML. |
| **Plugins** | View workflows/roles, visualize workflow, debug single step, RAG index/search (Pinecone MCP), import from file. |
| **Settings** | Default model, language (Korean/English), view config, doctor (health check), init (scaffold project). |

Keyboard: Arrow keys navigate, Enter selects, Esc goes back, q quits, Tab switches panels.

### Run options

After selecting workflow/model/effort/thinking, a run options menu lets you configure:

| Option | What it does |
|--------|-------------|
| **Start run** | Proceed with current settings. |
| **Save HTML report** | Enter path -- generates dark-mode HTML report after execution. |
| **Save JSONL trace** | Enter path -- records all events during execution. |
| **Set budget limit** | Enter USD amount -- stops workflow if cost exceeds limit. |
| **Dry run** | Toggle on to preview workflow structure without executing. |

Options loop back so you can set multiple before starting.

### Run dashboard

During workflow execution, the TUI shows a live orchestration dashboard:

```
+---------------------------+----------------------------------------------------+
|  document-pipeline        |  Workflow: document-pipeline                        |
|  sonnet | high | 42s      |  Model: sonnet  Effort: high                       |
+---------------------------+  Elapsed: 42s  Tokens: 12,450  Cost: $0.02         |
|                           +----------------------------------------------------+
|  [done] classify_input    |  [STEP START] classify_input -> classifier          |
|  [done] retrieve_docs     |  [VALIDATION] pass                                 |
|  [run]  generate_draft    |  [STEP END] done 3.2s (2,100 tokens)               |
|  [ .. ] validate_final    |  [STEP START] retrieve_docs -> researcher           |
|  [ .. ] format_output     |  [RETRIEVAL] 3 chunks (avg score: 0.82)            |
|                           |  [STEP END] done 5.1s (4,350 tokens)               |
|                           |  [STEP START] generate_draft -> writer              |
|                           |  ...                                                |
+---------------------------+----------------------------------------------------+
```

## CLI Commands (for CI/automation)

All TUI actions are also available as commands for scripting and CI pipelines.

### Core

| Command | What it does |
|---------|-------------|
| `eddgate run <workflow>` | Execute a workflow with validation gates. Fails fast on bad output. |
| `eddgate analyze` | Cluster failure patterns, suggest fixes. `--generate-rules` creates YAML rules. `--context` shows token usage. |
| `eddgate test snapshot` | Save current behavioral baseline from traces. |
| `eddgate test diff` | Compare against baseline. Exits 1 on regression (CI-friendly). |
| `eddgate test list` | Show saved snapshots. |
| `eddgate init` | Create project structure. |
| `eddgate doctor` | Check Node.js, Claude CLI, config validity, graph integrity. |
| `eddgate list workflows` | List available workflow YAML files. |
| `eddgate list roles` | List available role definitions. |

### Run flags

| Flag | What it does |
|------|-------------|
| `-i, --input <file>` | Input file or text. If file, contents are read. |
| `-m, --model <model>` | Override model: `sonnet`, `opus`, `haiku`, `claude-opus-4-5`, `claude-sonnet-4-5` |
| `-e, --effort <level>` | Effort: `low`, `medium`, `high`, `max` |
| `--report <path>` | Generate HTML report (dark mode, collapsible steps, score gauges). |
| `--trace-jsonl <path>` | Save structured JSONL trace for later analysis. |
| `--max-budget-usd <n>` | Stop workflow if accumulated cost exceeds this amount. |
| `--dry-run` | Preview workflow structure without executing. |
| `--json` | Machine-readable JSON output. |
| `--quiet` | Errors only. |

### Advanced

| Command | What it does |
|---------|-------------|
| `eddgate advanced eval <workflow>` | Re-score saved traces using LLM judge. |
| `eddgate advanced diff-eval <workflow>` | Compare eval scores between git commits. |
| `eddgate advanced gate` | Deployment gate. Exits 1 if thresholds not met. |
| `eddgate advanced monitor status` | Success rate, p50/p95 latency, tokens, cost. |
| `eddgate advanced monitor cost` | Cost breakdown by model and step. |
| `eddgate advanced monitor quality` | Eval score trends over time. |
| `eddgate advanced viz <workflow>` | Mermaid diagram or ASCII visualization. |
| `eddgate advanced step <workflow> <step-id>` | Run a single step in isolation. |
| `eddgate advanced trace <file>` | View JSONL trace with timeline. |
| `eddgate advanced mcp <action>` | Manage MCP servers: `list`, `add`, `remove`. |
| `eddgate advanced version-diff` | Prompt/workflow changes between git commits. |
| `eddgate advanced rag index` | Chunk documents and upsert to Pinecone via MCP. |
| `eddgate advanced rag search <query>` | Search Pinecone index, return ranked chunks. |
| `eddgate advanced ab-test` | Run same workflow with two prompt variants, compare scores. |

## RAG Pipeline (Pinecone MCP)

Index documents into Pinecone, then use vector search in workflows.

```bash
# Index documents
eddgate advanced rag index -d docs/ --index my-docs

# Search
eddgate advanced rag search "how does auth work?" --index my-docs
```

Or from the TUI: **Plugins > RAG index / RAG search**.

Built-in `rag-pipeline` workflow: classify query -> vector search -> grounded generation -> validate groundedness.

```yaml
steps:
  - id: "retrieve_context"
    type: "retrieve"
    context:
      tools: ["mcp:pinecone:search-records"]
  - id: "generate_answer"
    type: "generate"
    evaluation:
      type: "groundedness"
      threshold: 0.7
```

Requires Pinecone MCP server configured in `eddgate.config.yaml`.

## A/B Prompt Testing

Compare two prompt variants on the same workflow and input.

```bash
eddgate advanced ab-test \
  --workflow document-pipeline \
  --prompt-a templates/prompts/analyzer.md \
  --prompt-b templates/prompts/analyzer.v2.md \
  -i input.txt \
  -n 3
```

Or from the TUI: **Analyze > A/B prompt test**.

Output:

```
  Metric               Variant A      Variant B      Delta
  ──────────────────── ────────────── ────────────── ──────────────
  Avg Score            0.742          0.819          +0.077
  Avg Tokens           8,450          7,200          -1,250
  Avg Cost             $0.0234        $0.0198        -0.0036
  Avg Time             12.3s          10.8s          -1.5s

  Winner: Variant B
  Score advantage: 0.077
```

Winner logic: higher score wins. If scores within 0.02, lower cost wins.

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
| rag-pipeline | 4 | Query classify, vector search, grounded generation, validate |

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

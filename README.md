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

## When Do I Use This?

eddgate is for **any multi-step AI task where quality matters**. If you're copy-pasting into ChatGPT and hoping for the best, eddgate replaces that with a repeatable, verifiable pipeline.

### Real scenarios

| I want to... | Workflow to use | What I feed in | What I get out |
|---|---|---|---|
| Summarize a long report with proper citations | `document-pipeline` | `report.pdf` or `report.md` | Structured summary with `[1]` citations and reference list |
| Translate technical docs to Korean and verify accuracy | `translation` | `docs/api-guide.md` (English) | Korean translation + accuracy verification score |
| Review a pull request diff for bugs | `code-review` | `git diff > changes.txt` | Issue list with severity, line references, fix suggestions |
| Debug a production error | `bug-fix` | Error log pasted as text | Root cause analysis + fix proposal + verification |
| Answer questions from company documents | `rag-pipeline` | Question text (docs pre-indexed) | Grounded answer with source citations, hallucination score |
| Process customer complaints into structured data | Custom workflow | `complaints.csv` or email text | JSON with categories, urgency, recommended actions |

### First time? Start here

```bash
eddgate                    # launch TUI
# 1. Select "Run" from menu
# 2. Pick "document-pipeline" (or any workflow)
# 3. Choose "Select file" -> pick any .txt or .md file
# 4. Model: Sonnet (default, good enough for most tasks)
# 5. Choose "Dry run" first to see the structure without spending
# 6. When ready, choose "Start run" and watch the live dashboard
```

After the run, check the results panel. If quality looks good, enable "Save JSONL trace" on the next run -- that trace file is what powers Analyze, Test, and Monitor.

### The typical workflow

```
Day 1:  Run with trace enabled -> get baseline results
Day 2:  Analyze failures -> auto-generate rules
Day 3:  Run again -> rules auto-applied, quality improves
Day 4:  Test snapshot -> save this good state
Day N:  Edit prompt -> Test diff -> verify no regression -> deploy
```

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

**What are these?** Automatic quality checkpoints between each step. If a step produces garbage, the pipeline stops immediately instead of wasting tokens on the next step. You don't need to configure these -- they're defined in the workflow YAML and run automatically.

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

**When to use**: You ran a workflow and the results were bad (failed steps, low quality scores, unexpected outputs). This command reads your trace files and tells you *what* went wrong, *how often*, and *how to fix it*. It can also auto-generate rules that prevent the same failure next time.

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

**When to use**: Your pipeline works well and you want to make sure future changes (prompt edits, model switches, config tweaks) don't break it. Think of it like unit tests for your AI pipeline.

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

**When to use**: Your workflow costs more than expected, or takes too long. The profiler reads your traces and shows exactly which step is burning the most tokens (= money). Common finding: a validation step retrying 48 times when it should retry 2.

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
| `eddgate advanced improve` | Auto-suggest prompt fixes from failure analysis. `--apply` to auto-write. |
| `eddgate serve` | Start HTTP API server for workflow execution. `--port 3000` |

## RAG Pipeline (Pinecone MCP)

**When to use**: You have a folder of company documents (PDFs, markdown, text files) and want AI to answer questions based on those documents instead of making things up. First index the documents, then use `rag-pipeline` workflow to query them.

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

**When to use**: You rewrote a prompt and want to know if the new version is actually better, not just different. Runs both versions on the same input and uses a statistical test (Welch's t-test) to determine if the difference is real or just random noise.

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

Winner logic: uses Welch's t-test (p < 0.05) to determine statistical significance. Reports p-value and 95% confidence interval. Runs are interleaved (ABABAB) to eliminate ordering bias.

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

| Workflow | What to feed in | What you get | Steps |
|----------|----------------|-------------|-------|
| `document-pipeline` | Any long document (.md, .txt, .pdf text) -- e.g. a 30-page policy doc | Structured summary with `[1]` citations, organized by topic, with reference list | 8 |
| `code-review` | A diff file (`git diff > changes.txt`) or code snippet | Issue list: severity, line numbers, what's wrong, how to fix | 3 |
| `bug-fix` | Error log, stack trace, or bug description text | Root cause analysis + proposed fix + verification that the fix works | 4 |
| `api-design` | Requirements doc or feature description | OpenAPI-style endpoint design + request/response examples + docs | 3 |
| `translation` | Any text file in source language | Translated text + back-translation accuracy score (catches mistranslations) | 3 |
| `rag-pipeline` | A question (docs must be indexed first via Plugins > RAG) | Answer grounded in your documents + source citations + hallucination score | 4 |

Don't see what you need? Copy any YAML, edit the steps, and you have a custom workflow. Or import one via **Plugins > Import workflow**.

## Evaluation Thresholds

Default: **0.7** (industry standard for LLM-as-judge).

| Score | Meaning |
|-------|---------|
| 0.7+ | Pass -- acceptable quality |
| 0.8+ | Good -- bug-fix and translation use this |
| 0.9+ | Unrealistic for most LLM tasks (judge agreement is ~80-85%) |
| < 0.7 | Fail -- gate blocks, retry or stop |

Configurable per step in workflow YAML. `eddgate analyze` suggests adjusted thresholds based on observed score ranges.

## Auto Prompt Improvement

**When to use**: You ran a workflow, some steps failed, and you want to know *how to fix the prompt* -- not just *that it failed*. This reads your failure patterns and generates concrete prompt edits, then lets you review each one before applying.

```bash
# CLI: auto-suggest and apply
eddgate advanced improve -d traces --prompts templates/prompts --apply

# CLI: preview only
eddgate advanced improve -d traces --prompts templates/prompts --dry-run
```

Or from the TUI: **Analyze > Auto-improve prompts**.

### How it works

```
1. Reads traces/*.jsonl -> finds failure clusters (same as Analyze)
2. For each failing step, loads the prompt file (templates/prompts/<role>.md)
3. Sends current prompt + failure patterns to LLM -> gets rewritten prompt
4. Shows you the diff: original (left) vs suggested (right)
5. You choose: Approve / Modify / Skip for each suggestion
6. Approved changes are written to the prompt file immediately
```

### TUI approval flow

```
+--- Original Prompt ---+--- Suggested Prompt ---+
| You are an analyst.   | You are an analyst.    |
| Extract key topics.   | Extract key topics.    |
|                       | Output MUST be JSON.   |  <- added
|                       | Example: {"topics":..} |  <- added
+-----------------------+------------------------+
|  [Approve]  [Modify]  [Skip]                   |
+------------------------------------------------+
```

Each suggestion includes confidence level (high/medium/low) and the failure pattern that triggered it.

## API Server

**When to use**: You want to trigger eddgate workflows from another system (a web app, a Slack bot, a cron job) without using the CLI directly.

```bash
eddgate serve --port 3000
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (status, version, uptime) |
| `GET` | `/workflows` | List available workflow YAML files |
| `POST` | `/run` | Start a workflow (returns runId immediately) |
| `GET` | `/runs` | List all runs with status |
| `GET` | `/runs/:id` | Get run result (steps, tokens, cost, eval scores) |

### Example

```bash
# Start server
eddgate serve --port 3000

# From another terminal:
# Start a workflow
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{"workflow": "document-pipeline", "input": "Summarize this report..."}'
# -> {"runId": "run-1711...", "status": "running"}

# Check status
curl http://localhost:3000/runs/run-1711...
# -> {"status": "completed", "result": {"totalCost": 0.02, "steps": [...]}}
```

Workflows execute asynchronously -- POST /run returns immediately with a `runId`, then you poll GET /runs/:id for the result. No external dependencies (uses Node.js built-in `http` module).

## Cross-Run Memory

**When to use**: You don't need to configure anything. This works automatically. Every time you run a workflow, eddgate remembers what happened (which steps failed, what scores were, what errors occurred). Next time you run the same workflow, that knowledge is injected into the AI's system prompt so it can avoid previous mistakes.

### How it works

```
Run #1: "validate_final" fails 3 times with "missing citations"
        -> saved to .eddgate/memory/

Run #2: System prompt now includes:
        "Previous Run Insights (1 run, 0% success rate)
         Known issues: validate_final failed 3x: missing citations
         Avg quality: validate_final: 0.45 (problematic)"
        -> AI knows to add citations this time
```

### What gets stored

Stored in `.eddgate/memory/` as JSON files (max 50, auto-pruned):

- Workflow name, status, duration, cost
- Per-step: status, eval score, error message
- Aggregated into: success rate, top issues, avg scores per step

### What gets injected

Before each run, a concise summary is built and appended to every agent's system prompt:

```
## Previous Run Insights (5 runs, 60% success rate)

Known issues from previous runs:
- validate_final: 3 failures (missing required citations)
- generate_draft: 2 failures (output too short)

Average quality scores by step:
- classify_input: 0.85 (good)
- generate_draft: 0.52 (needs attention)
- validate_final: 0.45 (problematic)
```

This is automatic and non-blocking -- if memory loading fails, the workflow runs normally without it.

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

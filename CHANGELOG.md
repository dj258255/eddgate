# Changelog

## 0.1.0 (2026-03-29) -- Refactor

Critical bug fixes, comprehensive test suite, Liquid Glass TUI theme, UX improvements, new features.

### New Features (Post-Refactor)
- Auto prompt improvement: analyze failures -> LLM-generated prompt patches -> TUI approve/modify/skip
- API server (`eddgate serve`): HTTP endpoints for workflow execution (POST /run, GET /runs/:id)
- Cross-run memory: auto-save run results to .eddgate/memory/, inject insights into next run's system prompt
- Human-in-the-loop: TUI-based diff review for prompt changes with approve/modify/skip flow

### Critical Fixes
- workflow-engine: cycle detection in topologicalSort (was silently producing wrong order)
- workflow-engine: parallel budget tracking (was unlimited cost in parallel layers)
- workflow-engine: fan-in merges all dependencies (was using only the last one)
- workflow-engine: retry policy implementation (was declared but ignored)
- workflow-engine: error context preserved in StepResult.error field
- workflow-engine: p-limit concurrency control (prevents rate limiting)
- agent-runner: jitter on exponential backoff (prevents thundering herd)
- agent-runner: structured error detection via statusCode
- agent-runner: safe score extraction (rejects non-score numbers)
- agent-runner: groundedness eval now receives source context
- agent-runner: evaluation retry (2 attempts) with separate trace ID
- tier1-rules: minItems metadata key separation (was treated as schema field)
- tier1-rules: markdown format check uses real patterns (was trivially bypassable)
- tier1-rules: unknown custom check returns false (was silently passing)
- tier2-llm: connected to workflow engine (was dead code)
- trace/emitter: async listener errors safely caught
- trace/emitter: parentSpanId for span hierarchy
- trace/emitter: toolCall() convenience method
- trace/emitter: MAX_BUFFER_SIZE (10K) + flush()

### New Features
- 3 new validation rule types: range, enum, not_empty
- Welch's t-test for A/B prompt comparison (p-value, confidence interval)
- A/B test interleaving (ABABAB) to eliminate ordering bias
- RAG pipeline: heading-aware chunking, diversity reranking, tracer integration
- context-builder: state transition validation, safe JSON truncation, MCP tool validation

### Liquid Glass TUI Theme
- Apple Liquid Glass-inspired design: layered depth, frosted borders, cool blue-cyan palette
- Applied to: main screen, run dashboard, panels, split view, captured command output
- Unicode glyphs throughout (check/x/warning/diamond/block chars)
- theme.ts design system with palette, glyphs, style presets, formatting helpers

### UX Improvements
- File browser replaces text input for all path selections
- Help system: ? key shows context-sensitive help overlay per menu
- Help text in i18n (en.json + ko.json) with concrete scenarios and file examples
- All panel hints show "Press ? for help"
- ANSI/chalk code stripping in captured command output

### Documentation
- README: "When Do I Use This?" section with scenario table
- README: concrete Built-in Workflows table (what to feed, what you get)
- README: "when to use" for every major feature section
- i18n help: beginner-friendly Korean with real file names and step-by-step guides
- docs/REFACTOR-REPORT.md: complete audit trail

### Test Suite
- 219 tests across 10 files (was 3 tests in 1 meaningful file)
- New: workflow-engine.test.ts (18), tier1-rules.test.ts (72), normalize-score.test.ts (26)
- New: trace-emitter.test.ts (30), context-builder.test.ts (27), rag-pipeline.test.ts (18)
- Mock LLM adapter for deterministic engine testing

### Dependencies
- Added: p-limit (concurrency control)
- Added: peerDependencies for langfuse and @opentelemetry/api (optional)
- Added: pretest build hook

## 0.1.0 (2026-03-28) -- Initial Release

Self-improving evaluation loop for LLM workflows.

### Core Loop

```
run -> analyze -> test -> run (improved)
```

Three things combined that don't exist together anywhere else:
1. Validation gates (EDDOps) -- deterministic checks between workflow steps
2. Error analysis (Hamel Husain's approach) -- cluster failures, auto-generate rules
3. Regression testing (Percy/Chromatic for agents) -- snapshot behavior, diff changes

### Blessed TUI (Full-Screen Terminal UI)

- Orchestration dashboard style (Ralph TUI pattern)
- All interactions stay inside blessed -- no screen switching
- Menu: Run / Analyze / Test / MCP / Plugins / Settings / Exit
- Run dashboard: step progress (left) + streaming log (right) during execution
- Analyze/Test output captured in blessed log box
- Split view for test diff (before/after) and rule preview (patterns/rules)
- Blessed-native prompts: select, text input, confirm, message dialogs
- File browser with folder navigation (enter dirs, go up, select files)
- File/text input selection when running workflows
- Main loop: Esc returns to menu, Exit shows "bye"
- Back buttons in all sub-menus
- Mouse click support on all lists

### Claude Code Integration

- Reads installed plugins from ~/.claude/plugins/installed_plugins.json
- Reads MCP servers from .mcp.json and ~/.claude/mcp.json
- Plugins panel shows: eddgate workflows + roles + Claude Code plugins
- MCP panel shows: eddgate servers + Claude Code MCP servers

### i18n (Korean/English)

- Separate JSON files: src/i18n/en.json, src/i18n/ko.json
- t("path.to.key") function for all UI text
- All panels, menus, prompts, messages translated
- Language setting in config, auto-loaded on startup
- Change language from Settings menu (instant re-render)

### Models & Thinking

- Full model list: Opus 4.6, Sonnet 4.6, Haiku 4.5, Opus 4.5, Sonnet 4.5
- Effort levels: low / medium / high / max
- Extended thinking: off / adaptive / enabled
- Model/effort/thinking selection in TUI and CLI flags

### Commands

Core (visible in main help):
- `run`: Execute workflow with validation gates
- `analyze`: Cluster failures, auto-generate rules, context profiler
- `test`: Behavioral snapshots + regression diff
- `init`, `doctor`, `list`

Advanced (under `eddgate advanced`):
- `eval`, `diff-eval`, `gate`, `monitor`, `version-diff`, `mcp`, `viz`, `step`, `trace`

### Engine

- Pipeline/parallel/single topology with topological sort
- Tier 1 Zod validation (deterministic, 0% false positives, 5ms)
- Tier 2 LLM evaluation at key transitions (threshold 0.7)
- Infinite retry prevention (_isRetry flag)
- Error recovery with exponential backoff
- Cost budget control (--max-budget-usd)
- Graph validator (cycle detection, dangling refs)
- Context Engineering: retrieve steps isolated from execution context
- Auto-load generated rules from eval/rules/
- record_decision step type for audit trail
- Score normalization (0-1, 0-5, 0-10, 0-100 ranges)

### LLM Adapters

- LLMAdapter interface for pluggable backends
- ClaudeSDKAdapter (any Claude subscription)
- AnthropicAPIAdapter (ANTHROPIC_API_KEY)
- Extended thinking support
- Auto-detection: Claude CLI -> Anthropic API -> fallback

### Templates

- 6 workflows: document-pipeline, code-review, bug-fix, api-design, translation, rag-pipeline
- 8 role definitions + prompts
- gate-rules.yaml for deployment gates

### Output

- stdout, JSONL trace, HTML report (dark mode), JSON
- Langfuse and OpenTelemetry adapters (optional)
- blessed-contrib ready for result charts

### Docs

- docs/en/ARCHITECTURE.md
- docs/ko/README.md + ARCHITECTURE.md
- README with logo, loop diagram, threshold guide, CI example

### CI/CD

- GitHub Actions: ci.yml, eval.yml
- test diff exits 1 on regression
- gate exits 1 on threshold failure

### Tests

- 63 tests at initial release

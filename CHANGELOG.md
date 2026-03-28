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

- 5 workflows: document-pipeline, code-review, bug-fix, api-design, translation
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

- 63 tests passing (unit + integration)

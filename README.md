# eddgate

Evaluation-gated workflow engine for LLM agents.

Runs deterministic validation gates between workflow steps. If a step's output fails validation, the pipeline stops. No bad output passes through.

Works with Claude CLI (any subscription) or Anthropic API.

## Install

```bash
npm install -g eddgate
```

## Get Started

```bash
eddgate init          # create project structure
eddgate doctor        # check setup
eddgate run example --input input.txt --dry-run   # preview
eddgate run example --input input.txt             # execute
```

## How It Works

```
input
  |
  v
[Step 1: classify] --> [Validation Gate] --> pass? --> [Step 2: retrieve]
                              |
                              v
                        fail? --> STOP
```

Each step runs through Claude (or any LLM), then hits a validation gate:

- **Tier 1 (every step)**: Zod schema checks. Deterministic. 0% false positives. 5ms.
- **Tier 2 (key transitions)**: LLM-as-judge. Groundedness/relevance scoring.

If validation fails, the pipeline blocks. No silent failures.

## Workflow Example

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
        constraints: ["output JSON with topics array"]
      tools: []
    validation:
      rules:
        - type: "required_fields"
          spec: { fields: ["topics"] }
          message: "topics field required"

  - id: "generate"
    type: "generate"
    dependsOn: ["analyze"]
    evaluation:
      enabled: true
      type: "groundedness"
      threshold: 0.7
      onFail: "block"
```

## LLM Support

eddgate auto-detects the best available backend:

| Backend | Setup | Cost |
|---------|-------|------|
| **Claude CLI** (default) | Any Claude subscription + `claude` installed | Included in subscription |
| **Anthropic API** | Set `ANTHROPIC_API_KEY` | Pay per token |

No lock-in. The adapter pattern lets you plug in any LLM.

## Built-in Workflows

```bash
eddgate run document-pipeline --dry-run -w templates/workflows
eddgate run code-review --dry-run -w templates/workflows
eddgate run bug-fix --dry-run -w templates/workflows
eddgate run api-design --dry-run -w templates/workflows
eddgate run translation --dry-run -w templates/workflows
```

## Advanced

```bash
eddgate advanced step <workflow> <step-id>   # debug single step
eddgate advanced trace <file>                # view trace
eddgate advanced eval <workflow>             # offline evaluation
eddgate advanced monitor status              # metrics dashboard
eddgate advanced gate --results r.json --rules rules.yaml  # deploy gate
eddgate advanced viz <workflow>              # Mermaid diagram
```

## Output Formats

- stdout (real-time log)
- `--report report.html` (visual report, dark mode)
- `--trace-jsonl trace.jsonl` (structured trace)
- `--tui` (interactive terminal dashboard)
- `--json` (machine-readable)

## License

MIT

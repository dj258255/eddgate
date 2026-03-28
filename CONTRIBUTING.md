# Contributing to eddgate

## The Core Loop

Everything in eddgate serves this loop:

```
run -> analyze -> test -> run (improved)
```

If a feature doesn't serve this loop, it probably doesn't belong here.

## Development

```bash
git clone https://github.com/dj258255/eddgate.git
cd eddgate
npm install
npm run build
npm test
```

## Structure

```
src/
  cli/              Commands + TUI (clack, Ink)
  core/             Workflow engine, context builder, agent runner, LLM adapter
  eval/             Tier 1 rules, Tier 2 LLM eval, Tier 3 offline, rule loader
  trace/            Emitter, replay, Langfuse/OTel adapters
  render/           HTML report, Ink dashboard, TUI report
  config/           YAML loader, Zod schemas
  types/            TypeScript types

templates/          Workflows, roles, prompts, gate rules
tests/              Unit + integration
```

## Tests

```bash
npm test              # all tests
npm run test:watch    # watch mode
npm run typecheck     # types only
```

## Adding a Workflow

1. Create `templates/workflows/name.yaml`
2. Create role prompts in `templates/prompts/`
3. Test: `eddgate run name --dry-run -w templates/workflows`
4. Add integration test

## Adding a Validation Rule

1. Add to `src/eval/tier1-rules.ts`
2. Add type to `ValidationRuleType` in `src/types/index.ts`
3. Update Zod schema in `src/config/schemas.ts`
4. Add test in `tests/unit/tier1-rules.test.ts`

## Commit Style

Clear descriptions. No emoji. No AI attribution.

## Code Style

TypeScript strict. ESM. Minimal abstractions. Test what matters.

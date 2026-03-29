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
  cli/              Commands + blessed TUI (full-screen terminal UI)
  core/             Workflow engine, context builder, agent runner, LLM adapter
  eval/             Tier 1 rules, Tier 2 LLM eval, Tier 3 offline, rule loader
  trace/            Emitter, replay, Langfuse/OTel adapters
  render/           HTML report, Ink dashboard, TUI report
  config/           YAML loader, Zod schemas
  types/            TypeScript types
  i18n/             Localization (en.json, ko.json)

templates/          Workflows, roles, prompts, gate rules
tests/              Unit + integration
```

## Tests

Tests require a build step (handled automatically by `pretest` hook):

```bash
npm test              # builds first, then runs vitest
npm run test:watch    # watch mode (requires prior build)
npm run typecheck     # types only (no build)
```

Current: 219 tests across 10 files.

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

## Adding a Custom Check

1. Add case to `checkCustom()` in `src/eval/tier1-rules.ts`
2. Add test in `tests/unit/tier1-rules.test.ts`
3. Unknown check names now return `false` by default -- no silent pass-through

## Commit Style

Clear descriptions. No emoji. No AI attribution.

## Code Style

TypeScript strict. ESM. Minimal abstractions. Test what matters.

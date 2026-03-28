# Contributing to eddgate

## Development Setup

```bash
git clone <repo-url>
cd eddgate
npm install
npm run build
npm test
```

## Project Structure

```
src/
  cli/          CLI commands (Commander.js)
  core/         Workflow engine, context builder, agent runner, graph validator
  eval/         Tier 1 rules, Tier 2 LLM, Tier 3 offline
  trace/        Trace emitter, replay, output adapters (Langfuse, OTel)
  render/       HTML report, TUI dashboard
  config/       YAML loader, Zod schemas
  types/        TypeScript type definitions

templates/
  workflows/    YAML workflow definitions
  roles/        YAML role definitions
  prompts/      Markdown role prompts

tests/
  unit/         Unit tests (vitest)
  integration/  CLI integration tests
```

## Running Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run typecheck     # type check only
```

## Adding a Workflow Template

1. Create `templates/workflows/your-workflow.yaml`
2. Define steps with validation rules and evaluation config
3. Create role prompts in `templates/prompts/`
4. Test with `eddgate run your-workflow --dry-run`
5. Add integration test in `tests/integration/`

## Adding a Validation Rule

1. Add rule type to `src/eval/tier1-rules.ts`
2. Add type to `ValidationRuleType` in `src/types/index.ts`
3. Add Zod schema in `src/config/schemas.ts`
4. Add unit test in `tests/unit/tier1-rules.test.ts`

## Commit Messages

Use clear, descriptive commit messages. No emoji.

## Code Style

- TypeScript strict mode
- ESM modules
- No unnecessary abstractions
- Test what matters

# Testing

## Test Framework
- **None configured.** No test files, no test runner setup, no test scripts in `package.json`.
- Bun has a built-in test runner (`bun test`) but it is not used.

## Test Files
- No `*.test.ts`, `*.spec.ts`, or `__tests__/` directories exist.
- No `test/` or `tests/` directory.

## Coverage
- **0% automated test coverage.**
- The codebase is a proof-of-concept — correctness is validated by running the script and observing console output.

## Manual Testing Approach
The implicit test process:
1. Start PostgreSQL: `docker compose up -d`
2. Run the script: `bun run index.ts`
3. Observe console output:
   - `"Users table is ready."`
   - `"pg-boss schema is ready."`
   - `"Is pg-boss installed: true"`
   - `"User inserted inside transaction"`
   - `"Job staged inside transaction"`
   - `"Transaction committed. Job is now visible to workers."`
   - `"received job <id> with data {"email":"john@example.com"}"`

## Mocking
- No mocking infrastructure.
- Integration with real PostgreSQL is the only verification method.

## CI/CD
- No CI configuration (no `.github/`, `.gitlab-ci.yml`, etc.)

## Recommendations (not implemented)
If tests were to be added:
- Use `bun:test` (built-in) with `describe`/`it`/`expect`
- Mock `pg.Pool` or use a test database
- Test `KyselyBossAdapter.executeSql()` independently
- Integration tests would require a real or containerized PostgreSQL

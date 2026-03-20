# Tech Stack

## Runtime
- **Bun** v1.3.5 — all-in-one JavaScript runtime (install, run, test, bundle)
- Entry point: `bun run index.ts`

## Language
- **TypeScript** 5.x (strict mode)
- ESNext target, `verbatimModuleSyntax`, `moduleResolution: bundler`
- No emit (Bun executes TS directly)

## Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `kysely` | ^0.28.9 | Type-safe SQL query builder |
| `pg` | ^8.16.3 | PostgreSQL client (node-postgres) |
| `pg-boss` | ^12.5.4 | Durable job queue on PostgreSQL |

## Dev Dependencies
- `@types/bun` — Bun type definitions
- `@types/pg` — pg type definitions
- `typescript` ^5 (peer dep)

## Database
- **PostgreSQL** — only external infrastructure dependency
- Managed via Docker Compose (`docker-compose.yaml`)
- Connection via `pg.Pool` with hardcoded connection string: `postgres://admin:pass@localhost:15432/postgres`

## Package Manager
- **Bun** (lockfile: `bun.lock`)
- No npm/yarn/pnpm

## Module System
- ESM (`"type": "module"`)
- Single entry point: `index.ts`

## TypeScript Configuration (`tsconfig.json`)
```json
{
  "strict": true,
  "target": "ESNext",
  "module": "Preserve",
  "moduleResolution": "bundler",
  "allowImportingTsExtensions": true,
  "verbatimModuleSyntax": true,
  "noEmit": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true
}
```

## Build / Run
- No build step — Bun executes TypeScript directly
- No test runner configured
- No linter/formatter configured (no ESLint, Prettier config)
- No CI/CD configuration

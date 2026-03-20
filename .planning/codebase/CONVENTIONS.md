# Conventions

## Code Style
- No linter or formatter configured (no ESLint, Prettier, Biome config files)
- Bun's default TypeScript handling is used without additional tooling
- Indentation: 2 spaces (consistent throughout `index.ts`)
- Trailing commas: used in object literals and function args

## TypeScript Patterns

### Strict mode enabled
```ts
// tsconfig.json
"strict": true,
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true
```

### Kysely type-safe schema
Domain types are defined as interfaces and passed as generics:
```ts
interface User {
  id: Generated<number>;
  email: string;
  created_at: ColumnType<Date, string | undefined, never>;
}
interface Database {
  users: User;
}
const kysely = new Kysely<Database>({ dialect });
```

### Import style
Named imports preferred; `type` keyword for type-only imports:
```ts
import {
  Kysely,
  Transaction,
  CompiledQuery,
  PostgresDialect,
  type Generated,
  type ColumnType,
} from "kysely";
```

## Class Design
- Constructor uses `private readonly` for injected dependencies:
  ```ts
  constructor(private readonly runner: Kysely<Database> | Transaction<Database>) {}
  ```
- Single-responsibility: `KyselyBossAdapter` only adapts pg-boss's SQL interface to Kysely

## Function Organization
- Top-level async functions (`setupSchema`, `registerUser`, `main`) — no class wrappers
- Functions called sequentially from `main()`
- Side effects (console.log) used for observability in lieu of a logging framework

## Error Handling
- `main().catch(err => { console.error(err); process.exit(1); })` — top-level catch
- `boss.on("error", console.error)` — pg-boss error event listener
- No try/catch within individual functions
- Job worker throws if job is missing:
  ```ts
  if (!job) { throw new Error(); }
  ```
  (empty Error — no message)

## Naming
- **Interfaces:** PascalCase (`User`, `Database`)
- **Classes:** PascalCase (`KyselyBossAdapter`)
- **Functions:** camelCase (`setupSchema`, `registerUser`)
- **Constants:** camelCase (`kysely`, `pool`, `dialect`, `boss`)
- **Queue string literals:** kebab-case (`"welcome-email"`) and camelCase (`"userQueue"`)

## Async Pattern
- All async operations use `async/await`
- No raw Promise chains (.then/.catch) in business logic
- `await` at every async call site

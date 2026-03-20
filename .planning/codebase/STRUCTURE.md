# Structure

## Directory Layout

```
kysely-pgboss-pubsub-poc/
├── index.ts                  # Single source file — entire application
├── package.json              # Dependencies, module config
├── tsconfig.json             # TypeScript compiler options
├── bun.lock                  # Bun lockfile
├── docker-compose.yaml       # PostgreSQL local dev setup
├── README.md                 # Basic run instructions
├── .gitignore                # Standard Node/Bun ignores
├── .opencode/                # OpenCode AI tool configuration
│   ├── opencode.json
│   ├── settings.json
│   ├── package.json
│   ├── gsd-file-manifest.json
│   └── get-shit-done/        # GSD workflow scripts and templates
└── node_modules/             # Dependencies (gitignored)
```

## Key Locations

| File | Purpose |
|------|---------|
| `index.ts` | Entire application — types, setup, adapter, business logic |
| `package.json` | Runtime=Bun, ESM, dependencies declaration |
| `tsconfig.json` | Strict TS config, bundler resolution, noEmit |
| `docker-compose.yaml` | PostgreSQL container for local development |
| `bun.lock` | Reproducible dependency installs |

## Source Structure (within `index.ts`)

```
index.ts
├── Imports (lines 1-10)
│   └── kysely, pg, pg-boss
├── Type Definitions (lines 12-20)
│   ├── interface User
│   └── interface Database
├── DB Setup (lines 22-30)
│   ├── const pool (pg.Pool)
│   ├── const dialect (PostgresDialect)
│   └── const kysely (Kysely<Database>)
├── KyselyBossAdapter class (lines 32-44)
│   └── executeSql() method
├── setupSchema() function (lines 46-57)
│   └── CREATE TABLE users (Kysely DDL)
├── registerUser() function (lines 59-112)
│   ├── schemaBoss init/start/stop (schema-only)
│   ├── boss init/start
│   ├── boss.createQueue()
│   ├── kysely.transaction() with INSERT + boss.publish()
│   ├── boss.subscribe()
│   └── boss.work() with handler
└── main() + invocation (lines 114-122)
```

## Naming Conventions

- **Files:** kebab-case (`docker-compose.yaml`)
- **Classes:** PascalCase (`KyselyBossAdapter`)
- **Functions:** camelCase (`setupSchema`, `registerUser`, `main`)
- **Variables:** camelCase (`kysely`, `pool`, `dialect`, `boss`, `schemaBoss`)
- **Interfaces:** PascalCase (`User`, `Database`)
- **Queue names:** string literals (`"userQueue"`, `"welcome-email"`)

## Scale
- **1 source file**, 122 lines
- **3 runtime dependencies**, 2 dev dependencies
- This is a **minimal proof-of-concept** — not intended for production deployment as-is

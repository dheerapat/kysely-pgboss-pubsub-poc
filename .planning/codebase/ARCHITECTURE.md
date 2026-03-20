# Architecture

## Pattern
**Proof-of-Concept / Script** — single-file demonstration of a specific integration pattern. No layered architecture; all logic is in one file (`index.ts`).

## Purpose
Demonstrates how to integrate **pg-boss** (durable job queue) with **Kysely** (type-safe query builder) so that:
1. pg-boss uses Kysely (and the same `pg.Pool`) instead of managing its own connection
2. Jobs can be published *inside* a Kysely transaction, ensuring atomicity between data mutations and job scheduling (publish-subscribe pattern)

## Key Abstraction: `KyselyBossAdapter`

Located in `index.ts:32-44`.

This is the central architectural piece. pg-boss requires a `db` object with an `executeSql(text, values)` method. `KyselyBossAdapter` implements that interface using Kysely's `executeQuery(CompiledQuery.raw(...))`:

```ts
class KyselyBossAdapter {
  constructor(private readonly runner: Kysely<Database> | Transaction<Database>) {}

  async executeSql(text: string, values: any[] = []): Promise<{ rows: any[] }> {
    const result = await this.runner.executeQuery(CompiledQuery.raw(text, values));
    return { rows: result.rows };
  }
}
```

Two instances are created:
- `new KyselyBossAdapter(kysely)` — uses the global Kysely instance (for schema init)
- `new KyselyBossAdapter(tx)` — wraps a live Kysely transaction (for atomic publish)

## Data Flow

```
main()
  └── setupSchema()          — Kysely DDL: CREATE TABLE users
  └── registerUser()
        └── schemaBoss       — Temporary PgBoss (schema-only): start → stop
        └── boss             — Real PgBoss instance
              └── boss.start()
              └── boss.createQueue("userQueue")
              └── kysely.transaction()
                    ├── INSERT INTO users (Kysely)
                    └── boss.publish("welcome-email", data, { db: KyselyBossAdapter(tx) })
              └── boss.subscribe("welcome-email", "userQueue")
              └── boss.work("userQueue", handler)
                    └── job handler: logs job data
```

## Entry Points
- `main()` at `index.ts:114` — sole entry point, called immediately at bottom of file
- No HTTP server, no exported API surface (except `KyselyBossAdapter` class, which is `export`ed)

## Layers (flat)
| Concern | Location |
|---------|----------|
| DB types/schema | `index.ts:12-20` (interfaces `User`, `Database`) |
| Connection setup | `index.ts:22-30` (Pool, dialect, Kysely instance) |
| pg-boss adapter | `index.ts:32-44` (`KyselyBossAdapter` class) |
| Schema setup | `index.ts:46-57` (`setupSchema()`) |
| Business logic | `index.ts:59-112` (`registerUser()`) |
| Entrypoint | `index.ts:114-122` (`main()`) |

## Concurrency Model
- Single-threaded async/await
- pg-boss worker (`boss.work`) runs continuously after `main()` returns — process stays alive
- No worker threads, no clustering

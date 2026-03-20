# Integrations

## Database — PostgreSQL

- **Driver:** `pg` (node-postgres) `^8.16.3`
- **Connection:** `pg.Pool` with connection string
  ```
  postgres://admin:pass@localhost:15432/postgres
  ```
- **Local Dev:** Docker Compose service `postgres-db` (image: `postgres:latest`)
  - Port mapping: `15432:5432` (non-standard host port)
  - Credentials: `admin`/`pass`, database: `postgres`
  - Named volume: `postgres-data` for persistence

## Query Builder — Kysely

- **Package:** `kysely` ^0.28.9
- **Dialect:** `PostgresDialect` wrapping the `pg.Pool`
- **Type-safe DB schema:** `Database` interface with `users` table typed via Kysely generics
- **Usage:** DDL (schema creation), DML (insert, transaction), raw query execution via `CompiledQuery.raw()`

## Job Queue — pg-boss

- **Package:** `pg-boss` ^12.5.4
- **Integration pattern:** Custom `KyselyBossAdapter` that bridges pg-boss's SQL execution interface with Kysely:
  ```ts
  class KyselyBossAdapter {
    constructor(private readonly runner: Kysely<Database> | Transaction<Database>) {}
    async executeSql(text: string, values: any[] = []): Promise<{ rows: any[] }> {
      const result = await this.runner.executeQuery(CompiledQuery.raw(text, values));
      return { rows: result.rows };
    }
  }
  ```
- **Schema management:** pg-boss installs its own schema in the PostgreSQL database
- **Queue:** Named queue `"userQueue"` subscribed to topic `"welcome-email"`
- **Job publish pattern:** Jobs are published inside a Kysely transaction via the transactional adapter (`{ db: txAdapter }`), ensuring atomicity between user insert and job scheduling

## No External APIs or Auth Providers
- No HTTP clients, no REST/GraphQL APIs called
- No authentication/authorization integrations
- No message brokers (Kafka, RabbitMQ, etc.) — pg-boss provides queueing on top of PostgreSQL
- No observability integrations (no logging frameworks, no metrics/tracing)
- No cloud provider SDKs

## Environment Configuration
- Connection string is **hardcoded** in `index.ts` — no environment variable usage
- No `.env` loading (but `.gitignore` includes `.env*` patterns)

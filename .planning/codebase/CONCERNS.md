# Concerns

## Hardcoded Credentials (Security — High)

**File:** `index.ts:23`

```ts
const pool = new Pool({
  connectionString: "postgres://admin:pass@localhost:15432/postgres",
});
```

The database connection string with username and password is hardcoded in source. This is acceptable for a local PoC but would be a critical security issue in any shared or production environment. Should be replaced with environment variables (`process.env.DATABASE_URL`).

## No Environment Configuration (Flexibility — Medium)

No `.env` loading, no `process.env` usage anywhere. Configuration (DB host, port, credentials) is entirely hardcoded. Extending this to multiple environments (staging, production) would require code changes.

## Type Safety Gap: `any` in Adapter (Type Safety — Low-Medium)

**File:** `index.ts:37`

```ts
async executeSql(text: string, values: any[] = []): Promise<{ rows: any[] }>
```

The `any[]` types in `executeSql` bypass TypeScript's type safety. This matches pg-boss's expected interface but means the adapter's internals are untyped. Since this is an adapter boundary (pg-boss dictates the shape), this is acceptable but worth noting.

## Schema Type Mismatch (Correctness — Medium)

**File:** `index.ts:13,50`

The `User` interface declares `id` as `Generated<number>`:
```ts
id: Generated<number>;
```

But the actual SQL column is `uuid`:
```sql
.addColumn("id", "uuid", (cb) => cb.primaryKey().defaultTo(crypto.randomUUID()))
```

Kysely will not catch this at runtime (it trusts the type definition), but a query that returns `id` would receive a UUID string while TypeScript expects a `number`. This is a latent bug.

## No Tests (Quality — Medium)

Zero test coverage. There is no way to verify behavior automatically. Regressions would only be caught by manual runs. See `TESTING.md`.

## Bare `throw new Error()` in Job Worker (Quality — Low)

**File:** `index.ts:109`

```ts
if (!job) {
  throw new Error();
}
```

The empty `Error` (no message) makes debugging difficult. Should include a descriptive message.

## Two-Boss Initialization Pattern (Complexity — Low)

**File:** `index.ts:60-72`

A "dummy" `schemaBoss` instance is started and stopped purely to trigger pg-boss schema installation, then a second "real" `boss` instance is created. This pattern is unusual and adds conceptual overhead. It could be simplified with `PgBoss.install()` or by using a single instance.

## No Graceful Shutdown (Reliability — Low)

No `SIGTERM`/`SIGINT` handlers. The process will be killed abruptly without calling `boss.stop()`, which may leave pg-boss in a dirty state (e.g., active workers not cleanly unregistered).

## Docker Image Not Pinned (Reproducibility — Low)

**File:** `docker-compose.yaml:3`

```yaml
image: postgres:latest
```

Using `latest` can cause unexpected breaks when a new major PostgreSQL version is released. Should pin to a specific version (e.g., `postgres:16`).

## No Observability (Operational — Low)

- No structured logging (only `console.log`)
- No metrics, tracing, or health checks
- Acceptable for a PoC, problematic for any production use

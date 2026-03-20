# Kysely + pg-boss: Transactional Event Publishing POC

Demonstrates how to use **pg-boss** (durable job queue) with **Kysely** (type-safe query builder) to publish domain events **atomically** inside a database transaction — solving the dual-write problem without an outbox pattern.

## The Core Thesis

**The dual-write problem:** In event-driven systems, you need to both persist a domain change (INSERT) and publish an event (queue a job). If these are separate operations, a crash between them leaves the system inconsistent: the data was saved but the event was never sent, or vice versa.

**The solution here:** pg-boss can accept a custom `db` adapter for SQL execution. By passing a `KyselyAdapter(tx)` wrapping an active Kysely transaction, the pg-boss job INSERT is routed through the same transaction as the domain INSERT. Both commit or both roll back together — atomically.

```
kysely.transaction().execute(async (tx) => {
  await repo.save(user, tx);                          // INSERT INTO users
  await eventBus.publish("user.registered", payload, {
    db: new KyselyAdapter(tx),                        // pg-boss job INSERT via same tx
  });
});
// If anything throws → both INSERTs roll back. No orphaned jobs.
```

This means: **if the transaction rolls back (e.g. duplicate email), the pg-boss job is never committed to the job table.** No duplicate events, no inconsistency.

## Rollback Demo

The `users.email` column has a `UNIQUE` constraint. Attempting to register a duplicate email causes Postgres to throw a unique violation (code `23505`). The Kysely transaction rolls back, taking the pending pg-boss job with it.

**Proof:** After a failed duplicate-email attempt, `SELECT COUNT(*) FROM pgboss.job WHERE name = 'user.registered'` returns the same count as before — no new job was enqueued.

## Folder Structure

```
src/
  index.ts                          # Composition root — wires all layers, starts HTTP server
  domains/
    shared/
      events.ts                     # DomainEventMap — typed event name → payload contracts
      IEventBus.ts                  # IEventBus interface — domain depends only on this
    user/
      User.ts                       # User entity (factory, immutable)
      UserId.ts                     # UserId branded value object
      Email.ts                      # Email branded value object (format validation)
      IUserRepository.ts            # IUserRepository interface (no Kysely types)
      UserService.ts                # register() — opens tx, INSERT + publish atomically
    notification/
      NotificationService.ts        # handleUserRegistered() — logs simulated welcome email
      NotificationService.test.ts   # Unit test (bun:test + spyOn)
  infrastructure/
    db/
      pool.ts                       # pg.Pool singleton
      kysely.ts                     # Kysely<Database> singleton
      KyselyAdapter.ts              # Bridges pg-boss ↔ Kysely transactions
      schema.ts                     # DDL: CREATE TABLE users IF NOT EXISTS
      types.ts                      # Database interface for Kysely generics
    events/
      boss.ts                       # PgBoss singleton factory + queue creation
      PgBossEventBus.ts             # IEventBus impl using pg-boss send() / work()
    user/
      UserRepository.ts             # IUserRepository impl: INSERT via tx, SELECT all
```

## Prerequisites

- Docker
- Bun v1.3.5+

## Setup

```bash
docker compose up -d   # Start Postgres on port 15432
bun install
```

## Run the server

```bash
bun run src/index.ts
```

Startup logs confirm infrastructure is ready:
```
[infra] Users table ready.
[infra] pg-boss started.
[infra] Queue created: user.registered
[app] user.registered worker registered.
[app] Elysia server running on port 3000
[app] Infrastructure ready. Awaiting requests.
```

## Demo: Happy Path (Atomic Commit)

**Register a new user:**
```bash
curl -s -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice"}' | jq .
# → {"userId":"<uuid>"}   HTTP 201
```

**Confirm the user was persisted:**
```bash
curl -s http://localhost:3000/users | jq .
# → [{"id":"<uuid>","email":"alice@example.com","name":"Alice"}]
```

Server logs show the full atomic sequence:
```
[UserService] tx opened
[UserService] user INSERT done
[UserService] user.registered job queued (same tx)
[UserService] tx committed
[NotificationService] Sending welcome email to alice@example.com (userId: <uuid>)
```

## Demo: Rollback (Atomicity Proof)

**Attempt to register the same email again:**
```bash
curl -s -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice Again"}' | jq .
# → {"error":"Email already registered"}   HTTP 409
```

No new user row was inserted. No new pg-boss job was created. The transaction rolled back both the `INSERT INTO users` and the pending pg-boss job insert in one atomic operation.

**Verify no orphaned job was created** (requires psql access):
```bash
docker exec -it postgres-db psql -U admin -d postgres \
  -c "SELECT COUNT(*) FROM pgboss.job WHERE name = 'user.registered';"
# Count is the same as after the happy path — no new job
```

## Run Tests

```bash
bun test
```

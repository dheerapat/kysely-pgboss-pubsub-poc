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

## Pub/Sub Fan-Out (v1.1)

v1.1 migrates from point-to-point queue sends to **native pg-boss pub/sub**, enabling true fan-out: a single event publish reaches multiple independent consumers without any publisher code changes.

### Pub/Sub vs Queue-Based Approach

**v1.0 (queue-based):** `boss.send(queueName, payload)` — a direct point-to-point send. The publisher must know every consumer queue name. Adding a new consumer requires changing publisher code.

**v1.1 (pub/sub):** `boss.publish(eventName, payload)` — a channel broadcast. The publisher only names the event (`"user.registered"`). pg-boss resolves fan-out targets at publish time by querying the `pgboss.subscription` table. Adding a new subscriber requires **zero changes to the publisher**.

### pgboss.subscription Table Role

`pgboss.subscription` is pg-boss's internal routing registry. Each row maps an event channel name to a subscriber queue name:

| Channel (event) | Queue (subscriber) |
|---|---|
| `user.registered` | `notification.user.registered` |
| `user.registered` | `audit.user.registered` |

When `boss.publish("user.registered", payload)` is called, pg-boss queries this table to discover all target queues and INSERTs one job per queue. The table is populated during boot by calling `boss.subscribe(eventName, queueName)` for each subscriber — this is what `PgBossEventBus.subscribe()` does internally.

### Fan-Out Mechanism

The fan-out sequence when `UserService.register()` runs inside a Kysely transaction:

1. `boss.publish("user.registered", payload, { db: tx })` is called with the active Kysely transaction adapter
2. pg-boss SELECT-queries `pgboss.subscription` to find all registered queues for `"user.registered"` — currently `notification.user.registered` and `audit.user.registered`
3. pg-boss INSERTs one job into each queue using the provided `db` transaction adapter
4. Both INSERTs commit or roll back **atomically** with the domain INSERT

```
boss.publish("user.registered", payload, { db: tx })
  └─ pgboss.subscription lookup
       ├─ → INSERT job into notification.user.registered (via tx)
       └─ → INSERT job into audit.user.registered (via tx)
  // If tx rolls back → BOTH job INSERTs roll back → zero orphaned jobs
```

### Boot Sequence Ordering Rationale

The boot order `createQueue → boss.subscribe → boss.work → app.listen()` is strictly enforced:

- `pgboss.subscription` has a **foreign key on queue names** — the queue must exist before `boss.subscribe()` can register it
- `boss.publish()` **silently produces zero jobs** if no subscriptions are registered at publish time
- Therefore ALL subscriptions must complete before `app.listen()` to guarantee that the first HTTP request does not race against subscription setup

## Rollback Demo

The `users.email` column has a `UNIQUE` constraint. Attempting to register a duplicate email causes Postgres to throw a unique violation (code `23505`). The Kysely transaction rolls back, taking **all** pending pg-boss job INSERTs with it — across both fan-out queues.

**Proof:** After a failed duplicate-email attempt, both queues show the same count as before — no new jobs were enqueued in either queue.

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
    audit/
      AuditService.ts               # handleUserRegistered() — logs audit trail entry
  infrastructure/
    db/
      pool.ts                       # pg.Pool singleton
      kysely.ts                     # Kysely<Database> singleton
      KyselyAdapter.ts              # Bridges pg-boss ↔ Kysely transactions
      schema.ts                     # DDL: CREATE TABLE users IF NOT EXISTS
      types.ts                      # Database interface for Kysely generics
    events/
      boss.ts                       # PgBoss singleton factory
      PgBossEventBus.ts             # IEventBus impl: publish() fans out via pgboss.subscription
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

Startup logs confirm infrastructure is ready (both subscribers registered before server accepts requests):
```
[infra] Users table ready.
[infra] pg-boss started.
[infra] Queue created: notification.user.registered
[infra] Subscription registered: user.registered → notification.user.registered
[infra] Worker registered: notification.user.registered
[app] NotificationService subscribed to user.registered.
[infra] Queue created: audit.user.registered
[infra] Subscription registered: user.registered → audit.user.registered
[infra] Worker registered: audit.user.registered
[app] AuditService subscribed to user.registered.
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

Server logs show the full atomic sequence, with both subscribers firing:
```
[UserService] tx opened
[UserService] user INSERT done
[UserService] user.registered job queued (same tx)
[UserService] tx committed
[NotificationService] Sending welcome email to alice@example.com (userId: <uuid>)
[AuditService] User registered — userId: <uuid>, email: alice@example.com, at: <iso-timestamp>
```

## Demo: Rollback (Atomicity Proof)

**Attempt to register the same email again:**
```bash
curl -s -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice Again"}' | jq .
# → {"error":"Email already registered"}   HTTP 409
```

No new user row was inserted. No new pg-boss jobs were created in **either** fan-out queue. The transaction rolled back the `INSERT INTO users` and all pending pg-boss job INSERTs atomically.

**Verify no orphaned jobs in either queue** (requires psql access):
```bash
docker exec -it postgres-db psql -U admin -d postgres \
  -c "SELECT name, COUNT(*) FROM pgboss.job WHERE name IN ('notification.user.registered', 'audit.user.registered') GROUP BY name;"
# Both counts are unchanged — no jobs created in either queue
```

## Run Tests

```bash
bun test
```

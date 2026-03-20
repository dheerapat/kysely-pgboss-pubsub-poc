# Research Summary: DDD + pg-boss Event-Driven TypeScript POC

## Stack

**HTTP:** Hono ^4.6.x — more mature than Elysia, first-class Bun support, portable.

**Event Bus:** Custom thin wrapper. No external library. TypeScript discriminated union map provides type safety. pg-boss is the backing store.

**Core:** Bun + Kysely ^0.28.x + pg-boss ^12.x + pg ^8.x — all already in project. No new infra dependencies.

## Architecture

Three layers: HTTP (Hono router) → Domain (User, Notification services) → Infrastructure (pg.Pool, Kysely, KyselyAdapter, PgBoss singleton, EventBus implementation).

**Key boundary:** Domain defines `IEventBus` interface. Infrastructure implements it. Domain never imports pg-boss.

**Transaction boundary:** `UserService` opens the transaction, passes `KyselyAdapter(tx)` to both the repository and the event bus. Both INSERT and job creation happen in the same transaction.

**Folder structure:** `src/domains/{user,notification,shared}` + `src/infrastructure/{db,events,http}` + `src/index.ts`.

## Table Stakes Features

1. Typed `DomainEventMap` — TypeScript enforces payload shape per event name
2. `PgBossEventBus.publish(event, payload, { db: KyselyAdapter(tx) })` — transactional publish
3. `UserService.register()` — INSERT + publish in one atomic transaction
4. `NotificationService` — async pg-boss worker handling `user.registered`
5. HTTP surface — `POST /users`, `GET /users` via Hono
6. Rollback demo — duplicate email shows no job created

## Critical Pitfalls to Avoid

1. **Publish outside transaction** — classic dual-write; publish must happen inside `tx.execute()` with `{ db: KyselyAdapter(tx) }`
2. **Multiple PgBoss instances** — one singleton, started once at boot
3. **Domain importing infrastructure** — `UserService` receives `IEventBus`, never imports `PgBossEventBus`
4. **Transaction not threaded through** — repository `save(user, tx)` must use `tx`, not base Kysely
5. **Queue not created before publish** — `boss.createQueue(name)` at startup for all known queues
6. **KyselyAdapter wrapping wrong runner** — must wrap `tx` (Transaction), not `kysely` (base instance)
7. **Not demonstrating rollback** — the happy path alone doesn't prove atomicity

## Recommended Build Order

```
Phase 1: Infrastructure — pool, Kysely, KyselyAdapter, PgBoss singleton, EventBus, schema
Phase 2: User domain — entities, value objects, repository, UserService, HTTP route
Phase 3: Notification domain — handler, wire subscription
Phase 4: Demo polish — rollback demo, README with annotated curl flow
```

---
*Research complete: 2026-03-20*

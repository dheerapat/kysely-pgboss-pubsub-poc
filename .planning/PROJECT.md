# Kysely + pg-boss DDD Event-Driven POC

## What This Is

A structured proof-of-concept demonstrating lightweight domain-driven development and cross-domain communication using pg-boss as a transactional event bus backed by PostgreSQL. Two domains (User and Notification) communicate asynchronously via typed domain events, with a third observer (AuditService) proving native fan-out. The codebase is organized using Elysia's `decorate` plugin pattern — a clean composition root composes three focused plugins (servicesPlugin, workersPlugin, userRoutesPlugin) with full TypeScript type inference. The core thesis — that pg-boss + KyselyAdapter enables atomic save-and-publish inside a single database transaction — is proven and demonstrated end-to-end with a working HTTP API, rollback demo, and annotated README.

## Core Value

Domain writes and domain event publishing are atomic: if the transaction rolls back, the event is never queued — no ghost notifications, no missed events, no outbox pattern required.

## Requirements

### Validated

- ✓ Single shared `pg.Pool` and `Kysely<Database>` instance initialized at boot and reused across domains — v1.0
- ✓ `KyselyAdapter` bridges pg-boss and Kysely: pg-boss executes SQL through an active Kysely transaction — v1.0
- ✓ Single `PgBoss` instance initialized at boot, schema installed once, all queues created before publish/subscribe — v1.0
- ✓ `DomainEventMap` type in shared domain layer: typed contract between publishers and subscribers — v1.0
- ✓ `IEventBus` interface in shared domain layer: domain code depends only on this, never on pg-boss directly — v1.0
- ✓ `IDbClient` structural interface in domain layer: eliminates KyselyAdapter import from IEventBus, clean domain/infra boundary — v1.0
- ✓ `UserId` and `Email` branded value objects with format validation — v1.0
- ✓ `User` entity: private constructor, static factory, immutable after creation — v1.0
- ✓ `IUserRepository` interface with no Kysely or pg types in its signature — v1.0
- ✓ `UserRepository` (Kysely impl) persists users to `users` table via provided transaction — v1.0
- ✓ `UserService.register()` opens Kysely tx, saves user, publishes `user.registered` atomically — v1.0
- ✓ `NotificationService.handleUserRegistered()` receives `user.registered` payload, logs simulated welcome email — v1.0
- ✓ `user.registered` pg-boss worker registered at boot via `IEventBus.subscribe()` — v1.0
- ✓ Elysia HTTP server starts at boot and listens for requests — v1.0
- ✓ `POST /users` accepts `{ email, name }`, calls `UserService.register()`, returns `{ userId }` with HTTP 201 — v1.0
- ✓ `GET /users` returns list of all persisted users — v1.0
- ✓ `POST /users` with duplicate email returns HTTP 409 (transaction rolled back, no job created) — v1.0
- ✓ Console logs show the full sequence: tx opened → INSERT → job created (same tx) → tx committed → worker fired → handler executed — v1.0
- ✓ README documents pattern thesis, folder structure, and annotated curl commands for happy path and rollback demo — v1.0
- ✓ `IEventBus.subscribe()` requires a `subscriberName: string` parameter — TypeScript enforces subscriber identity at every call site — v1.1
- ✓ Queue naming convention (`{subscriberName}.{eventName}`) encapsulated in `PgBossEventBus` — domain code never constructs queue names — v1.1
- ✓ `boss.ts` stripped to a bare PgBoss factory; `KNOWN_QUEUES` removed — queue lifecycle moves to `PgBossEventBus.subscribe()` — v1.1
- ✓ `boss.on('error', ...)` error handler preserved after `boss.ts` refactor — v1.1
- ✓ Boot sequence enforces `start → createQueue → subscribe → work → listen` — FK-safe ordering, HTTP only after all subscriptions ready — v1.1
- ✓ `PgBossEventBus.publish()` migrated to `boss.publish()` — native fan-out to all subscribed queues via `pgboss.subscription` table — v1.1
- ✓ `PgBossEventBus.subscribe()` uses 3-step `createQueue → boss.subscribe → boss.work` setup — v1.1
- ✓ `AuditService` added as second independent subscriber for `user.registered` — pure domain class, no pg-boss imports — v1.1
- ✓ Fan-out proven end-to-end: single `boss.publish()` fires both `NotificationService` and `AuditService` handlers — v1.1
- ✓ Rollback regression confirmed with two subscriber queues: duplicate email → HTTP 409, zero jobs in both queues — v1.1
- ✓ README documents pub/sub vs queue-based approach, `pgboss.subscription` table role, fan-out mechanism, boot sequence rationale — v1.1
- ✓ `PgBossEventBus` inline comment documents `{ db }` partial-transaction semantics (subscription lookup uses pool; job INSERTs use transaction) — v1.1
- ✓ `servicesPlugin` decorates all wired deps onto Elysia context using `.decorate()` — v1.2
- ✓ `workersPlugin` registers all `IEventBus.subscribe()` calls, extracted from `index.ts` — v1.2
- ✓ `userRoutesPlugin` encapsulates `/users` GET and POST handlers with context-injected services — v1.2
- ✓ `index.ts` is a pure composition root — no `new Service()`, no inline `await eventBus.subscribe()` — v1.2
- ✓ Boot order enforced: workers plugin awaited before `.listen()` — v1.2
- ✓ Graceful shutdown accesses `boss`/`pool` via `services.decorator` — no direct infra imports in `index.ts` — v1.2

## Current Milestone: v1.3 Docker + Load Balancing

**Goal:** Containerize the app and run it as 6 parallel instances behind a Caddy load balancer alongside PostgreSQL, proving horizontal scalability of the pg-boss event-driven architecture.

**Target features:**
- Multi-stage Dockerfile (Bun builder + slim runtime)
- Docker Compose: 6 replicated app instances + PostgreSQL + Caddy
- Caddy round-robin load balancer on port 8080 with health checks
- `GET /health` endpoint for Caddy health monitoring
- pg-boss workers run on all 6 instances (DB locking ensures safe concurrent job processing)

### Validated in Phase 10: app-containerization-foundation

- ✓ `DATABASE_URL` env var with `localhost:15432` fallback for local dev (CONT-01) — v1.3
- ✓ `GET /health` returns HTTP 200 with `{"status":"ok"}` for Caddy liveness checks (CONT-02) — v1.3
- ✓ `SIGTERM` triggers graceful drain: HTTP stop → boss.stop() → pool.end() → exit (CONT-03) — v1.3
- ✓ Multi-stage Dockerfile using `oven/bun:1.3.11` — production deps only in runtime image (DOCK-01, DOCK-03) — v1.3
- ✓ `.dockerignore` excludes `node_modules`, `.git`, `.env`; `bun.lock` accessible for `--frozen-lockfile` (DOCK-02) — v1.3

### Validated in Phase 11: docker-compose-setup

- ✓ Docker Compose with `deploy.replicas: 6` for the app service (COMP-02) — v1.3
- ✓ PostgreSQL service in Compose with persistent volume and `pg_isready` healthcheck (COMP-01) — v1.3
- ✓ App service has no `ports:` mapping — only Caddy exposes a host port (COMP-04) — v1.3
- ✓ pg-boss multi-master safe: 6 concurrent `boss.start()` calls explicitly supported via advisory lock (COMP-03) — v1.3

### Validated in Phase 12: caddy-load-balancing-verification

- ✓ Caddyfile with `reverse_proxy app:3000 lb_policy round_robin` (CADDY-01) — v1.3
- ✓ Caddyfile health check: `health_uri /health`, `health_interval 10s`, `health_fails 3` (CADDY-02) — v1.3
- ✓ Caddy service in Docker Compose exposes port `8080:8080` (CADDY-03) — v1.3
- ✓ Round-robin routing confirmed live: all 6 replicas each handled 1 of 6 successive POST /users requests — v1.3
- ✓ Exactly-once job processing confirmed: singleton POST → exactly 1 NotificationService + 1 AuditService execution (0 duplicates) — v1.3

### Active

*(None — v1.3 milestone complete)*

### Out of Scope

- Authentication/authorization — not relevant to the event-driven pattern
- Real email sending — notification handler logs; sending hides the pattern
- Multiple event types beyond `user.registered` — one clear example is better than many shallow ones
- Separate message broker (Kafka, RabbitMQ, Redis Streams) — explicitly excluded; pg-boss replaces them for this use case
- Outbox pattern — the transactional adapter makes it unnecessary
- Full CQRS — over-engineering; query/command split adds noise
- Event sourcing / event replay — pg-boss is a job queue, not an event store
- Sagas / process managers — too complex for a two-domain POC
- pg-boss version upgrade — 12.5.4 has all required pub/sub APIs
- Dead letter queue demo — separate concern; failure visibility is v2+
- `@pg-boss/dashboard` — useful for teaching but not essential to prove fan-out

## Context

**Status:** v1.0, v1.1, v1.2, and v1.3 all shipped. Codebase is feature-complete for the POC thesis. All four milestones archived. The horizontal scaling thesis is proven: 6 app replicas behind Caddy with pg-boss exactly-once job processing.

**Stack:** Bun runtime, TypeScript (strict), Kysely ^0.28.9, pg ^8.16.3, pg-boss ^12.5.4, Elysia HTTP, Docker Compose for Postgres.

**Codebase:** ~592 LOC TypeScript (src/), clean folder-per-domain structure with `src/plugins/` for Elysia plugin layer. Tests via bun:test.

**Architecture proven:** With a separate message broker (Kafka, RabbitMQ), you face the dual-write problem. pg-boss + KyselyAdapter eliminates this by storing jobs in the same PostgreSQL database — publish inside the same transaction as the domain write. If the tx rolls back, the job is never created. Native pub/sub (`boss.publish`) fans out to all subscribed queues automatically via the `pgboss.subscription` table — no manual routing needed. `index.ts` is now a clean composition root using Elysia's `decorate` pattern.

**v2 ideas (not planned):**
- V2-01: Second event type (e.g. `user.deactivated`) to show multi-event support
- V2-02: Third subscriber (metrics/counter) for more dramatic fan-out proof
- V2-03: Dead letter queue / retry configuration visible in demo
- V2-04: `Order` domain for a more complex cross-domain flow

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| pg-boss over external broker | Same DB = atomic tx; no broker infra to manage | ✓ Good — core thesis demonstrated cleanly |
| Typed `DomainEventMap` event contract | Domain code must not depend on pg-boss directly | ✓ Good — TypeScript catches mismatched event names at compile time |
| `IDbClient` structural interface in domain layer | `IEventBus` originally imported `KyselyAdapter` — infra leak | ✓ Good — structural typing means zero call-site changes, clean boundary |
| `boss.send()` in v1.0, `boss.publish()` in v1.1 | Queue-based send simpler for v1.0; migrated cleanly to native pub/sub in v1.1 | ✓ Good — staged migration, zero call-site changes outside PgBossEventBus |
| Branded types (unique symbol) for value objects | Zero runtime overhead vs class wrappers; TypeScript nominal typing at compile time | ✓ Good — clean and idiomatic |
| `Transaction<Database>` in `IUserRepository.save()` | Minimum infra touch needed for atomicity; no other Kysely types leak into domain | ✓ Good — pragmatic; alternative `tx: unknown` loses type safety |
| Folder-per-domain (not package-per-domain) | POC clarity; less tooling overhead | ✓ Good — boundaries clear without monorepo complexity |
| Elysia for HTTP | Bun-native, lightweight, minimal boilerplate | ✓ Good — worker subscription before `.listen()` avoids race conditions |
| Catch `err.code === "23505"` at HTTP layer | Sufficient for POC; no custom error class needed | ✓ Good — direct and readable |
| `subscriberName` required (not optional) in `IEventBus.subscribe()` | Optional would allow silent fan-out breakage where two subscribers derive the same queue name | ✓ Good — TypeScript enforcement at every call site |
| Queue lifecycle in `PgBossEventBus.subscribe()` not `boss.ts` | Callers never construct queue names; naming convention lives in one place | ✓ Good — AuditService wired in 3 lines with zero queue knowledge |
| `boss.publish()` for fan-out | Routes to all subscribers via `pgboss.subscription` table automatically | ✓ Good — zero routing code in domain layer; fan-out is a pg-boss concern |
| Boot order: `createQueue → boss.subscribe → boss.work` before `app.listen()` | FK constraint on `pgboss.subscription` requires this ordering; HTTP before subscriptions → silent event loss | ✓ Good — enforced in index.ts; no race conditions |
| Async factory pattern for `servicesPlugin` | `.onStart()` alternative loses TypeScript type inference on decorated properties | ✓ Good — TypeScript infers all context property types from concrete plugin instance |
| `createWorkersPlugin` accepts service instances (not `.use(servicesPlugin)`) | `subscribe()` calls are async — caller must await before `.listen()`, explicit boot ordering | ✓ Good — composition root controls ordering; no hidden sequencing |
| `services.decorator.boss/pool` for shutdown in `index.ts` | Avoids re-importing infra into composition root — pure plugin composition | ✓ Good — no direct infra imports in index.ts post-refactor |

## Constraints

- **Tech Stack:** Bun + Kysely + pg-boss — no new database infrastructure, reuses existing pg.Pool
- **Framework:** Elysia for HTTP (lightweight, Bun-native friendly)
- **Scope:** POC clarity over production robustness — patterns must be clear and readable
- **TypeScript:** Strict mode, full type safety on the event bus (event name → payload type mapping)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-22 after Phase 12 (caddy-load-balancing-verification) complete — v1.3 milestone shipped*

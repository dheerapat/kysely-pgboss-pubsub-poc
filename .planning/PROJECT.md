# Kysely + pg-boss DDD Event-Driven POC

## What This Is

A structured proof-of-concept demonstrating lightweight domain-driven development and cross-domain communication using pg-boss as a transactional event bus backed by PostgreSQL. Two domains (User and Notification) communicate asynchronously via typed domain events. The core thesis — that pg-boss + KyselyAdapter enables atomic save-and-publish inside a single database transaction — is proven and demonstrated end-to-end with a working HTTP API, rollback demo, and annotated README.

## Core Value

Domain writes and domain event publishing are atomic: if the transaction rolls back, the event is never queued — no ghost notifications, no missed events, no outbox pattern required.

## Requirements

### Validated

- ✓ Single shared `pg.Pool` and `Kysely<Database>` instance initialized at boot and reused across domains — v1.0
- ✓ `KyselyAdapter` bridges pg-boss and Kysely: pg-boss executes SQL through an active Kysely transaction — v1.0
- ✓ Single `PgBoss` instance initialized at boot, schema installed once, all queues created before publish/subscribe — v1.0
- ✓ `DomainEventMap` type in shared domain layer: typed contract between publishers and subscribers — v1.0
- ✓ `IEventBus` interface in shared domain layer: domain code depends only on this, never on pg-boss directly — v1.0
- ✓ `PgBossEventBus` implements `IEventBus` via `boss.send()` with optional `{ db: IDbClient }` for transactional routing — v1.0
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

## Current Milestone: v1.1 pg-boss Native Pub/Sub + Fan-Out

**Goal:** Replace queue-based `boss.send()`/`boss.work()` with pg-boss native pub/sub (`boss.publish()`/`boss.subscribe()`) and demonstrate fan-out by routing one `user.registered` event to multiple independent subscribers.

**Target features:**
- Migrate `PgBossEventBus.publish()` from `boss.send()` to `boss.publish()`
- Migrate `PgBossEventBus.subscribe()` from `boss.work()` (direct queue) to `boss.subscribe()` + `boss.work()` (channel → queue fan-out)
- Add second subscriber for `user.registered` (e.g. AuditService) to prove fan-out
- Preserve `{ db?: IDbClient }` transactional option (boss.publish supports it)
- Update README to document pub/sub pattern and fan-out

### Active

- [ ] Migrate `PgBossEventBus` to use `boss.publish()` for event publishing
- [ ] Migrate `PgBossEventBus` to use `boss.subscribe()` + `boss.work()` for subscriptions
- [ ] Add `AuditService` (second subscriber) to demonstrate fan-out on `user.registered`
- [ ] Update boot sequence to register pub/sub channel subscriptions before server start
- [ ] Update README to document pub/sub vs queue-based approach and fan-out pattern

### Out of Scope

- Authentication/authorization — not relevant to the event-driven pattern
- Real email sending — notification handler logs; sending hides the pattern
- Multiple event types beyond `user.registered` in v1 — one clear example is better than many shallow ones
- Separate message broker (Kafka, RabbitMQ, Redis Streams) — explicitly excluded; pg-boss replaces them for this use case
- Outbox pattern — the transactional adapter makes it unnecessary
- Full CQRS — over-engineering; query/command split adds noise
- Event sourcing / event replay — pg-boss is a job queue, not an event store
- Sagas / process managers — too complex for a two-domain POC

## Context

**Status:** v1.0 shipped 2026-03-21. All 4 phases complete, 9 plans executed, 14 tasks delivered.

**Stack:** Bun runtime, TypeScript (strict), Kysely ^0.28.9, pg ^8.16.3, pg-boss ^12.5.4, Elysia HTTP, Docker Compose for Postgres.

**Codebase:** ~475 LOC TypeScript (src/), clean folder-per-domain structure. Tests via bun:test.

**Architecture proven:** With a separate message broker (Kafka, RabbitMQ), you face the dual-write problem. pg-boss + KyselyAdapter eliminates this by storing jobs in the same PostgreSQL database — publish inside the same transaction as the domain write. If the tx rolls back, the job is never created.

**v2 ideas (not planned):**
- V2-01: Second event type (e.g. `user.deactivated`) to show multi-event support
- V2-02: Multiple handlers for one event (fan-out) — welcome email + analytics log from `user.registered`
- V2-03: Dead letter queue / retry configuration visible in demo
- V2-04: `Order` domain for a more complex cross-domain flow

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| pg-boss over external broker | Same DB = atomic tx; no broker infra to manage | ✓ Good — core thesis demonstrated cleanly |
| Typed `DomainEventMap` event contract | Domain code must not depend on pg-boss directly | ✓ Good — TypeScript catches mismatched event names at compile time |
| `IDbClient` structural interface in domain layer | `IEventBus` originally imported `KyselyAdapter` — infra leak | ✓ Good — structural typing means zero call-site changes, clean boundary |
| `boss.send()` over `boss.publish()` | Both accept `{ db }`, but queue-based send is simpler with pre-created KNOWN_QUEUES | ✓ Good — works identically for the POC |
| Branded types (unique symbol) for value objects | Zero runtime overhead vs class wrappers; TypeScript nominal typing at compile time | ✓ Good — clean and idiomatic |
| `Transaction<Database>` in `IUserRepository.save()` | Minimum infra touch needed for atomicity; no other Kysely types leak into domain | ✓ Good — pragmatic; alternative `tx: unknown` loses type safety |
| Folder-per-domain (not package-per-domain) | POC clarity; less tooling overhead | ✓ Good — boundaries clear without monorepo complexity |
| Elysia for HTTP | Bun-native, lightweight, minimal boilerplate | ✓ Good — worker subscription before `.listen()` avoids race conditions |
| Catch `err.code === "23505"` at HTTP layer | Sufficient for POC; no custom error class needed | ✓ Good — direct and readable |

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
*Last updated: 2026-03-21 after v1.1 milestone start*

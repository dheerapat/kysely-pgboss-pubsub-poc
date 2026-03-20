# Kysely + pg-boss DDD Event-Driven POC

## What This Is

A structured proof-of-concept demonstrating lightweight domain-driven development and cross-domain communication using pg-boss as a transactional event bus backed by PostgreSQL. Two domains (User and Notification) communicate asynchronously via typed domain events, with the core thesis being that pg-boss + KyselyAdapter enables atomic save-and-publish inside a single database transaction — no separate message broker, no outbox pattern, no dual-write risk.

## Core Value

Domain writes and domain event publishing are atomic: if the transaction rolls back, the event is never queued — no ghost notifications, no missed events.

## Requirements

### Validated

- ✓ KyselyAdapter bridges pg-boss and Kysely using the same pg.Pool — existing
- ✓ Single pg.Pool and Kysely<Database> singleton pattern — Validated in Phase 1: infrastructure-foundation
- ✓ KyselyAdapter implements pg-boss IDatabase via CompiledQuery.raw — Validated in Phase 1: infrastructure-foundation
- ✓ PgBoss singleton factory + KNOWN_QUEUES boot creation — Validated in Phase 1: infrastructure-foundation
- ✓ DomainEventMap typed event contract (user.registered payload) — Validated in Phase 1: infrastructure-foundation
- ✓ IEventBus interface in domain layer (zero pg-boss surface) — Validated in Phase 1: infrastructure-foundation
- ✓ PgBossEventBus implements IEventBus with transactional { db: KyselyAdapter } publish — Validated in Phase 1: infrastructure-foundation
- ✓ Folder-per-domain structure with clear boundaries (User domain) — Validated in Phase 2: user-domain
- ✓ Tactical DDD patterns: UserId/Email value objects (branded types), User entity (factory, readonly, private constructor), IUserRepository interface — Validated in Phase 2: user-domain
- ✓ User domain: register user (Kysely INSERT) + publish UserRegistered event atomically inside a single transaction — Validated in Phase 2: user-domain

**Current State:** Phase 2 complete — User domain built. UserService atomically saves user and publishes UserRegistered inside a single Kysely transaction. Phase 3 (Notification Domain + HTTP API) is next.

### Active

- [ ] Notification domain: subscribe to UserRegistered, handle asynchronously as a pg-boss worker
- [ ] HTTP API (Elysia) as the trigger surface — curl to trigger the full flow
- [ ] Observability: console logs showing the atomic tx commit, event queued, and handler execution

### Out of Scope

- Authentication/authorization — not relevant to the pattern
- Real email sending — notification handler logs, doesn't send
- Multiple event types beyond UserRegistered in v1 — one clear example is better than many shallow ones
- Separate message broker (Kafka, RabbitMQ, Redis Streams) — explicitly excluded; the point is pg-boss replaces them for this use case
- Outbox pattern — the transactional adapter makes it unnecessary

## Context

This repo already has a working single-file POC (`index.ts`) demonstrating the KyselyAdapter pattern. The goal is to restructure it into a proper multi-domain codebase that someone could use as a reference implementation.

**Existing stack:** Bun runtime, TypeScript (strict), Kysely ^0.28.9, pg ^8.16.3, pg-boss ^12.5.4, Docker Compose for Postgres.

**Key insight being demonstrated:** With a separate message broker (Kafka, RabbitMQ), you face the dual-write problem: write to DB + publish to broker are two separate operations. If one fails, you have inconsistency. The outbox pattern is a common mitigation. pg-boss + KyselyAdapter eliminates this entirely because pg-boss stores jobs in the same PostgreSQL database — so you can publish inside the same transaction as your domain write.

## Constraints

- **Tech Stack**: Bun + Kysely + pg-boss — no new database infrastructure, reuse existing pg.Pool
- **Framework**: Hono or Elysia for HTTP (lightweight, Bun-native friendly)
- **Scope**: POC clarity over production robustness — patterns must be clear and readable
- **TypeScript**: Strict mode, full type safety on the event bus (event name → payload type mapping)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| pg-boss over external broker | Same DB = atomic tx; no broker infra to manage | — Pending |
| Typed event bus abstraction | Domain code must not depend on pg-boss directly | — Pending |
| Folder-per-domain (not package-per-domain) | POC clarity; less tooling overhead | — Pending |
| Hono or Elysia for HTTP | Bun-native, lightweight, minimal boilerplate | — Pending |

---
*Last updated: 2026-03-20 after Phase 2: user-domain complete*

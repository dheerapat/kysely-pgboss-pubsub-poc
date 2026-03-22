# Milestones

## v1.3 Docker + Load Balancing (Shipped: 2026-03-22)

**Phases completed:** 3 phases, 5 plans, 6 tasks

**Key accomplishments:**

- Full 3-service Compose stack (postgres:17 + 6 app replicas) with pg_isready healthcheck, guaranteed boot ordering, and env-var-capped pg pool connections
- Caddyfile with round-robin LB policy and active health checks wired into docker-compose.yml, completing the 3-service stack
- Full 3-service stack validated: Caddy round-robin across 6 app replicas with pg-boss exactly-once job processing confirmed

---

## v1.2 Elysia Decorate Refactor (Shipped: 2026-03-22)

**Phases completed:** 2 phases, 3 plans, 4 tasks

**Key accomplishments:**

- Async Elysia plugin factory that wires all infra/domain services and decorates them onto context with full TypeScript inference — no `any` casts
- Two Elysia plugin factories extracted from index.ts — subscription wiring in workersPlugin, typed route handlers in userRoutesPlugin, zero closures
- src/index.ts rewritten as pure Elysia composition root — zero service instantiation, zero inline subscribe, boot order enforced via awaited workersPlugin, graceful shutdown via services.decorator

---

## v1.1 pg-boss Native Pub/Sub + Fan-Out (Shipped: 2026-03-21)

**Phases completed:** 3 phases, 7 plans, 12 tasks

**Key accomplishments:**

- Required `subscriberName: string` added to `IEventBus.subscribe()`, and `boss.ts` stripped to a bare PgBoss factory with no queue management
- `PgBossEventBus.subscribe()` derives queue name as `{subscriberName}.{eventName}` and runs `createQueue` before `work`; `index.ts` passes `'notification'` as subscriberName with FK-safe boot order
- `PgBossEventBus.publish()` migrated from `boss.send()` to `boss.publish()`, and `subscribe()` now uses the full 3-step `createQueue → boss.subscribe → boss.work` setup enabling native pg-boss fan-out
- `AuditService` created in `src/domains/audit/` as a pure domain class with no pg-boss dependency — logs audit entries for `user.registered` events, proving domain/infra boundary holds for new subscribers
- `AuditService` wired into `index.ts` as a second subscriber to `user.registered`; end-to-end fan-out verified — a single `POST /users` produces console logs from both `NotificationService` and `AuditService`
- One-liner:
- One-liner:

---

## v1.0 MVP (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 9 plans, 14 tasks

**Key accomplishments:**

- pg.Pool + Kysely<Database> singletons, KyselyAdapter (pg-boss db bridge), and users table DDL with UUID primary key and SQL defaults
- DomainEventMap typed event registry and IEventBus interface with generic keyof constraints — zero pg-boss surface in domain layer
- PgBossEventBus implementing IEventBus via boss.send() with transactional { db: KyselyAdapter } option, wired in src/index.ts boot sequence
- IDbClient structural interface introduced in domain layer, eliminating KyselyAdapter import from IEventBus and restoring clean domain/infrastructure boundary
- Pure domain layer established: UserId and Email branded value objects, User entity (private constructor + static factory), and IUserRepository interface with Transaction<Database> atomicity seam — zero pg-boss imports in domain
- UserRepository (Kysely) + UserService with single-transaction atomicity — INSERT user row and pg-boss job in one Kysely transaction via KyselyAdapter(tx), wired into src/index.ts
- NotificationService domain class with handleUserRegistered method that logs welcome email message, typed via DomainEventMap["user.registered"], with full unit test coverage using bun:test spyOn
- Elysia HTTP server with GET /users and POST /users routes wired to existing domain services, NotificationService registered as pg-boss worker before server start — completing full end-to-end transactional flow
- Duplicate email returns HTTP 409 with atomicity proof via 23505 catch, and README documents the dual-write problem, KyselyAdapter pattern, folder structure, and annotated curl demo

---

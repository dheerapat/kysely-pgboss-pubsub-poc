# Milestones

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

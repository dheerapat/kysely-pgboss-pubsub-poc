# Roadmap: kysely-pgboss-pubsub-poc

## Milestones

- ✅ **v1.0 MVP** - Phases 1-4 (shipped 2026-03-21)
- 🚧 **v1.1 pg-boss Native Pub/Sub + Fan-Out** - Phases 5-7 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) - SHIPPED 2026-03-21</summary>

### Phase 1: Foundation
**Goal**: Database infrastructure, pg-boss singleton, and Kysely bridge are initialized as shared singletons.
**Plans**: 2 plans

Plans:
- [x] 01-01: Pool, Kysely, KyselyAdapter, users table DDL
- [x] 01-02: PgBoss singleton with schema install and KNOWN_QUEUES

### Phase 2: Domain Layer
**Goal**: Typed event contract and clean domain/infra boundary are established.
**Plans**: 2 plans

Plans:
- [x] 02-01: DomainEventMap, IEventBus, IDbClient structural interface
- [x] 02-02: UserId + Email branded value objects, User entity, IUserRepository

### Phase 3: Application Logic
**Goal**: UserService atomically saves users and publishes events; NotificationService handles them.
**Plans**: 3 plans

Plans:
- [x] 03-01: UserRepository (Kysely impl) wired into UserService
- [x] 03-02: PgBossEventBus implementing IEventBus via boss.send()
- [x] 03-03: NotificationService + worker registration in boot sequence

### Phase 4: HTTP + Demo
**Goal**: HTTP API is live, rollback demo works, README documents the pattern.
**Plans**: 2 plans

Plans:
- [x] 04-01: Elysia routes GET /users + POST /users, duplicate email 409
- [x] 04-02: Console log sequence verified, README with curl demo

</details>

### 🚧 v1.1 pg-boss Native Pub/Sub + Fan-Out (In Progress)

**Milestone Goal:** Replace queue-based send/work with native pub/sub and prove fan-out: one `boss.publish()` → two independent subscriber fires, atomically, with rollback regression intact.

---

## Phase Details

### Phase 5: Boot Infrastructure & Interface Contract
**Goal**: The `IEventBus` interface gains a required `subscriberName` param and the boot sequence enforces strict create→subscribe→work→listen ordering — eliminating FK violations and silent event loss before any implementation begins.
**Depends on**: Phase 4
**Requirements**: BUS-03, BUS-04, BOOT-01, BOOT-02, BOOT-03
**Success Criteria** (what must be TRUE):
  1. `IEventBus.subscribe()` has a required third `subscriberName: string` param and TypeScript rejects any call site missing it
  2. `boss.ts` returns a bare `PgBoss` instance with no `KNOWN_QUEUES` definition
  3. Boot sequence in `index.ts` follows `start → createQueue → subscribe → work → listen` with no HTTP traffic accepted before all subscriptions are registered
  4. `boss.on('error', ...)` handler is present after the `boss.ts` refactor and errors surface to console
  5. Queue naming convention (`{subscriberName}.{eventName}`) lives entirely inside `PgBossEventBus` — no caller passes a queue name
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Interface contract: `IEventBus.subscribe()` + `boss.ts` cleanup
- [x] 05-02-PLAN.md — `PgBossEventBus.subscribe()` impl + `index.ts` boot wiring

### Phase 6: PgBossEventBus Migration + Fan-Out Wiring
**Goal**: `PgBossEventBus` uses `boss.publish()`/`boss.subscribe()` and two independent subscribers (`NotificationService` + `AuditService`) both fire when a single `user.registered` event is published.
**Depends on**: Phase 5
**Requirements**: BUS-01, BUS-02, FOUT-01, FOUT-02
**Success Criteria** (what must be TRUE):
  1. `PgBossEventBus.publish()` calls `boss.publish()` and the transactional `{ db: KyselyAdapter(tx) }` option is preserved
  2. `PgBossEventBus.subscribe()` performs the 3-step setup: `createQueue` → `boss.subscribe` → `boss.work` using the derived subscriber queue name
  3. `POST /users` with a new email produces console logs from **both** `NotificationService` and `AuditService` in a single run
  4. `AuditService` is a pure domain class with no pg-boss imports, mirroring the `NotificationService` pattern
**Plans**: TBD

### Phase 7: Documentation & Verification
**Goal**: The rollback regression is confirmed intact with two subscriber queues, and the README accurately documents the pub/sub model, fan-out mechanism, and boot sequence rationale.
**Depends on**: Phase 6
**Requirements**: VERI-01, VERI-02, VERI-03
**Success Criteria** (what must be TRUE):
  1. `POST /users` with a duplicate email returns HTTP 409 and zero jobs appear in either subscriber queue (`notification.user.registered` and `audit.user.registered`)
  2. README explains pub/sub vs queue-based approach, `pgboss.subscription` table role, fan-out mechanism, and boot sequence ordering rationale
  3. `PgBossEventBus` source contains an inline comment documenting `{ db }` partial-transaction semantics: subscription lookup uses the pool; job INSERTs use the active Kysely transaction
**Plans**: TBD

---

## Progress

**Execution Order:** 5 → 6 → 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 2/2 | Complete | 2026-03-21 |
| 2. Domain Layer | v1.0 | 2/2 | Complete | 2026-03-21 |
| 3. Application Logic | v1.0 | 3/3 | Complete | 2026-03-21 |
| 4. HTTP + Demo | v1.0 | 2/2 | Complete | 2026-03-21 |
| 5. Boot Infrastructure & Interface Contract | v1.1 | 2/2 | Complete   | 2026-03-21 |
| 6. PgBossEventBus Migration + Fan-Out Wiring | v1.1 | 0/? | Not started | - |
| 7. Documentation & Verification | v1.1 | 0/? | Not started | - |

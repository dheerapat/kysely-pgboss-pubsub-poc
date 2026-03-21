# Project Research Summary

**Project:** kysely-pgboss-pubsub-poc — v1.1 Pub/Sub + Fan-Out Migration
**Domain:** Event-driven DDD with pg-boss native pub/sub (PostgreSQL job queue)
**Researched:** 2026-03-21
**Confidence:** HIGH — all findings sourced directly from pg-boss 12.5.4 source in node_modules

## Executive Summary

This is a focused, well-scoped migration milestone — not a greenfield project. The v1.0 codebase already has a working `PgBossEventBus` powered by `boss.send()`/`boss.work()`. The v1.1 goal is to replace that with pg-boss's native pub/sub API (`boss.publish()`/`boss.subscribe()`) and prove fan-out delivery: one `user.registered` event should trigger both a `NotificationService` handler and a new `AuditService` handler independently and atomically. The entire migration is achievable with the already-installed `pg-boss@12.5.4` — no package upgrades, no new dependencies.

The recommended approach is surgical and low-risk. Only five files need modification (`IEventBus.ts`, `PgBossEventBus.ts`, `boss.ts`, `src/index.ts`, and a new `AuditService.ts`), and the domain layer (`UserService`, `NotificationService`) stays completely unchanged. The critical architectural insight is that `boss.publish()` routes jobs to all subscribed queues atomically through the existing `{ db: KyselyAdapter(tx) }` option — fan-out job inserts participate in the same database transaction as the user row insert.

The primary risks are boot sequence ordering and queue naming. `pgboss.subscription` has a FK constraint on `pgboss.queue`, meaning `boss.subscribe()` will throw a FK violation if called before `boss.createQueue()`. Additionally, `boss.publish()` silently creates zero jobs if no subscriptions are registered — events are permanently lost with no error. Both risks are fully preventable by following a strict boot order (create queues → register subscriptions → start workers → listen) and making `subscriberName` a required parameter in `IEventBus.subscribe()`. The TypeScript compiler enforces the naming contract at compile time.

## Key Findings

### Recommended Stack

No new packages are required. `pg-boss@12.5.4` (already installed) exposes `boss.publish()`, `boss.subscribe()`, and `boss.createQueue()` as stable APIs. A changelog scan from 12.5.4 to 12.14.0 (current latest) confirms no breaking changes and no required features for this milestone in any subsequent minor version. Staying on 12.5.4 is the right call.

The existing stack (Bun, TypeScript strict, Kysely, Elysia, Docker Compose, `pg`) is validated from v1.0 and requires no changes. The `KyselyAdapter` already satisfies `IDatabase { executeSql(text, values?) }` — the structural type pg-boss uses for transactional job inserts — so the transactional publish path works without modification.

**Core technologies:**
- **pg-boss 12.5.4**: Job queue + pub/sub — use `boss.publish()`/`boss.subscribe()` APIs already present; no upgrade needed
- **KyselyAdapter**: Transactional bridge — satisfies `IDatabase`, unchanged, routes job INSERTs through Kysely transactions
- **PostgreSQL `pgboss.subscription` table**: Fan-out backing store — `(event, queue)` pairs; FK-constrained; queried by `boss.publish()` at dispatch time

### Expected Features

**Must have (table stakes — v1.1 launch blockers):**
- Migrate `PgBossEventBus.publish()` from `boss.send()` to `boss.publish()` — without this, pub/sub doesn't exist
- Migrate `PgBossEventBus.subscribe()` to `boss.createQueue()` + `boss.subscribe()` + `boss.work()` — required 3-step setup per subscriber
- Update boot sequence: queue creation before subscription registration — FK constraint makes this non-optional
- Add `AuditService` as second subscriber for `user.registered` — fan-out requires N≥2 subscribers to prove the thesis
- Verify rollback regression: duplicate email POST must still create 0 jobs — core atomicity thesis must survive the migration
- Update README — undocumented pub/sub pattern has zero educational value

**Should have (elevates the POC from "it works" to "clearly demonstrates"):**
- Per-subscriber queue naming convention (`notification.user.registered`, `audit.user.registered`) — self-documenting queues
- Annotated console logs showing the fan-out sequence — reader observability
- `IEventBus.subscribe()` encapsulates queue creation + subscription registration — domain code stays pg-boss-unaware

**Defer (v2+):**
- Second event type (`user.deactivated`) — dilutes the fan-out lesson; one event with two subscribers is clearer
- Dead letter queue demo — failure visibility; separate concern
- `@pg-boss/dashboard` integration — useful for teaching but not essential to prove fan-out
- Event replay/history — pg-boss is not an event store; out of scope by design

### Architecture Approach

The architecture is a layered DDD design with clean separation: the domain layer (`UserService`, `NotificationService`, `AuditService`) never imports pg-boss; the infrastructure layer (`PgBossEventBus`) hides all pg-boss mechanics behind the `IEventBus` interface. The only interface change is adding a required `subscriberName: string` third parameter to `IEventBus.subscribe()` — this is a breaking change at 2 call sites in `index.ts` that TypeScript surfaces immediately. The `boss.ts` boot file is simplified by removing `KNOWN_QUEUES`; subscriber queues are now created dynamically inside `PgBossEventBus.subscribe()`, co-located with the subscription registration that names them.

**Major components:**
1. **`IEventBus` (MODIFIED)** — domain contract; gains required `subscriberName` param to enable unique per-subscriber queue naming
2. **`PgBossEventBus` (MODIFIED)** — infrastructure adapter; `publish()` → `boss.publish()`, `subscribe()` → `createQueue()` + `boss.subscribe()` + `boss.work()`
3. **`boss.ts` (MODIFIED)** — PgBoss singleton; removes `KNOWN_QUEUES`, returns bare boss instance; queue lifecycle moves to `PgBossEventBus`
4. **`AuditService` (NEW)** — second subscriber domain; mirrors `NotificationService`; pure domain logic, no infra imports
5. **`src/index.ts` (MODIFIED)** — composition root; wires both subscribers before `app.listen()`

### Critical Pitfalls

1. **`boss.subscribe()` before `boss.createQueue()` → FK violation** — The `pgboss.subscription` table has a FK constraint on `pgboss.queue`. Always call `createQueue()` first. Both are idempotent so this is safe to enforce unconditionally at every boot.

2. **`boss.publish()` with no registered subscriptions → silent event loss** — `boss.publish()` returns `void` and creates zero jobs if no subscriptions exist. Boot sequence must complete all `boss.subscribe()` calls before `app.listen()`. There is no error to catch; events are permanently lost.

3. **`boss.work()` called on event name instead of subscriber queue name** — After migration, `boss.work("user.registered", handler)` polls the wrong queue. Must be `boss.work("notification.user.registered", handler)`. The worker silently polls an empty queue; no error is thrown.

4. **Old `KNOWN_QUEUES = ["user.registered"]` creates an orphaned queue** — The v1.0 queue named `"user.registered"` receives no jobs from `boss.publish()` (which routes only to queues in `pgboss.subscription`). Remove `KNOWN_QUEUES` entirely; let `PgBossEventBus.subscribe()` manage queue creation.

5. **Optional `subscriberName` parameter causes silent fan-out breakage** — If `subscriberName` is optional and two subscribers omit it, both derive the same queue name; only one subscriber receives each job. Make `subscriberName` required in `IEventBus.subscribe()` — TypeScript enforces this at compile time.

## Implications for Roadmap

Based on research, the natural phase structure follows the build order dictated by TypeScript's type-boundary-first enforcement and pg-boss's FK constraints. Three focused phases cover the full migration.

### Phase 1: Boot Infrastructure & Interface Contract

**Rationale:** The boot sequence ordering is a hard prerequisite for everything else — FK constraints make it impossible to test anything until queues exist and subscriptions are registered. The `IEventBus` interface change must come first because TypeScript will surface all downstream mismatches the moment it's modified, guiding the rest of the implementation.

**Delivers:**
- Updated `IEventBus.subscribe()` signature with required `subscriberName: string` param
- `boss.ts` simplified: `KNOWN_QUEUES` removed, bare boss returned
- Boot sequence in `index.ts` follows: `start → createQueue → subscribe → work → listen`
- `boss.on('error', ...)` handler verified in place

**Addresses:** Boot sequence race (Pitfall 6), FK violation (Pitfall 1), silent event loss (Pitfall 2), orphaned `KNOWN_QUEUES` (Pitfall 4)

**Avoids:** Starting the HTTP server before subscriptions are registered; calling `boss.subscribe()` before `boss.createQueue()`

### Phase 2: PgBossEventBus Migration + Fan-Out Wiring

**Rationale:** With the interface contract and boot infrastructure in place, `PgBossEventBus` can be migrated and both subscribers wired. This is where the fan-out thesis is proven: one `boss.publish()` → two independent job rows → two independent worker fires.

**Delivers:**
- `PgBossEventBus.publish()`: `boss.send()` → `boss.publish()`
- `PgBossEventBus.subscribe()`: `boss.work()` → `createQueue()` + `boss.subscribe()` + `boss.work()` with derived queue name
- New `AuditService` with `handleUserRegistered()` handler
- Both `NotificationService` and `AuditService` registered in `index.ts` before `app.listen()`
- Manual verification: `POST /users` produces logs from both services; duplicate email produces no jobs in either queue

**Addresses:** Wrong queue name in `boss.work()` (Pitfall 5), `IEventBus` signature gap (Pitfall 8)

**Uses:** `boss.publish()`, `boss.subscribe()`, `boss.createQueue()`, `boss.work()` — all in pg-boss 12.5.4

**Implements:** Fan-out data flow, transactional atomicity with two subscriber queue inserts

### Phase 3: Documentation & Verification

**Rationale:** The POC's educational value depends on the README explaining the pub/sub model. This phase is low-risk (prose writing + manual testing) but non-optional for the milestone.

**Delivers:**
- README updated: pub/sub vs queue-based model, subscription table role, fan-out mechanism, boot sequence rationale
- Rollback regression verified: duplicate email `POST` → 409, zero jobs in both subscriber queues
- Per-subscriber queue naming convention documented
- `{ db }` partial-transaction semantics documented in `PgBossEventBus` comment (subscription lookup uses pool, job INSERTs use tx)

**Addresses:** Documentation gap (Pitfall 3 — `{ db }` semantics must be accurate), "looks done but isn't" checklist from PITFALLS.md

### Phase Ordering Rationale

- **Interface before implementation:** `IEventBus` is the type boundary — changing it first lets TypeScript surface every downstream mismatch, reducing debugging surface area.
- **Boot infrastructure before fan-out wiring:** FK constraints make it impossible to register subscriptions before queues exist; fixing boot order is the unlocking prerequisite for everything else.
- **Fan-out wiring as single atomic step:** `PgBossEventBus` migration, `AuditService` creation, and `index.ts` wiring are tightly coupled — doing them together avoids intermediate states where TypeScript errors pile up.
- **Documentation last:** README can only accurately describe the final behavior; writing it last ensures accuracy.

### Research Flags

Phases with well-documented patterns (skip `/gsd-research-phase`):
- **Phase 1:** Boot sequence and interface patterns are fully specified in ARCHITECTURE.md with exact file names, line-level changes, and TypeScript signatures. No unknowns.
- **Phase 2:** `PgBossEventBus` migration is fully specified with implementation patterns, queue naming convention, and handler signatures. No unknowns.
- **Phase 3:** README prose writing and manual verification; no research needed.

No phases require `/gsd-research-phase` — research is complete and authoritative (sourced from installed package source, not docs or training data).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified directly from `node_modules/pg-boss/dist/*.d.ts` and `manager.js`. No training-data-only claims. Changelog scanned 12.5.4 → 12.14.0. |
| Features | HIGH | Derived from pg-boss source + existing codebase analysis. MVP scope is minimal and well-bounded. |
| Architecture | HIGH | All patterns verified from source. Component boundaries and data flow confirmed against pg-boss internals. Build order specified file-by-file. |
| Pitfalls | HIGH | FK constraint, silent publish, `Promise.allSettled` behavior all verified from source SQL and JS. 8 pitfalls documented with code examples. |

**Overall confidence:** HIGH

### Gaps to Address

- **`Promise.allSettled` partial failure observability:** `boss.publish()` swallows per-subscriber INSERT failures silently. The POC accepts this (best-effort fan-out), but verify that `boss.on('error', ...)` is still registered after the `boss.ts` refactor — it's in the existing `createBoss()` but could be accidentally removed.

- **Old `"user.registered"` queue data from v1.0 dev runs:** If Docker volumes from v1.0 testing persist, the `pgboss.job` table may have unconsumed jobs in the `"user.registered"` queue. These are harmless but create confusion. Resolution: run `docker compose down -v` before testing v1.1, or document the cleanup step in the README.

- **`IEventBus` call-site audit:** ARCHITECTURE.md identifies 2 call sites in `index.ts`. Confirm no other files (test files, future-planned code) call `eventBus.subscribe()` before finalizing the interface change to avoid missed TypeScript errors.

## Sources

### Primary (HIGH confidence)

- `node_modules/pg-boss/dist/manager.js` — `publish()`, `subscribe()`, `unsubscribe()` implementations; `Promise.allSettled` fan-out; `this.db` vs `options.db` split
- `node_modules/pg-boss/dist/plans.js` — subscription table DDL; `getQueuesForEvent()` SQL; FK constraint definition
- `node_modules/pg-boss/dist/index.d.ts` — TypeScript signatures for `publish`, `subscribe`, `work`, `createQueue`
- `node_modules/pg-boss/dist/types.d.ts` — `SendOptions`, `ConnectionOptions`, `IDatabase`, `WorkHandler` types
- `src/infrastructure/events/PgBossEventBus.ts` — v1.0 implementation being migrated
- `src/infrastructure/events/boss.ts` — current boot sequence with `KNOWN_QUEUES`
- `src/domains/shared/IEventBus.ts` — domain interface contract
- `src/index.ts` — composition root; current subscriber wiring
- `https://github.com/timgit/pg-boss/releases` — changelog 12.5.4 → 12.14.0; no breaking changes affecting this milestone
- `https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/pubsub.md` — official pub/sub API docs
- `https://registry.npmjs.org/pg-boss/latest` — latest version (12.14.0) confirmed

### Secondary (MEDIUM confidence)

- pg-boss GitHub README (v12.5.4) — "Pub/sub API for fan-out queue relationships" feature summary

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*

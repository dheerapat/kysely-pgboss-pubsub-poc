---
phase: 01-infrastructure-foundation
plan: "03"
subsystem: infra
tags: [pg-boss, event-bus, singleton, queue, wiring]

requires:
  - phase: 01-01
    provides: KyselyAdapter, kysely singleton, pool singleton, setupSchema
  - phase: 01-02
    provides: IEventBus interface, DomainEventMap type
provides:
  - PgBoss singleton via createBoss() factory
  - PgBossEventBus (IEventBus implementation)
  - KNOWN_QUEUES registry (user.registered)
  - src/index.ts wiring setupSchema -> createBoss -> PgBossEventBus
affects:
  - phase-02 (UserService receives PgBossEventBus as IEventBus)
  - phase-03 (NotificationService subscribes via PgBossEventBus)

tech-stack:
  added: [pg-boss]
  patterns:
    - Factory singleton: createBoss() creates-and-starts one PgBoss instance
    - Queue-first publish: all queues created at boot via KNOWN_QUEUES before any send()
    - Transactional event: boss.send(event, payload, { db: kyselyAdapter }) for atomicity
    - IEventBus implementation: PgBossEventBus adapts pg-boss to the domain contract

key-files:
  created:
    - src/infrastructure/events/boss.ts
    - src/infrastructure/events/PgBossEventBus.ts
    - src/index.ts
  modified: []

key-decisions:
  - "Used boss.send() (queue-based) not boss.publish() (event-bus) — KNOWN_QUEUES queues are pre-created, direct send is simpler and the db option works the same"
  - "subscribe() uses boss.work() directly on the queue (event name = queue name) — no separate boss.subscribe() + boss.work() needed"
  - "src/index.ts created in src/ as the new DDD entry point; root index.ts preserved as POC reference"
  - "KNOWN_QUEUES registered as const tuple — adding new events requires explicitly adding queue names here"

patterns-established:
  - "Queue registry: KNOWN_QUEUES as const tuple, iterated at boot to ensure queues exist before publishes"
  - "Infrastructure wiring: main() in src/index.ts is the composition root — domain services injected here in later phases"

requirements-completed:
  - INFRA-03
  - INFRA-06

duration: 1min
completed: 2026-03-20
---

# Phase 01 Plan 03: PgBoss Singleton + Event Bus + App Wiring Summary

**PgBossEventBus implementing IEventBus via boss.send() with transactional { db: KyselyAdapter } option, wired in src/index.ts boot sequence**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-20T13:50:52Z
- **Completed:** 2026-03-20T13:51:59Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `createBoss()` starts pg-boss and pre-creates all `KNOWN_QUEUES` before returning — guarantees queues exist for publish
- `PgBossEventBus` implements `IEventBus` using `boss.send(event, payload, { db })` for transactional atomicity
- `src/index.ts` is the composition root: `setupSchema → createBoss → new PgBossEventBus(boss)` boot sequence
- Graceful SIGINT shutdown: `boss.stop()` then `pool.end()`
- Zero pg-boss imports in `src/domains/` — domain layer stays infrastructure-agnostic

## Task Commits

1. **Task 1: Create boss.ts singleton and PgBossEventBus implementation** - `48206e7` (feat)
2. **Task 2: Create src/index.ts wiring all infrastructure** - `000cd4a` (feat)

## Files Created/Modified

- `src/infrastructure/events/boss.ts` - createBoss() factory + KNOWN_QUEUES registry
- `src/infrastructure/events/PgBossEventBus.ts` - IEventBus impl via pg-boss send/work
- `src/index.ts` - Composition root: schema → boss → eventBus → SIGINT handler

## Decisions Made

- Used `boss.send()` (queue-based) rather than `boss.publish()` (event-based pattern) — both accept `{ db }`, but since KNOWN_QUEUES are pre-created, direct queue send is cleaner than the publish/subscribe/work three-step
- `subscribe()` uses `boss.work(queueName, handler)` directly — the event name and queue name are the same, so no intermediary `boss.subscribe()` call needed

## Deviations from Plan

None - plan executed exactly as written (chose `boss.send()` as the plan recommended, confirmed against pg-boss types that both `send()` and `publish()` accept `SendOptions` with `db`).

## Issues Encountered

None

## User Setup Required

None - no external service configuration required (Docker setup for runtime testing is separate from TypeScript compilation success).

## Next Phase Readiness

- Phase 1 infrastructure complete — all 3 plans done
- `PgBossEventBus` is ready to be injected into `UserService` (Phase 2)
- `src/index.ts` is the wiring point — Phase 2 adds UserService/NotificationService registration there
- To test with Docker: `docker compose up -d && bun run src/index.ts`

---
*Phase: 01-infrastructure-foundation*
*Completed: 2026-03-20*

## Self-Check: PASSED

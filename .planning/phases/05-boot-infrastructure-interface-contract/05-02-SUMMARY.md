---
phase: 05-boot-infrastructure-interface-contract
plan: "02"
subsystem: infra
tags: [pg-boss, typescript, event-bus, queue-naming, boot-order]

# Dependency graph
requires:
  - phase: 05-01
    provides: IEventBus.subscribe() with required subscriberName param; bare boss.ts factory
provides:
  - PgBossEventBus.subscribe() derives queue name as {subscriberName}.{eventName} internally
  - boss.createQueue() called before boss.work() inside subscribe() — FK-safe boot order
  - index.ts passes 'notification' as subscriberName; HTTP listen only after subscriptions ready
  - TypeScript compiles clean (zero errors) across all Phase 5 changes
affects: [06-pubsub-fanout, 07-e2e-demo]

# Tech tracking
tech-stack:
  added: []
  patterns: [queue-naming-encapsulation, fk-safe-boot-order, subscribe-before-listen]

key-files:
  created: []
  modified:
    - src/infrastructure/events/PgBossEventBus.ts
    - src/index.ts

key-decisions:
  - "Queue name derivation ({subscriberName}.{eventName}) lives entirely inside PgBossEventBus.subscribe() — domain callers never construct queue names"
  - "boss.createQueue(queueName) called before boss.work(queueName) inside subscribe() — required by pg-boss FK constraint on subscription table"
  - "Boot order: start → createQueue → work → listen — HTTP server only starts after all subscriptions are registered"

patterns-established:
  - "Queue naming encapsulation: callers pass subscriberName, never queue names — naming logic lives in PgBossEventBus"
  - "FK-safe subscription: createQueue always precedes work in subscribe() — prevents FK violation on pgboss.subscription"
  - "Subscribe-before-listen: eventBus.subscribe() called before app.listen() guarantees no HTTP requests arrive before workers are ready"

requirements-completed: [BUS-04, BOOT-02]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 05 Plan 02: Implementation — PgBossEventBus + index.ts Boot Sequence Summary

**`PgBossEventBus.subscribe()` derives queue name as `{subscriberName}.{eventName}` and runs `createQueue` before `work`; `index.ts` passes `'notification'` as subscriberName with FK-safe boot order**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T12:40:00Z
- **Completed:** 2026-03-21T12:45:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `PgBossEventBus.subscribe()` now accepts `subscriberName: string` as required 3rd param — implements the Plan 01 interface contract
- Queue name derived as `` `${subscriberName}.${event}` `` inside `subscribe()` — domain callers never see or construct queue names
- `boss.createQueue(queueName)` called before `boss.work(queueName, ...)` inside `subscribe()` — satisfies pg-boss FK constraint on subscription table
- `index.ts` updated: `eventBus.subscribe()` call passes `'notification'` as subscriberName
- Boot order enforced: `start → createQueue → work → listen` — HTTP server only accepts requests after all workers are ready
- `bunx tsc --noEmit` compiles with zero errors; all 9 tests pass

## Task Commits

Each task was committed atomically as part of Plan 02 combined commit:

1. **Task 1: Update `PgBossEventBus.subscribe()` to accept `subscriberName` and derive queue name** - `79f069f` (feat)
2. **Task 2: Update `index.ts` subscribe call site and verify boot order** - `79f069f` (feat)

**Plan metadata:** documented in combined commit `79f069f`

## Files Created/Modified
- `src/infrastructure/events/PgBossEventBus.ts` - Updated `subscribe()` with `subscriberName` param, queue name derivation, `createQueue` before `work`; updated class JSDoc
- `src/index.ts` - `eventBus.subscribe()` call passes `'notification'` as subscriberName; boot sequence comment updated to reflect new lifecycle

## Decisions Made
- Queue naming encapsulation in `PgBossEventBus` (not `index.ts`) is the correct location — callers should never know about queue infrastructure
- `boss.send()` in `publish()` remains unchanged in Phase 5 — migration to `boss.publish()` is deferred to Phase 6 as planned

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Phase 5 interface contract is fully implemented and TypeScript-clean
- Phase 6 can migrate `boss.send()` to `boss.publish()` in `PgBossEventBus.publish()` to enable native pub/sub fan-out
- Phase 7 can add a second subscriber (e.g., `'audit'`) to demonstrate fan-out — subscriber queue would be `audit.user.registered`
- **NOTE:** Docker volumes may have stale v1.0 jobs in `"user.registered"` queue; run `docker compose down -v` before first v1.1 test run

---
*Phase: 05-boot-infrastructure-interface-contract*
*Completed: 2026-03-21*

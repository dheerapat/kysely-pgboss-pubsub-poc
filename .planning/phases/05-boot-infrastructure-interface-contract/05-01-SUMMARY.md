---
phase: 05-boot-infrastructure-interface-contract
plan: "01"
subsystem: infra
tags: [pg-boss, typescript, event-bus, interface]

# Dependency graph
requires:
  - phase: 04-rollback-demo-readme
    provides: Working v1.0 event bus with IEventBus, PgBossEventBus, boss.ts
provides:
  - IEventBus.subscribe() with required subscriberName: string third parameter
  - boss.ts bare PgBoss factory — no KNOWN_QUEUES, no createQueue loop
affects: [05-02, 06-pubsub-fanout, 07-e2e-demo]

# Tech tracking
tech-stack:
  added: []
  patterns: [required-subscriberName-interface-contract, queue-lifecycle-in-subscriber]

key-files:
  created: []
  modified:
    - src/domains/shared/IEventBus.ts
    - src/infrastructure/events/boss.ts

key-decisions:
  - "subscriberName is REQUIRED (not optional) in IEventBus.subscribe() — TypeScript enforces subscriber identity at every call site"
  - "Queue lifecycle (createQueue, subscribe, work) moves entirely into PgBossEventBus.subscribe() — boss.ts becomes a bare PgBoss factory"

patterns-established:
  - "Interface-first enforcement: typed contract in IEventBus forces all implementors and callers to pass subscriberName"
  - "Queue naming convention documented in JSDoc: {subscriberName}.{eventName} — e.g. notification.user.registered"

requirements-completed: [BUS-03, BOOT-01, BOOT-03]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 05 Plan 01: Interface Contract — IEventBus + boss.ts Refactor Summary

**Required `subscriberName: string` added to `IEventBus.subscribe()`, and `boss.ts` stripped to a bare PgBoss factory with no queue management**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T12:35:00Z
- **Completed:** 2026-03-21T12:40:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `IEventBus.subscribe()` now requires `subscriberName: string` as a required third parameter — TypeScript enforces subscriber identity at every call site
- Updated JSDoc on `IEventBus` documents the `{subscriberName}.{eventName}` queue naming convention
- `boss.ts` no longer manages queues (`KNOWN_QUEUES` deleted, `createQueue` loop removed) — it is now a pure "start PgBoss and return it" factory
- `boss.on("error", console.error)` retained — error handler still in place for BOOT-03

## Task Commits

Each task was committed atomically as part of Plan 01 combined commit:

1. **Task 1: Add required `subscriberName` param to `IEventBus.subscribe()`** - `7af0538` (feat)
2. **Task 2: Remove `KNOWN_QUEUES` from `boss.ts`; keep error handler** - `7af0538` (feat)

**Plan metadata:** documented in combined commit `7af0538`

## Files Created/Modified
- `src/domains/shared/IEventBus.ts` - Added `subscriberName: string` as required 3rd param to `subscribe()`; updated JSDoc with naming convention
- `src/infrastructure/events/boss.ts` - Removed `KNOWN_QUEUES` export and `createQueue` loop; updated JSDoc; kept error handler

## Decisions Made
- `subscriberName` is **required** (not optional) — optional would allow silent fan-out breakage where two subscribers derive the same queue name
- Queue lifecycle ownership moves to `PgBossEventBus.subscribe()`, not `createBoss()` — establishes clear responsibility boundary

## Deviations from Plan

None — plan executed exactly as written.

TypeScript compiled cleanly after both tasks (zero errors). The plan anticipated errors at PgBossEventBus and index.ts call sites, but TS structural typing accepted the implementation as compatible — those sites are corrected in Plan 02 anyway.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Plan 01 contract is set; Plan 02 can implement `PgBossEventBus.subscribe()` against the new interface signature
- Both modified files compile clean (`boss.ts`, `IEventBus.ts`)
- TypeScript errors at call sites (PgBossEventBus.ts, index.ts) are resolved in Plan 02

---
*Phase: 05-boot-infrastructure-interface-contract*
*Completed: 2026-03-21*

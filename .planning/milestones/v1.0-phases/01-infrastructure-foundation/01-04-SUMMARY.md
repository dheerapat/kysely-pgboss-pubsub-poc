---
phase: 01-infrastructure-foundation
plan: "04"
subsystem: infra
tags: [typescript, domain-driven-design, structural-typing, kysely, pg-boss]

requires:
  - phase: 01-01
    provides: KyselyAdapter with executeSql method (structurally satisfies IDbClient)
  - phase: 01-02
    provides: IEventBus interface and DomainEventMap type in domain shared layer
  - phase: 01-03
    provides: PgBossEventBus implementation of IEventBus

provides:
  - IDbClient interface in src/domains/shared/ — minimal structural db client contract
  - Clean domain/infrastructure boundary in src/domains/shared/
  - IEventBus.publish() opts.db typed as IDbClient (not KyselyAdapter)
  - PgBossEventBus.publish() opts.db typed as IDbClient

affects: [02-user-domain, 03-notification-domain]

tech-stack:
  added: []
  patterns: [structural-typing for domain/infrastructure boundary, minimal interface principle]

key-files:
  created: [src/domains/shared/IDbClient.ts]
  modified: [src/domains/shared/IEventBus.ts, src/infrastructure/events/PgBossEventBus.ts]

key-decisions:
  - "IDbClient uses structural typing — KyselyAdapter satisfies it automatically with no call-site changes"
  - "IDbClient kept minimal (single executeSql method) — avoids over-specifying the contract"
  - "KyselyAdapter import removed from PgBossEventBus — IDbClient imported from domains/shared instead"

patterns-established:
  - "Domain shared interfaces must have zero imports from ../../infrastructure/"
  - "Cross-layer dependencies flow via structural interfaces, never concrete infrastructure classes"

requirements-completed: [INFRA-05]

duration: 5min
completed: 2026-03-21
---

# Phase 01: Infrastructure Foundation — Plan 04 Summary

**IDbClient structural interface introduced in domain layer, eliminating KyselyAdapter import from IEventBus and restoring clean domain/infrastructure boundary**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T06:00:00Z
- **Completed:** 2026-03-21T06:05:00Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 updated)

## Accomplishments
- Created `IDbClient` — minimal structural interface (`executeSql` only) in `src/domains/shared/`
- Removed infrastructure import from `IEventBus.ts` — domain shared layer now fully clean
- Updated `PgBossEventBus.ts` to import `IDbClient` from domain layer; `KyselyAdapter` import removed entirely
- `bun tsc --noEmit` passes with 0 errors; structural typing confirms KyselyAdapter satisfies IDbClient without any call-site changes

## Task Commits

1. **Task 1 + Task 2: Create IDbClient, fix IEventBus and PgBossEventBus** - `b4710e5` (feat)

## Files Created/Modified
- `src/domains/shared/IDbClient.ts` — New minimal structural interface; single `executeSql` method that KyselyAdapter satisfies via TypeScript structural typing
- `src/domains/shared/IEventBus.ts` — Removed `KyselyAdapter` import; now imports `IDbClient` from same layer; `publish()` opts.db typed as `IDbClient`
- `src/infrastructure/events/PgBossEventBus.ts` — Updated to import `IDbClient` from domains/shared; `KyselyAdapter` import removed; `publish()` opts.db updated to `IDbClient`

## Decisions Made
- Used TypeScript structural typing: `KyselyAdapter` declares `executeSql(text: string, values: any[] = [])` which satisfies `IDbClient`'s `executeSql(text: string, values?: any[])` — default parameter vs optional parameter are structurally compatible
- Kept `IDbClient` minimal (one method only) to avoid over-specifying the contract and coupling future implementations

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Domain/infrastructure boundary fully clean in `src/domains/shared/`
- INFRA-05 requirement satisfied: domain layer has zero imports from infrastructure
- UAT test 3 condition (boundary clean) now met
- Phases 2 and 3 can safely use `IEventBus` without any infrastructure coupling

---
*Phase: 01-infrastructure-foundation*
*Completed: 2026-03-21*

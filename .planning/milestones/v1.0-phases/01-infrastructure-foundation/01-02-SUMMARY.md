---
phase: 01-infrastructure-foundation
plan: "02"
subsystem: domain-events
tags: [typescript, events, interface, domain-driven-design]

requires: []
provides:
  - DomainEventMap type (src/domains/shared/events.ts)
  - IEventBus interface (src/domains/shared/IEventBus.ts)
affects:
  - 01-03 (PgBossEventBus implements IEventBus), phase-02 (UserService uses IEventBus), phase-03 (NotificationService uses IEventBus)

tech-stack:
  added: []
  patterns:
    - Typed event map pattern (DomainEventMap as mapped type for compile-time safety)
    - Interface segregation (domain code depends on IEventBus, never PgBossEventBus)
    - Transactional publish pattern (opts.db?: KyselyAdapter for atomicity)

key-files:
  created:
    - src/domains/shared/events.ts
    - src/domains/shared/IEventBus.ts
  modified: []

key-decisions:
  - "DomainEventMap is a type (not interface) — required for use as mapped type key constraint"
  - "IEventBus.publish accepts optional KyselyAdapter in opts for transactional routing — this is how domain code triggers atomic event publishing without depending on pg-boss"
  - "Zero pg-boss imports in src/domains/shared/ — domain layer stays infrastructure-agnostic"

patterns-established:
  - "Event contract: DomainEventMap as single source of truth for all event names and payload shapes"
  - "Generic constraint: <K extends keyof DomainEventMap> enforces type safety on both publish and subscribe"

requirements-completed:
  - INFRA-04
  - INFRA-05

duration: 1min
completed: 2026-03-20
---

# Phase 01 Plan 02: Domain Event Type Contract Summary

**DomainEventMap typed event registry and IEventBus interface with generic keyof constraints — zero pg-boss surface in domain layer**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-20T13:47:39Z
- **Completed:** 2026-03-20T13:48:21Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- `DomainEventMap` type establishes `"user.registered"` → `{ userId, email, name }` as the compile-time contract
- `IEventBus` interface with generics `<K extends keyof DomainEventMap>` enforces event name + payload type safety
- Optional `opts.db?: KyselyAdapter` in publish enables transactional atomicity without exposing pg-boss to domain
- Zero pg-boss or infrastructure imports in `src/domains/shared/`

## Task Commits

1. **Task 1: Create DomainEventMap and IEventBus in src/domains/shared/** - `88cf3b3` (feat)

## Files Created/Modified

- `src/domains/shared/events.ts` - DomainEventMap type (user.registered event with userId/email/name)
- `src/domains/shared/IEventBus.ts` - IEventBus interface importing KyselyAdapter (for atomicity)

## Decisions Made

- `IEventBus` imports `KyselyAdapter` (not pg-boss) — KyselyAdapter is the thin adapter with no pg-boss surface, making it safe to reference from the domain layer
- Used `type` keyword for DomainEventMap (not `interface`) to allow use as mapped type key

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Domain event contract complete — plan 01-03 can implement `PgBossEventBus implements IEventBus`
- Phase 2 (UserService) and Phase 3 (NotificationService) can import `IEventBus` without transitively depending on pg-boss

---
*Phase: 01-infrastructure-foundation*
*Completed: 2026-03-20*

## Self-Check: PASSED

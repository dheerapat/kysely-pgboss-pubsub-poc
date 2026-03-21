---
phase: 02-user-domain
plan: "02"
subsystem: api
tags: [kysely, postgres, pg-boss, transaction, repository, domain-service]

# Dependency graph
requires:
  - phase: 02-user-domain-01
    provides: User, Email, UserId, IUserRepository domain types and interfaces
  - phase: 01-infrastructure
    provides: kysely singleton, KyselyAdapter, PgBossEventBus, IEventBus

provides:
  - UserRepository: Kysely implementation of IUserRepository (infrastructure/user/)
  - UserService: domain service with atomic register() — INSERT + event in single tx
  - Updated src/index.ts composition root wiring UserRepository and UserService

affects: [03-notification-domain, 04-rollback-demo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transaction passed as parameter — UserService owns tx lifetime, repo receives it"
    - "KyselyAdapter(tx) routes pg-boss job insertion through active Kysely transaction"
    - "Composition root (index.ts) instantiates infrastructure + injects into domain services"

key-files:
  created:
    - src/infrastructure/user/UserRepository.ts
    - src/domains/user/UserService.ts
  modified:
    - src/index.ts

key-decisions:
  - "UserService opens and owns the transaction — UserRepository receives tx as parameter, enforcing clean separation"
  - "KyselyAdapter(tx) is the bridge that routes pg-boss sendOnce() through the active Kysely transaction, achieving INSERT+job atomicity"
  - "Email validation (Email.create) happens before the transaction opens — fail fast before any DB I/O"

patterns-established:
  - "Transaction ownership: service layer opens tx, infra layer receives tx — never crosses the boundary"
  - "Atomic event publishing: all pg-boss job inserts use KyselyAdapter(tx) to stay within the outer transaction"

requirements-completed:
  - USER-05
  - USER-06

# Metrics
duration: 2min
completed: 2026-03-20
---

# Phase 2 Plan 02: UserRepository + UserService Summary

**UserRepository (Kysely) + UserService with single-transaction atomicity — INSERT user row and pg-boss job in one Kysely transaction via KyselyAdapter(tx), wired into src/index.ts**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-20T14:08:32Z
- **Completed:** 2026-03-20T14:10:45Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- UserRepository implements IUserRepository with save(user, tx) using Kysely insertInto — tx controlled by caller
- UserService.register() opens a single kysely.transaction(), calling repo.save() and eventBus.publish() within the same tx boundary
- KyselyAdapter(tx) bridges the Kysely transaction to pg-boss's sendOnce() call, making the job insert atomic with the user INSERT
- src/index.ts updated as composition root: instantiates UserRepository and UserService, injecting dependencies

## Task Commits

Each task was committed atomically:

1. **Task 1: Create UserRepository** - `49c8f9b` (feat)
2. **Task 2: Create UserService + update src/index.ts** - `d6037bd` (feat)

**Plan metadata:** (docs commit - see below)

## Files Created/Modified
- `src/infrastructure/user/UserRepository.ts` - Kysely implementation of IUserRepository; save() uses tx param, findAll() uses kysely singleton
- `src/domains/user/UserService.ts` - Domain service; register() wraps INSERT + event publish in single transaction
- `src/index.ts` - Composition root updated to instantiate and wire UserRepository and UserService

## Decisions Made
- **Transaction ownership**: UserService opens the tx and passes it to UserRepository — the repo never manages its own transaction. This enforces a clean layer boundary and matches the POC thesis.
- **KyselyAdapter(tx)**: The bridge between Kysely transactions and pg-boss. Passing `new KyselyAdapter(tx)` into `eventBus.publish()` routes the pg-boss job insertion through the same active transaction — the core atomicity guarantee.
- **Email validation before tx**: Email.create(emailStr) throws on invalid email before the transaction opens, following fail-fast principle and avoiding wasted DB I/O.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The plan's `<verify>` command `bun build src/domains/user/UserService.ts src/index.ts --target bun` fails with "Must use --outdir when specifying more than one entry point" in Bun. Built each entry point separately to confirm successful compilation, and ran full `bun build src/ --target bun --outdir /tmp/bun-build-check` (exit 0, 348 modules bundled). This is a Bun CLI quirk, not a code issue.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UserRepository and UserService are wired and ready
- The core POC thesis (atomic INSERT + pg-boss job in single transaction) is fully implemented
- Phase 3 can add NotificationService and HTTP API endpoints to exercise UserService.register() end-to-end
- Phase 4 can demonstrate rollback behavior (transaction aborted → no orphaned pg-boss job)

## Self-Check: PASSED

- FOUND: src/infrastructure/user/UserRepository.ts
- FOUND: src/domains/user/UserService.ts
- FOUND: src/index.ts
- FOUND: commit 49c8f9b (feat(02-02): create UserRepository)
- FOUND: commit d6037bd (feat(02-02): create UserService + update index.ts)

---
*Phase: 02-user-domain*
*Completed: 2026-03-20*

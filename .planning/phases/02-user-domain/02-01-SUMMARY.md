---
phase: 02-user-domain
plan: "01"
subsystem: domain
tags: [typescript, ddd, value-objects, branded-types, tdd, kysely]

# Dependency graph
requires:
  - phase: 01-infrastructure-foundation
    provides: Database types (Database, User table schema) used in IUserRepository
provides:
  - UserId branded value object (nominal typing via unique symbol)
  - Email value object with format validation
  - User entity with private constructor + static factory
  - IUserRepository interface (pure domain contract, Transaction<Database> seam)
affects:
  - 02-user-domain (plan 02 — UserRepository implementation)
  - 03-notification-domain (UserService depends on IUserRepository)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Branded types via unique symbol: `declare const __brand: unique symbol; type Brand<T,B> = T & { [__brand]: B }`"
    - "Namespace+type pattern: export type Foo and export const Foo { create() } in same file"
    - "Private constructor + static factory for entity creation"
    - "IUserRepository uses Transaction<Database> as atomicity seam — minimal infra touch"

key-files:
  created:
    - src/domains/user/UserId.ts
    - src/domains/user/Email.ts
    - src/domains/user/User.ts
    - src/domains/user/IUserRepository.ts
    - src/domains/user/UserId.test.ts
    - src/domains/user/Email.test.ts
  modified: []

key-decisions:
  - "Used Transaction<Database> from kysely in IUserRepository.save() — deliberate minimal infra touch enabling atomicity; no Kysely<Database>, InsertResult, or QueryBuilder types leak into domain"
  - "Branded types via unique symbol pattern chosen over class wrappers — zero runtime overhead, TypeScript nominal typing at compile time"
  - "TDD approach for value objects: wrote failing tests first, then implemented to pass"

patterns-established:
  - "Branded type pattern: use `declare const __brand: unique symbol` + `type Brand<T,B>` for all value objects"
  - "Namespace+type pattern: same name, both `export type Foo` and `export const Foo` — usage is identical to class"
  - "Entity factory: private constructor + static create() that uses crypto.randomUUID()"
  - "Repository interface: only domain types + Transaction<Database> as coordination seam"

requirements-completed:
  - USER-01
  - USER-02
  - USER-03
  - USER-04

# Metrics
duration: 2min
completed: 2026-03-20
---

# Phase 02 Plan 01: User Domain Value Objects and Repository Interface Summary

**Pure domain layer established: UserId and Email branded value objects, User entity (private constructor + static factory), and IUserRepository interface with Transaction<Database> atomicity seam — zero pg-boss imports in domain**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-20T14:04:06Z
- **Completed:** 2026-03-20T14:06:14Z
- **Tasks:** 2
- **Files modified:** 6 (4 source + 2 test files)

## Accomplishments
- UserId branded value object with nominal typing prevents plain string assignment at compile time
- Email branded value object validates format at construction time (throws `Error("Invalid email format")`)
- User entity with private constructor + `static create()` factory, all fields readonly
- IUserRepository interface: `save(user, tx: Transaction<Database>)` + `findAll()` — no pg-boss or Kysely instance types
- TDD RED→GREEN cycle: failing tests committed first, then implementation

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests** - `2d8dbb1` (test)
2. **Task 1 (GREEN): Implement UserId and Email** - `7edb852` (feat)
3. **Task 2: Create User entity and IUserRepository** - `80f5d5f` (feat)

_Note: TDD tasks produce multiple commits (test → feat)_

## Files Created/Modified
- `src/domains/user/UserId.ts` - Branded string value object for user identity
- `src/domains/user/Email.ts` - Branded string value object with format validation
- `src/domains/user/User.ts` - User entity with private constructor and static factory
- `src/domains/user/IUserRepository.ts` - Repository interface: save(tx) + findAll()
- `src/domains/user/UserId.test.ts` - TDD tests for UserId value object
- `src/domains/user/Email.test.ts` - TDD tests for Email validation logic

## Decisions Made
- **Transaction<Database> in IUserRepository**: Chose to import `Transaction<Database>` from kysely as the tx parameter type. This is the minimum infra touch needed for atomicity; the alternative (`tx: unknown`) would lose type safety. No `Kysely<Database>`, `InsertResult`, or `SelectQueryBuilder` types appear in the domain.
- **Branded types over classes**: Unique symbol branding gives TypeScript nominal typing with zero runtime overhead. Classes would add unnecessary overhead and a `.value` accessor — the branded string IS the string.
- **TDD for value objects**: Email validation logic is testable behavior with clear inputs/outputs — ideal TDD candidate. Tests serve as living documentation of the validation contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Domain contracts established; plan 02 can implement `UserRepository` against `IUserRepository` without ambiguity
- `Transaction<Database>` seam in interface enables UserService to control transaction lifetime (atomic write + event publish)
- All 7 unit tests passing; domain layer has zero pg-boss or Kysely instance imports

## Self-Check

- [x] `src/domains/user/UserId.ts` exists
- [x] `src/domains/user/Email.ts` exists
- [x] `src/domains/user/User.ts` exists
- [x] `src/domains/user/IUserRepository.ts` exists
- [x] Commits 2d8dbb1, 7edb852, 80f5d5f present in git log
- [x] `bun test src/domains/user/` → 7 pass, 0 fail
- [x] No pg-boss or Kysely instance types in domain layer

## Self-Check: PASSED

---
*Phase: 02-user-domain*
*Completed: 2026-03-20*

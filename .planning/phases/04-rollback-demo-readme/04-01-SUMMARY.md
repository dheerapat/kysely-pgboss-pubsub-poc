---
phase: 04-rollback-demo-readme
plan: "01"
subsystem: api
tags: [elysia, postgres, pg-boss, kysely, unique-violation]

requires:
  - phase: 03-http-api
    provides: POST /users route and UserService.register() with atomic transaction

provides:
  - 409 HTTP response for duplicate email (unique violation code 23505)
  - README.md documenting the dual-write problem, atomic transaction solution, folder structure, and curl commands

affects: []

tech-stack:
  added: []
  patterns:
    - "Catch Postgres error code 23505 at HTTP layer, return 409 with structured error"
    - "Re-throw unknown errors to preserve default error handling"

key-files:
  created:
    - README.md
  modified:
    - src/index.ts

key-decisions:
  - "Check err.code === '23505' directly on the thrown error object — no need for a custom error class"
  - "Used container name 'postgres-db' from docker-compose.yaml in the psql verification command"

patterns-established:
  - "Unique violation guard: wrap service call in try/catch, check code === '23505', return 409, re-throw all else"

requirements-completed: [HTTP-04, DEMO-02]

duration: 8min
completed: 2026-03-20
---

# Phase 4: Rollback Demo + README Summary

**Duplicate email returns HTTP 409 with atomicity proof via 23505 catch, and README documents the dual-write problem, KyselyAdapter pattern, folder structure, and annotated curl demo**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-20T14:33:00Z
- **Completed:** 2026-03-20T14:41:44Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- POST /users now returns HTTP 409 `{ "error": "Email already registered" }` on duplicate email (Postgres code 23505)
- README.md fully documents the thesis, folder structure, happy-path and rollback demo with curl commands
- All 9 existing tests pass; TypeScript compiles clean

## Files Created/Modified
- `src/index.ts` - Added try/catch around userService.register() catching code 23505 → 409
- `README.md` - New: pattern thesis, KyselyAdapter explanation, folder structure, curl demos, psql verification

## Decisions Made
- Checked `err.code === "23505"` directly on the thrown object rather than wrapping in a domain error class — sufficient for a POC
- Used the actual container name `postgres-db` from docker-compose.yaml in the psql verification command

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- POC is complete. All four phases delivered.
- The README provides everything needed to run the demo end-to-end.

---
*Phase: 04-rollback-demo-readme*
*Completed: 2026-03-20*

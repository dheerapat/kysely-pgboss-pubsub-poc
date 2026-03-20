---
phase: 03-notification-domain-http-api
plan: "02"
subsystem: api
tags: [elysia, bun, http, pg-boss, domain-events, composition-root]

# Dependency graph
requires:
  - phase: 03-01
    provides: NotificationService with handleUserRegistered matching IEventBus handler signature
  - phase: 02-user-domain
    provides: UserService.register(), UserRepository.findAll(), PgBossEventBus.subscribe()
provides:
  - Elysia HTTP server on PORT (default 3000) with GET /users and POST /users
  - NotificationService registered as pg-boss worker before server start
  - Full end-to-end composition root (schema → boss → eventBus → services → worker → HTTP)
affects: [04-rollback-demo-readme]

# Tech tracking
tech-stack:
  added: [elysia@1.4.28]
  patterns: [worker-before-listen ordering, set.status for HTTP 201, bracket-notation env var access, optional-chain server stop]

key-files:
  created: []
  modified:
    - src/index.ts
    - package.json
    - bun.lock

key-decisions:
  - "Worker subscription registered BEFORE .listen() — ensures no HTTP requests arrive before worker is ready"
  - "Body cast as { email: string; name: string } — acceptable for POC, no schema validation needed"
  - "set.status = 201 — Elysia pattern for HTTP 201 on POST /users"
  - "process.env[\"PORT\"] bracket notation — satisfies strict TS no-string-literal-access rule"

patterns-established:
  - "Composition root ordering: schema → boss → eventBus → repos → services → workers → HTTP server"
  - "Graceful shutdown: app.server?.stop() → boss.stop() → pool.end() → process.exit(0)"

requirements-completed: [NOTIF-02, HTTP-01, HTTP-02, HTTP-03, DEMO-01]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 03 Plan 02: Elysia HTTP Server + pg-boss Worker Wiring Summary

**Elysia HTTP server with GET /users and POST /users routes wired to existing domain services, NotificationService registered as pg-boss worker before server start — completing full end-to-end transactional flow**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-20T14:29:00Z
- **Completed:** 2026-03-20T14:34:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- Installed elysia@1.4.28 and wired full composition root in src/index.ts
- NotificationService subscribed to `user.registered` queue BEFORE `.listen()` — ensures worker ready before requests
- POST /users: calls `userService.register(email, name)`, returns `{ userId }` with HTTP 201
- GET /users: calls `userRepo.findAll()`, returns array of all persisted users
- Graceful SIGINT handler: stops Elysia server, pg-boss boss, and pg pool cleanly
- TypeScript compiles clean (`bun build` exits 0), all 9 tests pass (no regressions)

## Task Commits

Each task was committed atomically:

1. **Plan 03-01 RED: Failing test** - `bd7f566` (test)
2. **Plan 03-01 GREEN: NotificationService** - `c8a992e` (feat)
3. **Task 1: Elysia + composition root** - `b28d5de` (feat)

## Files Created/Modified
- `src/index.ts` - Full composition root: schema → boss → eventBus → UserService/UserRepository → NotificationService worker → Elysia HTTP server
- `package.json` - Added elysia@^1.4.28 dependency
- `bun.lock` - Lockfile updated with elysia and its 17 transitive packages

## Decisions Made
- Worker subscription before `.listen()`: ensures no race condition where HTTP request arrives before pg-boss worker is registered
- Body cast `as { email: string; name: string }`: POC-appropriate, avoids schema validation overhead
- `set.status = 201`: Elysia's mechanism for setting HTTP status codes in route handlers
- `process.env["PORT"]` bracket notation: strict TypeScript compliance (no implicit any string indexing)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — bun build, bun test, and grep verifications all passed on first attempt.

## User Setup Required

None - no external service configuration required. Database and pg-boss configured via existing env vars from Phase 1.

## Next Phase Readiness
- Full POC wiring complete: HTTP request → UserService (atomic tx: INSERT + pg-boss job in same tx) → committed → pg-boss worker fires → NotificationService logs
- Phase 4 (Rollback Demo + README) can now demonstrate the full flow with curl commands
- Server starts with `bun run src/index.ts` (requires DATABASE_URL env var from Phase 1)

---
*Phase: 03-notification-domain-http-api*
*Completed: 2026-03-20*

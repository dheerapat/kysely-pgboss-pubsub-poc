---
phase: 08-plugin-extraction
plan: "02"
subsystem: infra

tags: [elysia, pg-boss, typescript, dependency-injection, plugin, event-bus]

requires:
  - phase: 08-01
    provides: "servicesPlugin.ts — Elysia plugin decorating all wired services onto context"
provides:
  - "src/plugins/workersPlugin.ts — async factory that registers all eventBus subscriptions (notification + audit)"
  - "src/plugins/userRoutesPlugin.ts — factory returning Elysia plugin with /users GET and POST handlers using context injection"
affects: [phase-09]

tech-stack:
  added: []
  patterns:
    - "Worker subscription encapsulation — all eventBus.subscribe() calls in one plugin, caller awaits before listen()"
    - "Route factory accepting servicesPlugin instance — TypeScript infers context types from plugin return type"

key-files:
  created:
    - src/plugins/workersPlugin.ts
    - src/plugins/userRoutesPlugin.ts
  modified: []

key-decisions:
  - "createWorkersPlugin takes service instances as args (not .use(servicesPlugin)) — subscribe() is async, must be awaited before returning plugin"
  - "createUserRoutesPlugin takes servicesPlugin instance and calls .use(services) internally — TypeScript infers context property types via Awaited<ReturnType<typeof createServicesPlugin>>"
  - "index.ts left unmodified — Phase 9's job to compose all three plugins into new slim composition root"

patterns-established:
  - "Worker plugin pattern: async factory accepting service instances, await all subscriptions, return empty Elysia plugin"
  - "Route plugin pattern: sync factory accepting servicesPlugin instance, .use(services) for typed context, define routes with destructured context"

requirements-completed:
  - PLUG-02
  - PLUG-03

duration: 10min
completed: 2026-03-21
---

# Phase 08 Plan 02: workersPlugin.ts + userRoutesPlugin.ts Summary

**Two Elysia plugin factories extracted from index.ts — subscription wiring in workersPlugin, typed route handlers in userRoutesPlugin, zero closures**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-21T16:33:21Z
- **Completed:** 2026-03-21T16:43:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/plugins/workersPlugin.ts` with both `eventBus.subscribe()` calls (notification + audit) extracted verbatim from `index.ts`
- Created `src/plugins/userRoutesPlugin.ts` with `/users` GET and POST handlers using context destructuring (`{ userRepo }`, `{ userService }`) — not closure variables
- TypeScript strict mode clean across all three plugin files — TYPE-01 fully satisfied

## Task Commits

1. **Task 1: Create src/plugins/workersPlugin.ts** - `e0aac7d` (feat)
2. **Task 2: Create src/plugins/userRoutesPlugin.ts** - `afcc615` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/plugins/workersPlugin.ts` — async factory `createWorkersPlugin(eventBus, notificationService, auditService)` that awaits both subscriptions before returning an empty Elysia plugin
- `src/plugins/userRoutesPlugin.ts` — sync factory `createUserRoutesPlugin(services)` that `.use(services)` for typed context and defines `/users` GET and POST routes

## Decisions Made

- **createWorkersPlugin takes service instances as arguments, not `.use(servicesPlugin)`:** The subscribe() calls are async and must all complete before the server starts. Accepting services as constructor args allows the caller (index.ts or future composition root) to control boot ordering explicitly.
- **createUserRoutesPlugin takes servicesPlugin instance and calls `.use(services)` internally:** This is the cleanest way to get TypeScript to infer context types from the servicesPlugin return type without any explicit type annotations on route handler parameters.
- **`Awaited<ReturnType<typeof createServicesPlugin>>`** as the parameter type: This ties the route plugin's type directly to the actual plugin instance type, ensuring TYPE-01 holds transitively.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three plugins (`servicesPlugin`, `workersPlugin`, `userRoutesPlugin`) are complete
- Phase 9 (Composition Root) can now create `src/index.ts` v2 that uses all three plugins and eliminates the current inline wiring
- No blockers

---
*Phase: 08-plugin-extraction*
*Completed: 2026-03-21*

## Self-Check: PASSED
- `src/plugins/workersPlugin.ts` exists ✓
- `src/plugins/userRoutesPlugin.ts` exists ✓
- Both `await eventBus.subscribe()` calls present in workersPlugin (notification + audit) ✓
- Routes use context destructuring, not closure (`{ userRepo }`, `{ userService }`) ✓
- 23505 duplicate-email error handling preserved ✓
- `bun run tsc --noEmit` exits 0 ✓
- No `any` type casts in any plugin file ✓
- `src/index.ts` not modified ✓
- git commits `e0aac7d`, `afcc615` present ✓

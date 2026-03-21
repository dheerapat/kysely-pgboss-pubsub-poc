# Roadmap: kysely-pgboss-pubsub-poc

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-03-21)
- ✅ **v1.1 pg-boss Native Pub/Sub + Fan-Out** — Phases 5-7 (shipped 2026-03-21)
- 🚧 **v1.2 Elysia Decorate Refactor** — Phases 8-9 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-03-21</summary>

- [x] Phase 1: Foundation (2/2 plans) — completed 2026-03-21
- [x] Phase 2: Domain Layer (2/2 plans) — completed 2026-03-21
- [x] Phase 3: Application Logic (3/3 plans) — completed 2026-03-21
- [x] Phase 4: HTTP + Demo (2/2 plans) — completed 2026-03-21

Archive: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 pg-boss Native Pub/Sub + Fan-Out (Phases 5-7) — SHIPPED 2026-03-21</summary>

- [x] Phase 5: Boot Infrastructure & Interface Contract (2/2 plans) — completed 2026-03-21
- [x] Phase 6: PgBossEventBus Migration + Fan-Out Wiring (3/3 plans) — completed 2026-03-21
- [x] Phase 7: Documentation & Verification (2/2 plans) — completed 2026-03-21

Archive: `.planning/milestones/v1.1-ROADMAP.md`

</details>

### 🚧 v1.2 Elysia Decorate Refactor (In Progress)

**Milestone Goal:** Refactor `src/index.ts` from a monolithic wiring file into a clean composition root using Elysia's `decorate` pattern — zero behavioral changes.

- [ ] **Phase 8: Plugin Extraction** — Create servicesPlugin, workersPlugin, and userRoutesPlugin as standalone Elysia plugins with full type safety
- [ ] **Phase 9: Composition Root** — Slim index.ts to a pure composition root that only composes plugins and starts the server

## Phase Details

### Phase 8: Plugin Extraction
**Goal**: Three focused Elysia plugins exist — one decorates all wired dependencies onto context, one registers all event bus subscriptions, one encapsulates all route handlers — each testable and readable in isolation
**Depends on**: Phase 7 (v1.1 complete)
**Requirements**: PLUG-01, PLUG-02, PLUG-03, TYPE-01
**Success Criteria** (what must be TRUE):
  1. A `servicesPlugin` file exists and calls `.decorate()` for every wired dependency (pool, boss, eventBus, userRepo, userService, notificationService, auditService) — readable at a glance
  2. A `workersPlugin` file exists that contains all `eventBus.subscribe()` calls previously in `index.ts` — no subscription wiring lives outside it
  3. A `userRoutesPlugin` file exists with `/users` GET and POST handlers that reference services via `context` properties, not closure over outer variables
  4. TypeScript infers decorated service types in route handlers with no `any` casts — the compiler rejects an incorrect context property access
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Create servicesPlugin (decorates all wired deps onto context, TYPE-01 satisfied)
- [x] 08-02-PLAN.md — Create workersPlugin + userRoutesPlugin (subscriptions + typed route handlers)

### Phase 9: Composition Root
**Goal**: `src/index.ts` is a pure composition root — it imports and composes the three plugins, enforces correct boot order, and starts the server; zero instantiation or subscription wiring lives inline
**Depends on**: Phase 8
**Requirements**: ROOT-01, ROOT-02, ROOT-03
**Success Criteria** (what must be TRUE):
  1. `src/index.ts` contains no `new Service()` or `new Repository()` calls — all instantiation lives in `servicesPlugin`
  2. `src/index.ts` contains no inline `await eventBus.subscribe()` calls — all subscription setup lives in `workersPlugin`
  3. Boot order is preserved: workersPlugin is registered and awaited before `app.listen()` is called
  4. SIGINT handler in `index.ts` still stops boss and pool cleanly — graceful shutdown works identically to pre-refactor
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 2/2 | Complete | 2026-03-21 |
| 2. Domain Layer | v1.0 | 2/2 | Complete | 2026-03-21 |
| 3. Application Logic | v1.0 | 3/3 | Complete | 2026-03-21 |
| 4. HTTP + Demo | v1.0 | 2/2 | Complete | 2026-03-21 |
| 5. Boot Infrastructure & Interface Contract | v1.1 | 2/2 | Complete | 2026-03-21 |
| 6. PgBossEventBus Migration + Fan-Out Wiring | v1.1 | 3/3 | Complete | 2026-03-21 |
| 7. Documentation & Verification | v1.1 | 2/2 | Complete | 2026-03-21 |
| 8. Plugin Extraction | v1.2 | 0/TBD | Not started | - |
| 9. Composition Root | v1.2 | 0/TBD | Not started | - |

---

*Last updated: 2026-03-21 — v1.2 roadmap created*

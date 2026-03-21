---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: pg-boss Native Pub/Sub + Fan-Out
status: ready_to_plan
last_updated: "2026-03-21T12:30:00.000Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Domain writes and domain event publishing are atomic — if the transaction rolls back, the event is never queued.
**Current focus:** Phase 5 — Boot Infrastructure & Interface Contract

## Current Position

Phase: 5 of 7 (Boot Infrastructure & Interface Contract)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-03-21 — v1.1 roadmap created; Phases 5-7 defined

Progress: [████████░░░░░░] 0% of v1.1 (v1.0 fully shipped)

## Previous Milestone: v1.0 MVP — Shipped 2026-03-21

| Phase | Name | Status | Plans | Progress |
|-------|------|--------|-------|----------|
| 1 | Infrastructure Foundation | ✓ Complete | 4/4 | 100% |
| 2 | User Domain | ✓ Complete | 2/2 | 100% |
| 3 | Notification Domain + HTTP API | ✓ Complete | 2/2 | 100% |
| 4 | Rollback Demo + README | ✓ Complete | 1/1 | 100% |

Archived to `.planning/milestones/v1.0-ROADMAP.md`.

## Accumulated Context

### Decisions

- [v1.1 research]: `subscriberName` must be **required** in `IEventBus.subscribe()` — optional causes silent fan-out breakage (two subscribers derive same queue name)
- [v1.1 research]: Boot order enforced: `start → createQueue → subscribe → work → listen` — FK constraint on `pgboss.subscription` makes this non-optional
- [v1.1 research]: `boss.publish()` silently creates zero jobs if no subscriptions registered — subscriptions must complete before `app.listen()`
- [v1.1 research]: `KNOWN_QUEUES` removed from `boss.ts`; queue lifecycle moves entirely into `PgBossEventBus.subscribe()`

### Pending Todos

None yet.

### Blockers/Concerns

- **Old v1.0 dev data:** Docker volumes may have stale jobs in the old `"user.registered"` queue. Run `docker compose down -v` before first v1.1 test run.

## Log

- 2026-03-21: v1.0 milestone complete — all requirements shipped
- 2026-03-21: v1.1 milestone started — migrating to pg-boss native pub/sub + fan-out
- 2026-03-21: v1.1 roadmap created — Phases 5-7 defined; 12/12 requirements mapped

## Session Continuity

Last session: 2026-03-21
Stopped at: v1.1 roadmap written (ROADMAP.md + STATE.md created, REQUIREMENTS.md traceability finalized)
Resume file: None

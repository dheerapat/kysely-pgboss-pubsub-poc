---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: pg-boss Native Pub/Sub + Fan-Out
status: unknown
stopped_at: 07-02 Task 1 complete — awaiting human verify checkpoint for VERI-01
last_updated: "2026-03-21T15:04:27.623Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 7
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Domain writes and domain event publishing are atomic — if the transaction rolls back, the event is never queued.
**Current focus:** Phase 06 — pgbosseventbus-migration-fan-out-wiring

## Current Position

Phase: 7
Plan: Not started

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
- [Phase 05-01]: subscriberName is REQUIRED (not optional) in IEventBus.subscribe() — optional causes silent fan-out breakage where two subscribers derive same queue name
- [Phase 05-01]: Queue lifecycle (createQueue, subscribe, work) moves entirely into PgBossEventBus.subscribe() — boss.ts is now a bare PgBoss factory
- [Phase 05-02]: Queue name derivation lives inside PgBossEventBus.subscribe() — callers pass subscriberName, never queue names directly
- [Phase 05-02]: boss.createQueue(queueName) called before boss.work(queueName) inside subscribe() — required by pg-boss FK constraint on subscription table
- [Phase 07]: VERI-02: README 'Pub/Sub Fan-Out (v1.1)' section added covering pub/sub vs queue-based approach, pgboss.subscription table role, fan-out mechanism, and boot sequence ordering rationale
- [Phase 07]: VERI-03: PgBossEventBus inline comment added at boss.publish() call site documenting partial-transaction semantics: subscription lookup = global pool; job INSERTs = opts.db transaction
- [Phase 07]: VERI-01: Rollback regression verified live — HTTP 409 + zero new jobs in both notification.user.registered and audit.user.registered after duplicate email attempt

### Pending Todos

None yet.

### Blockers/Concerns

- **Old v1.0 dev data:** Docker volumes may have stale jobs in the old `"user.registered"` queue. Run `docker compose down -v` before first v1.1 test run.

## Log

- 2026-03-21: v1.0 milestone complete — all requirements shipped
- 2026-03-21: v1.1 milestone started — migrating to pg-boss native pub/sub + fan-out
- 2026-03-21: v1.1 roadmap created — Phases 5-7 defined; 12/12 requirements mapped

## Session Continuity

Last session: 2026-03-21T15:04:27.620Z
Stopped at: 07-02 Task 1 complete — awaiting human verify checkpoint for VERI-01
Resume file: None

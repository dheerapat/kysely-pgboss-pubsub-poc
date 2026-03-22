---
phase: "07"
plan: "01"
subsystem: documentation
tags: [readme, jsdoc, pub-sub, fan-out, veri-02, veri-03]
dependency_graph:
  requires: [06-03-SUMMARY.md]
  provides: [README pub/sub fan-out section, PgBossEventBus partial-transaction inline comment]
  affects: [README.md, src/infrastructure/events/PgBossEventBus.ts]
tech_stack:
  added: []
  patterns: [JSDoc partial-transaction semantics, pub/sub documentation pattern]
key_files:
  created: []
  modified:
    - README.md
    - src/infrastructure/events/PgBossEventBus.ts
decisions:
  - "README section 'Pub/Sub Fan-Out (v1.1)' added after 'The Core Thesis' covering all four required topics"
  - "Inline comment added at publish() call site for call-site-level clarity (supplements class JSDoc)"
metrics:
  duration: "2m 25s"
  completed: "2026-03-21T15:01:38Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 7 Plan 01: Documentation — Pub/Sub Fan-Out README + VERI-03 JSDoc Summary

**One-liner:** Added v1.1 pub/sub fan-out README section (four topics: approach, subscription table, mechanism, boot order) and inline JSDoc comment at `boss.publish()` call site documenting partial-transaction semantics.

## What Was Built

### Task 1: Update README with v1.1 pub/sub documentation

Updated `README.md` to document the v1.1 fan-out model. Added `## Pub/Sub Fan-Out (v1.1)` section immediately after `## The Core Thesis` containing:

1. **Pub/Sub vs Queue-Based Approach:** Explains `boss.send()` (v1.0 point-to-point, publisher knows consumer queues) vs `boss.publish()` (v1.1 pub/sub broadcast, publisher only names event; pg-boss resolves targets from `pgboss.subscription`)
2. **pgboss.subscription Table Role:** Table shown as routing registry with both subscriber rows; explains how `boss.publish()` queries this table to fan out
3. **Fan-Out Mechanism:** 4-step sequence with code illustration showing both INSERTs via `tx` and rollback guarantee
4. **Boot Sequence Ordering Rationale:** FK constraint on queue names + silent zero jobs = ALL subscriptions must complete before `app.listen()`

Also updated:
- Startup logs → both NotificationService and AuditService subscription steps
- Happy-path demo logs → both `[NotificationService]` and `[AuditService]` lines
- Rollback demo SQL → queries both `notification.user.registered` and `audit.user.registered`
- Folder structure → added `audit/AuditService.ts` entry
- Rollback Demo intro → reworded to mention "all pending pg-boss job INSERTs" and "either fan-out queue"

**Commit:** `3a1bfba`

### Task 2: Verify and enhance VERI-03 partial-transaction JSDoc

Verified the class-level JSDoc 3-bullet block was already present and correct:
```
* Partial-transaction semantics of publish():
* - The subscription lookup (SELECT FROM pgboss.subscription) always runs on the global pg-boss pool.
* - Job INSERTs for each subscribed queue run through opts.db (the active Kysely transaction) when provided.
* - Result: if the enclosing transaction rolls back, ALL fan-out job INSERTs are rolled back atomically.
```

Added inline comment at the call site immediately before `await this.boss.publish(...)`:
```typescript
// Subscription lookup on global pool (non-transactional); job INSERTs via opts.db (transactional)
```

**Commit:** `a21bbe4`

## Verification Results

```
grep -c "pgboss.subscription" README.md  → 7   ✓ (>= 2 required)
grep "Pub/Sub Fan-Out" README.md         → ## Pub/Sub Fan-Out (v1.1)  ✓
grep -ic "subscription lookup" PgBossEventBus.ts  → 2 (class JSDoc + inline)  ✓
grep "global pool" PgBossEventBus.ts     → found  ✓
bunx tsc --noEmit                        → exit 0  ✓
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `README.md` exists and modified: FOUND ✓
- `src/infrastructure/events/PgBossEventBus.ts` exists and modified: FOUND ✓
- Commit `3a1bfba` (README): FOUND ✓
- Commit `a21bbe4` (PgBossEventBus): FOUND ✓

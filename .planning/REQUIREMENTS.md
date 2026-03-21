# Requirements: kysely-pgboss-pubsub-poc

**Defined:** 2026-03-21
**Milestone:** v1.1 pg-boss Native Pub/Sub + Fan-Out
**Core Value:** Domain writes and domain event publishing are atomic — if the transaction rolls back, the event is never queued.

## v1.1 Requirements

### Event Bus Migration

- [ ] **BUS-01**: `PgBossEventBus.publish()` uses `boss.publish()` instead of `boss.send()`
- [ ] **BUS-02**: `PgBossEventBus.subscribe()` performs 3-step setup: `createQueue + boss.subscribe + boss.work` using derived subscriber queue name
- [x] **BUS-03**: `IEventBus.subscribe()` requires a `subscriberName: string` parameter
- [x] **BUS-04**: Queue naming convention is encapsulated in `PgBossEventBus` — domain code remains pg-boss-unaware

### Boot Infrastructure

- [x] **BOOT-01**: `KNOWN_QUEUES` is removed from `boss.ts`; queue lifecycle moves to `PgBossEventBus.subscribe()`
- [x] **BOOT-02**: Boot sequence enforces create → subscribe → work → listen ordering (no events published before subscriptions are registered)
- [x] **BOOT-03**: `boss.on('error', ...)` error handler is preserved after `boss.ts` refactor

### Fan-Out Demo

- [ ] **FOUT-01**: `AuditService` is added as a second independent subscriber for `user.registered`
- [ ] **FOUT-02**: Console logs show the fan-out sequence: one `boss.publish()` → two independent worker fires (NotificationService + AuditService)

### Verification & Docs

- [ ] **VERI-01**: Duplicate email `POST /users` returns HTTP 409 with zero jobs created in both subscriber queues (rollback regression)
- [ ] **VERI-02**: README documents the pub/sub model, subscription table role, fan-out mechanism, and boot sequence rationale
- [ ] **VERI-03**: `PgBossEventBus` has a comment documenting `{ db }` partial-transaction semantics (subscription lookup uses pool; job INSERTs use transaction)

## Future Requirements

### Multi-Event Pub/Sub

- **EVT-01**: Second event type (e.g. `user.deactivated`) to show multi-event pub/sub support
- **EVT-02**: Dead letter queue / retry configuration visible in demo

### Extended Fan-Out

- **FOUT-03**: Third subscriber (metrics/counter) for more dramatic fan-out proof
- **FOUT-04**: `Order` domain for a more complex cross-domain pub/sub flow

## Out of Scope

| Feature | Reason |
|---------|--------|
| Second event type (`user.deactivated`) | Focused milestone — one event with two subscribers is clearer than two events |
| pg-boss version upgrade | 12.5.4 already has all required pub/sub APIs; no breaking changes in 12.14.0 |
| Dead letter queue demo | Separate concern; failure visibility is v2+ |
| Event replay / history | pg-boss is a job queue, not an event store — by design |
| `@pg-boss/dashboard` | Useful for teaching but not essential to prove fan-out |
| Authentication/authorization | Not relevant to pub/sub pattern |
| Real email sending | Notification handler logs; sending hides the pattern |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUS-01 | Phase 5 | Pending |
| BUS-02 | Phase 5 | Pending |
| BUS-03 | Phase 5 | Complete |
| BUS-04 | Phase 5 | Complete |
| BOOT-01 | Phase 5 | Complete |
| BOOT-02 | Phase 5 | Complete |
| BOOT-03 | Phase 5 | Complete |
| FOUT-01 | Phase 6 | Pending |
| FOUT-02 | Phase 6 | Pending |
| VERI-01 | Phase 7 | Pending |
| VERI-02 | Phase 7 | Pending |
| VERI-03 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after initial definition*

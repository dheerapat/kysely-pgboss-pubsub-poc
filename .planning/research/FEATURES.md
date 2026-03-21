# Feature Research

**Domain:** pg-boss native pub/sub + fan-out POC (v1.1 milestone)
**Researched:** 2026-03-21
**Confidence:** HIGH — sourced directly from pg-boss v12.5.4 source code in node_modules

---

## How pg-boss Pub/Sub Fan-Out Works

Understanding the mechanism is prerequisite to understanding the feature scope.

### The Pub/Sub Data Model (from pg-boss SQL schema)

pg-boss maintains a `subscription` table:

```sql
CREATE TABLE pgboss.subscription (
  event text not null,
  name  text not null REFERENCES pgboss.queue ON DELETE CASCADE,
  PRIMARY KEY (event, name)
)
```

- `event` = the logical event name (e.g. `"user.registered"`)
- `name`  = the physical queue name (e.g. `"notification.user.registered"`)
- Each `(event, queue)` pair is one subscriber row

**Fan-out mechanism** (from `manager.js` lines 215–219):

```js
async publish(event, data, options) {
  const sql = plans.getQueuesForEvent(this.config.schema);
  const { rows } = await this.db.executeSql(sql, [event]);
  await Promise.allSettled(rows.map(({ name }) => this.send(name, data, options)));
}
```

`publish()` queries the subscription table → gets all queues for the event → calls `send()` once per queue. Each subscriber queue gets its own independent job row. This is pure database fan-out: **one event → N independent jobs, one per subscriber queue**.

### The Three-Step Pattern for Each Subscriber

```
1. boss.createQueue("notification.user.registered")      → create physical queue
2. boss.subscribe("user.registered",
                  "notification.user.registered")        → register (event, queue) in subscription table
3. boss.work("notification.user.registered", handler)    → poll and process jobs
```

### Transactional Publish Preserved with publish()

`publish()` accepts `options` (type `SendOptions`) which includes `{ db?: IDatabase }`. The options are forwarded to each `send()` call. This means: **transactional publish works identically with `boss.publish()` as it did with `boss.send()`**. If the Kysely transaction rolls back, none of the fan-out job rows are created.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a reader of this POC expects to see demonstrated. Missing any of these = the v1.1 milestone does not prove its stated thesis.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Migrate `PgBossEventBus.publish()` from `boss.send()` to `boss.publish()` | The milestone's stated goal; without it there is no pub/sub | LOW | `publish()` API is identical in signature; only change is method name and the underlying subscription lookup |
| Migrate `PgBossEventBus.subscribe()` from `boss.work()` to `boss.subscribe()` + `boss.work()` | Fan-out requires the event → queue mapping in the subscription table | MEDIUM | Must now: (1) create per-subscriber queue, (2) call `boss.subscribe(event, queueName)`, (3) call `boss.work(queueName, handler)`. Queue naming strategy needed. |
| Add `AuditService` as second subscriber for `user.registered` | Fan-out is the thesis; one subscriber proves nothing about fan-out | LOW | Structurally identical to `NotificationService`; domain logic is just a different console log |
| Both `NotificationService` and `AuditService` handlers fire for each `POST /users` | Proves independent delivery — both queues get a job, both workers fire | LOW | Observable via console logs; no additional infrastructure |
| Preserve `{ db?: IDbClient }` transactional publish option | Core thesis of the POC must survive the migration | LOW | Confirmed in source: `publish()` forwards `options` to each `send()` call. Zero change needed in `UserService`. |
| Update boot sequence: create subscriber queues before `boss.subscribe()` | The `subscription` table has a FK constraint: `name REFERENCES pgboss.queue`. Calling `boss.subscribe()` before `createQueue()` throws a FK violation. | LOW | Queue creation must happen before subscription registration at boot |
| Update README for pub/sub vs queue-based approach and fan-out pattern | POC value is educational; README must explain what changed and why | LOW | Explain event channel vs physical queue, fan-out mechanism, subscription table role |

### Differentiators (Competitive Advantage)

Features that elevate the POC from "it works" to "clearly demonstrates the pattern."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-subscriber queue naming convention | Makes it obvious which queue belongs to which subscriber; aids debugging | LOW | e.g. `"notification.user.registered"`, `"audit.user.registered"` — namespaced by domain |
| Annotated console logs showing fan-out sequence | Reader can see the event publish triggers two separate worker fires | LOW | e.g. `[PgBossEventBus] publish user.registered`, `[NotificationService] received`, `[AuditService] received` |
| `IEventBus.subscribe()` encapsulates queue creation + subscription registration | Domain code (NotificationService, AuditService) stays unaware of pg-boss internals; queue naming is an infrastructure concern | MEDIUM | `PgBossEventBus.subscribe()` must derive queue name from event + handler context and call `createQueue` + `boss.subscribe` internally |
| Rollback regression verification | Proves the atomic transaction thesis holds after the migration | LOW | Duplicate email POST should create 0 jobs; verify via existing rollback demo |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Wildcard event subscriptions (`"user.*"`) | "Subscribe to all user events" feels powerful | pg-boss subscription table does exact-match only; wildcards not supported in v12.5.4 | Explicit per-event subscription calls; one row per `(event, queue)` |
| Single shared queue for all subscribers | Simpler | Breaks fan-out: SKIP LOCKED means only one worker gets each job — competing-consumer pattern, not fan-out | Separate named queue per subscriber (this is exactly how pg-boss subscription table is designed) |
| Removing `boss.work()` after migrating to `boss.subscribe()` | "subscribe() sounds like it handles work too" | `boss.subscribe()` only writes a DB row mapping `(event → queue)`. `boss.work()` is still required to start the polling worker. | Always pair `boss.subscribe(event, queue)` + `boss.work(queue, handler)` |
| Multiple event types (add `user.deactivated`) | More events = more complete demo | Dilutes the fan-out lesson; one event with two subscribers is clearer than two events with one subscriber each | Ship one event type, prove fan-out, defer multi-event to v2 |
| Event replay / history | "Can I see all past events?" | pg-boss is a job queue, not an event store; completed jobs are deleted by retention policy | Explicitly out of scope; document in README |
| Real email / external side effects in AuditService | More "realistic" | Hides the pattern under implementation detail | `console.log` is the right choice for a POC |

---

## Feature Dependencies

```
[boss.subscribe(event, queue)]
    └──requires──> [boss.createQueue(queue)]   (FK constraint on subscription table)
                       └──requires──> [boss.start()]

[boss.work(queue, handler)]
    └──requires──> [boss.createQueue(queue)]   (queue must exist to poll)

[boss.publish(event, data, options)]
    └──requires──> [At least one boss.subscribe(event, queue) row exists]
                   (otherwise publish is a no-op: 0 rows from subscription query)
    └──preserves──> [{ db?: IDbClient } transactional option]
                        └──means──> [UserService.register() unchanged]

[AuditService fan-out]
    └──enhances──> [NotificationService fan-out]   (two subscribers = fan-out proven)

[Per-subscriber queue naming]
    └──enables──> [PgBossEventBus.subscribe() encapsulation]
```

### Dependency Notes

- **`boss.subscribe()` requires `boss.createQueue()`:** The `subscription.name` column has a FK to `pgboss.queue`. Calling `subscribe()` before the queue exists throws a PostgreSQL FK violation. Queue creation must happen first.
- **`boss.publish()` is a no-op without subscriptions:** If no rows exist in the subscription table for the event, `publish()` silently sends 0 jobs. Boot order matters: all subscriptions must be registered before the first publish.
- **`boss.work()` is still required after `boss.subscribe()`:** `subscribe()` only writes a DB row mapping `(event → queue)`. `work()` starts the polling worker. Both are always needed together.
- **`IEventBus` interface is unchanged:** The domain-layer `subscribe(event, handler)` signature stays the same. Queue naming and subscription registration are infrastructure details hidden inside `PgBossEventBus.subscribe()`.

---

## MVP Definition

This is a milestone (v1.1), not a greenfield MVP. The baseline (`PgBossEventBus` with `boss.send()`/`boss.work()`) already exists at v1.0. The MVP for v1.1 is the smallest set of changes that proves fan-out via native pub/sub.

### Launch With (v1.1)

- [x] **Already done (v1.0):** `IEventBus` interface, `PgBossEventBus`, `NotificationService`, `UserService` with transactional publish
- [ ] Migrate `PgBossEventBus.publish()` to `boss.publish()` — core migration, unlocks fan-out
- [ ] Migrate `PgBossEventBus.subscribe()` to `boss.subscribe()` + `boss.work()` — registers event→queue mappings in subscription table
- [ ] Update boot (`boss.ts` / `index.ts`) so queue creation happens before subscription registration — required by FK constraint
- [ ] Add `AuditService` with `handleUserRegistered()` — proves fan-out with 2 subscribers on 1 event
- [ ] Register `AuditService` worker at boot — completes the fan-out wiring
- [ ] Verify rollback still works: duplicate email POST creates 0 jobs via `publish()` + `{ db }` tx
- [ ] Update README — pub/sub model, subscription table, fan-out mechanism

### Add After Validation (v1.x)

- [ ] Dashboard (`@pg-boss/dashboard`) showing subscription table and per-queue job counts — useful for teaching; not essential to prove fan-out
- [ ] Structured JSON logs so fan-out sequence is unambiguous in output

### Future Consideration (v2+)

- [ ] Second event type (`user.deactivated`) — multi-event pub/sub
- [ ] Dead letter queue demo — retry and failure visibility
- [ ] `Order` domain for more complex cross-domain fan-out

---

## Feature Prioritization Matrix

| Feature | POC Value | Implementation Cost | Priority |
|---------|-----------|---------------------|----------|
| `publish()` migration | HIGH — no pub/sub without it | LOW — one method name change | P1 |
| `subscribe()` migration + queue creation | HIGH — required for fan-out | MEDIUM — 3-step setup per subscriber | P1 |
| Boot sequence ordering fix (queues before subscriptions) | HIGH — FK constraint; app won't boot otherwise | LOW — reorder existing calls | P1 |
| `AuditService` (second subscriber) | HIGH — proves fan-out | LOW — mirrors NotificationService | P1 |
| Rollback regression verification | HIGH — core thesis must hold after migration | LOW — manual test with duplicate email | P1 |
| Per-subscriber queue naming convention | MEDIUM — clarity and debuggability | LOW — naming string derivation | P2 |
| Annotated console logs showing fan-out | MEDIUM — reader experience | LOW — add log statements | P2 |
| README update | HIGH — undocumented pattern has no educational value | LOW — prose writing | P1 |

**Priority key:**
- P1: Must have for v1.1 launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Sources

- `node_modules/pg-boss/dist/manager.js` lines 203–219 — `subscribe()`, `unsubscribe()`, `publish()` implementations — **HIGH confidence, authoritative (installed package)**
- `node_modules/pg-boss/dist/plans.js` lines 120–129, 473–493 — subscription table DDL, SQL for subscribe/unsubscribe/getQueuesForEvent — **HIGH confidence, authoritative**
- `node_modules/pg-boss/dist/index.d.ts` lines 35–37 — TypeScript signatures: `subscribe(event, name): Promise<void>`, `publish(event, data?, options?): Promise<void>` — **HIGH confidence, authoritative**
- `node_modules/pg-boss/dist/types.d.ts` — `SendOptions`, `ConnectionOptions` (`db?: IDatabase`) — **HIGH confidence, authoritative**
- `src/infrastructure/events/PgBossEventBus.ts` — existing v1.0 implementation to be migrated — **HIGH confidence, first-party**
- `src/domains/shared/IEventBus.ts` — domain interface that must remain unchanged — **HIGH confidence, first-party**
- `src/infrastructure/events/boss.ts` — boot sequence with `KNOWN_QUEUES`, needs update — **HIGH confidence, first-party**
- pg-boss GitHub README (v12.5.4): "Pub/sub API for fan-out queue relationships" listed in feature summary — **HIGH confidence**

---
*Feature research for: pg-boss native pub/sub + fan-out (v1.1)*
*Researched: 2026-03-21*

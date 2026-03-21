# Pitfalls Research

**Domain:** pg-boss pub/sub fan-out migration (boss.send → boss.publish)
**Researched:** 2026-03-21
**Confidence:** HIGH — sourced from pg-boss v12.5.4 source code + official docs + codebase analysis

---

## Critical Pitfalls

### Pitfall 1: `boss.subscribe()` Requires the Target Queue to Exist First

**What goes wrong:**
`boss.subscribe(event, queueName)` inserts a row into `pgboss.subscription` with a **foreign key constraint** (`name text NOT NULL REFERENCES pgboss.queue ON DELETE CASCADE`). If the queue named by `queueName` does not already exist in `pgboss.queue`, the INSERT fails with a foreign key violation error.

```ts
// WRONG — queue doesn't exist yet, subscribe throws FK violation
await boss.subscribe("user.registered", "notification.user.registered");

// CORRECT — queue created first, then subscribed
await boss.createQueue("notification.user.registered");
await boss.subscribe("user.registered", "notification.user.registered");
```

**Why it happens:**
Developers assume `boss.subscribe()` works like event listeners — attach first, call second. In pg-boss, subscriptions are database rows with referential integrity. The queue is the backing store for jobs that will be dispatched when the event is published.

**How to avoid:**
In `boss.ts`, `createQueue()` must be called for **all subscriber queues** before `boss.subscribe()`. For fan-out with two subscribers (`NotificationService`, `AuditService`), two separate queues need to be created:
```ts
await boss.createQueue("notification.user.registered");
await boss.createQueue("audit.user.registered");
await boss.subscribe("user.registered", "notification.user.registered");
await boss.subscribe("user.registered", "audit.user.registered");
```

**Warning signs:**
- Error: `insert or update on table "subscription" violates foreign key constraint`
- `boss.subscribe()` called before `boss.createQueue()` for the same queue name
- Tests pass in isolation but fail on a fresh database (queues don't persist in-memory)

**Phase to address:**
Phase 1 — Boot sequence refactor. The `createBoss()` function in `boss.ts` must be updated to create subscriber queues and register subscriptions before returning.

---

### Pitfall 2: `boss.publish()` Is Silent When No Subscribers Exist

**What goes wrong:**
`boss.publish(event, data, options)` queries `SELECT name FROM pgboss.subscription WHERE event = $1`, then calls `boss.send()` for each matching queue. If no subscriptions exist yet (because `boss.subscribe()` hasn't been called), `publish()` resolves successfully but **zero jobs are created** — silently.

```ts
// No error. No jobs. No subscribers existed at publish time.
await boss.publish("user.registered", payload);
```

**Why it happens:**
Unlike `boss.send()`, which throws if the queue doesn't exist, `boss.publish()` treats "no subscribers" as a valid state — equivalent to broadcasting on an empty channel. There is no warning, no exception, and no return value (it returns `void`).

**How to avoid:**
Subscriptions MUST be registered (`boss.subscribe()`) before any request can trigger `boss.publish()`. The boot sequence must be:
1. `boss.start()`
2. `boss.createQueue()` for all subscriber queues
3. `boss.subscribe()` for all event-to-queue mappings
4. Start HTTP server

**Warning signs:**
- HTTP server starts before subscriptions are registered
- `boss.publish()` returns without error but workers never fire
- Logs show "tx committed" but no "[NotificationService] Sending welcome email" log
- No rows in `pgboss.subscription` table after boot

**Phase to address:**
Phase 1 — Boot sequence refactor. The HTTP server start (step 6 in `index.ts`) must be gated on subscriptions being registered first.

---

### Pitfall 3: `{ db: IDbClient }` Passes Through to `send()` But NOT to the Subscription Lookup

**What goes wrong:**
The `boss.publish()` implementation does two things:
1. Queries `pgboss.subscription` for subscriber queues using **`this.db`** (the pool)
2. Calls `boss.send(queueName, data, options)` for each subscriber queue, passing `options` (which may include `db`)

The subscription lookup (step 1) always uses the shared connection pool, **never the transaction client**. Only the job INSERT (step 2) uses the transaction if `options.db` is provided.

```ts
// From pg-boss v12.5.4 source — manager.js:215-219
async publish(event, data, options) {
    const sql = plans.getQueuesForEvent(this.config.schema);
    const { rows } = await this.db.executeSql(sql, [event]);       // ← uses pool, NOT options.db
    await Promise.allSettled(rows.map(({ name }) => this.send(name, data, options)));  // ← options.db used here
}
```

**Why it happens:**
Subscriptions are configuration, not transactional data. They're set up at boot and don't change during a request. Reading them outside a transaction is correct behavior. However, developers may assume `{ db }` controls ALL queries inside `publish()`.

**How to avoid:**
This is **not a bug** — it's correct by design. The transactional guarantee still holds: the job INSERT goes into the same transaction as the domain write. The subscription lookup is a read that does not need to be inside the transaction. No code change needed, but the documentation must be accurate:

```ts
// CORRECT — job INSERT is transactional, subscription lookup is not
await this.eventBus.publish(
  "user.registered",
  payload,
  { db: new KyselyAdapter(tx) }  // ensures job INSERT uses tx
);
```

**Warning signs:**
- Assuming `{ db }` makes the entire `publish()` call transactional (it does not)
- Testing with an empty subscription table inside a transaction and expecting `publish()` to see new subscriptions added in the same transaction (it won't)

**Phase to address:**
Phase 1 — Document this clearly in `PgBossEventBus` and in the README. No code change needed, but accuracy matters.

---

### Pitfall 4: Old `KNOWN_QUEUES` Names Collide With New Subscriber Queue Names

**What goes wrong:**
In v1.0, the `KNOWN_QUEUES = ["user.registered"]` creates a queue named `"user.registered"` and `boss.work("user.registered", handler)` polls that exact queue. In v1.1, the pub/sub model introduces subscriber-specific queue names (e.g. `"notification.user.registered"`, `"audit.user.registered"`). If the old `"user.registered"` queue is still created, it now acts as an orphaned queue — no one subscribes to it via `boss.subscribe()`, no one calls `boss.work()` on it, and the event channel `"user.registered"` won't route jobs to it.

**Why it happens:**
Queue naming in send/work vs publish/subscribe is fundamentally different:
- `send()` → queue name IS the event name (`"user.registered"`)
- `publish()` → event name is a channel (`"user.registered"`), queue names are subscriber-specific (`"notification.user.registered"`)

Keeping the old `boss.createQueue("user.registered")` alongside `boss.subscribe("user.registered", "notification.user.registered")` creates an orphaned queue with jobs that will never be processed.

**How to avoid:**
Remove `"user.registered"` from `KNOWN_QUEUES`. Replace with subscriber-specific queue names:
```ts
export const SUBSCRIBER_QUEUES = [
  "notification.user.registered",
  "audit.user.registered",
] as const;
```

Also consider calling `boss.deleteQueue("user.registered")` during migration if jobs from v1.0 are already in the database — or at minimum, drain it before removal.

**Warning signs:**
- `KNOWN_QUEUES` still contains `"user.registered"` after migration
- `boss.work("user.registered", handler)` still being called alongside `boss.subscribe()`
- Old jobs accumulating in `"user.registered"` queue with no workers

**Phase to address:**
Phase 1 — Rename/remove old queue names as part of `boss.ts` refactor.

---

### Pitfall 5: `boss.work()` Still Called on the Event Name Instead of Subscriber Queue Name

**What goes wrong:**
After migrating `PgBossEventBus.subscribe()` to use `boss.subscribe()` + `boss.work()`, developers may call `boss.work()` on the wrong name. If `boss.work("user.registered", handler)` is called instead of `boss.work("notification.user.registered", handler)`, the worker polls the event channel name as a queue. That queue may not exist, or it may be the old v1.0 queue — but either way, jobs published via `boss.publish("user.registered", ...)` land in `"notification.user.registered"`, NOT in `"user.registered"`.

```ts
// WRONG — polls wrong queue after migration
await boss.work("user.registered", handler);

// CORRECT — polls the subscriber-specific queue that publish() routes to
await boss.work("notification.user.registered", handler);
```

**Why it happens:**
The two APIs look similar. In v1.0: `boss.work(eventName)`. In v1.1: `boss.subscribe(eventName, queueName)` + `boss.work(queueName)`. The queue name passed to `boss.work()` must match the queue name passed to `boss.subscribe()`, not the event name.

**How to avoid:**
In `PgBossEventBus.subscribe()`, derive a deterministic subscriber queue name from the event name and subscriber identity:
```ts
async subscribe<K extends keyof DomainEventMap>(
  event: K,
  queueName: string, // e.g. "notification.user.registered"
  handler: (payload: DomainEventMap[K]) => Promise<void>,
): Promise<void> {
  await this.boss.subscribe(event, queueName);
  await this.boss.work(queueName, async ([job]) => {
    if (!job) throw new Error(`No job received for queue: ${queueName}`);
    await handler(job.data as DomainEventMap[K]);
  });
}
```

**Warning signs:**
- `boss.work()` receiving the event name string instead of a subscriber queue name
- Worker registered but never fires (polling wrong queue)
- No error thrown — pg-boss just polls an empty or non-existent queue

**Phase to address:**
Phase 2 — `PgBossEventBus` migration. The `subscribe()` method signature needs to accept a queue name, or use a naming convention to derive one.

---

### Pitfall 6: Boot Sequence Race — HTTP Server Starts Before Subscriptions Are Registered

**What goes wrong:**
If the HTTP server starts accepting requests before `boss.subscribe()` is called, a request arriving during startup could trigger `boss.publish()` with zero subscriptions registered. The event is broadcast, no subscriber queues exist yet, and `boss.publish()` silently creates zero jobs. The event is permanently lost.

```ts
// DANGEROUS ORDERING
await boss.start();
app.listen(PORT);  // ← server up, requests can arrive
await boss.subscribe(event, queue); // ← too late if a request arrived
await boss.work(queue, handler);
```

**Why it happens:**
In v1.0, the old `index.ts` registered `boss.work()` before `.listen()` — but with pub/sub, `boss.subscribe()` must also complete before listen. Developers may forget to include `subscribe()` in the pre-listen boot phase.

**How to avoid:**
The current `index.ts` already registers workers before `.listen()` (step 5 before step 6). Extend this pattern:
```ts
// 1. boss.start()
// 2. boss.createQueue() for all subscriber queues
// 3. boss.subscribe() for all event-to-queue mappings
// 4. boss.work() for all subscriber queues
// 5. app.listen()  ← LAST
```

**Warning signs:**
- `app.listen()` appearing before any `boss.subscribe()` or `boss.work()` calls in boot sequence
- Events fire during high-load startup without any corresponding job creation
- Intermittent missed events in integration tests that hit the server early

**Phase to address:**
Phase 1 — Boot sequence refactor. Make the ordering explicit and document it.

---

### Pitfall 7: `Promise.allSettled()` in `publish()` Swallows Errors Per Subscriber

**What goes wrong:**
`boss.publish()` internally uses `Promise.allSettled()` to send to all subscriber queues. This means if the job INSERT fails for one subscriber (e.g., constraint violation, connection issue), `publish()` resolves successfully — the failure is silently swallowed. Other subscribers receive their jobs normally.

```ts
// From pg-boss v12.5.4 source — manager.js:219
await Promise.allSettled(rows.map(({ name }) => this.send(name, data, options)));
// Individual failures are not re-thrown
```

**Why it happens:**
This is intentional library design for fan-out reliability: a failure to one subscriber should not prevent delivery to others. But from the caller's perspective, `publish()` always resolves even on partial failure.

**How to avoid:**
For this POC, this behavior is acceptable — fan-out delivery is best-effort per subscriber. If partial delivery must be detected, implement a post-publish check by querying `boss.getQueueStats()` for subscriber queues, or subscribe to the `boss.on('error', ...)` event.

**Warning signs:**
- `publish()` resolves but no jobs appear in one subscriber queue
- One subscriber queue has a configuration error (e.g., wrong policy) that causes INSERT failures
- `boss.on('error', ...)` emitting errors that aren't being logged

**Phase to address:**
Phase 1 — Ensure `boss.on('error', console.error)` is already in place (it is, in the existing `createBoss()`). Add logging for clarity.

---

### Pitfall 8: `IEventBus.subscribe()` Signature Doesn't Accommodate Queue Name

**What goes wrong:**
The existing `IEventBus.subscribe(event, handler)` signature has no way to specify which queue the subscriber should use. With pub/sub fan-out, multiple subscribers listen to the same event but need different queue names. If `PgBossEventBus.subscribe()` auto-generates a queue name internally (e.g., using a counter or UUID), the queue name is non-deterministic — different on every boot, leaving orphaned queues in the database.

```ts
// Current interface — no queue name parameter
subscribe<K extends keyof DomainEventMap>(
  event: K,
  handler: (payload: DomainEventMap[K]) => Promise<void>,
): Promise<void>;
```

**Why it happens:**
The v1.0 `subscribe()` mapped directly to `boss.work(event, handler)` — one queue, one worker, event name is the queue name. In v1.1, each subscriber needs its own queue name, but the `IEventBus` interface doesn't expose this.

**How to avoid:**
Two options:
1. **Extend the interface** with an optional `queueName` parameter: `subscribe(event, handler, queueName?)`
2. **Derive the queue name** from a naming convention passed at construction time, e.g., a subscriber identifier prefix

For this POC, option 1 keeps things explicit:
```ts
subscribe<K extends keyof DomainEventMap>(
  event: K,
  handler: (payload: DomainEventMap[K]) => Promise<void>,
  queueName: string,
): Promise<void>;
```

**Warning signs:**
- `boss.subscribe()` called with dynamically generated queue names (`${event}-${Date.now()}`)
- Multiple boots create multiple subscription rows in `pgboss.subscription` for the same event
- Orphaned queues accumulate in `pgboss.queue` table

**Phase to address:**
Phase 2 — `PgBossEventBus` migration. Decide on naming convention and update interface if needed.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep `KNOWN_QUEUES = ["user.registered"]` and just add subscriber queues alongside it | Zero refactor of boss.ts | Orphaned `"user.registered"` queue accumulates unconsumed jobs forever | Never — clean break required |
| Use event name as queue name for single subscriber (`boss.subscribe("user.registered", "user.registered")`) | No interface change, minimal diff | Breaks when second subscriber is added; naming is ambiguous | Only if fan-out is never planned — not applicable here |
| Skip `boss.deleteQueue("user.registered")` after migration | Simpler migration | Old jobs (if any) sit in dead queue; audit becomes confusing | Acceptable if v1.0 was dev-only with no real data |
| Auto-generate queue names in `subscribe()` | No interface change | Non-deterministic, orphaned queues, restart creates new subscriptions | Never in production; acceptable in a one-shot POC only |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `boss.subscribe()` | Called with event name as both args: `boss.subscribe("user.registered", "user.registered")` | Technically works for one subscriber, but ambiguous naming; use `"notification.user.registered"` |
| `boss.publish()` with `{ db }` | Assuming the subscription lookup is also transactional | Subscription lookup uses `this.db` (pool); only job INSERTs use `options.db` |
| `boss.work()` after `boss.subscribe()` | Calling `boss.work(eventName)` instead of `boss.work(queueName)` | Must call `boss.work(queueName)` where `queueName` matches what was passed to `boss.subscribe()` |
| `boss.createQueue()` | Not called for subscriber queues before `boss.subscribe()` | FK constraint requires queue to exist; create queue first, subscribe second |
| Queue cache | `boss.work()` triggers a `getQueueCache()` call that throws if queue doesn't exist | Ensure queue exists before calling `work()` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling interval too low | High CPU / DB query load from workers | Use `pollingIntervalSeconds: 5` or higher for low-frequency events | At scale (many workers, busy DB) |
| Subscriber queues not partitioned | "Noisy neighbor" effect in `pgboss.job` table | For POC scale (< 10K jobs/day), not an issue; for production, use `partition: true` on high-volume queues | Above ~100K jobs/day |
| `Promise.allSettled` in publish hiding slow fan-out | `publish()` resolves fast but one subscriber queue gets stuck | Monitor queue stats; not a startup issue | When subscriber queues have different processing speeds |

---

## "Looks Done But Isn't" Checklist

- [ ] **Subscription registered before server listens:** `boss.subscribe()` called in boot sequence before `app.listen()` — verify ordering in `index.ts`
- [ ] **Subscriber queue created before subscription:** `boss.createQueue("notification.user.registered")` called before `boss.subscribe("user.registered", "notification.user.registered")` — verify in `boss.ts`
- [ ] **Old `KNOWN_QUEUES` cleaned up:** `"user.registered"` removed from `KNOWN_QUEUES`; replaced with subscriber queue names — verify `boss.ts`
- [ ] **`boss.work()` uses queue name, not event name:** Worker registered on `"notification.user.registered"` not `"user.registered"` — verify `PgBossEventBus.subscribe()`
- [ ] **Both subscribers fire on single publish:** `POST /users` triggers logs from both `NotificationService` AND `AuditService` — verify in integration test or manual curl
- [ ] **Transactional rollback still works:** `POST /users` with duplicate email → 409, no jobs in either subscriber queue — verify via `boss.getQueueStats()`
- [ ] **`boss.on('error', ...)` still registered:** Error handler not accidentally removed during refactor — verify in `createBoss()`

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Subscriptions registered after server started (events lost) | LOW | Stop server, fix boot order, restart. Events fired during window are permanently lost — acceptable in dev POC |
| Wrong queue name in `boss.work()` (workers polling wrong queue) | LOW | Fix queue name, restart. Jobs in wrong queue can be manually moved or deleted |
| Orphaned `"user.registered"` queue with unconsumed jobs | LOW | `boss.deleteQueue("user.registered")` or `boss.deleteAllJobs("user.registered")` then `boss.deleteQueue()` |
| `boss.subscribe()` failed due to missing queue (FK error) | LOW | Create the queue, then call `boss.subscribe()` again (it's idempotent via `ON CONFLICT DO UPDATE`) |
| `IEventBus.subscribe()` signature mismatch with AuditService | MEDIUM | Update interface + all call sites; TypeScript compiler will surface all mismatches |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `boss.subscribe()` requires queue to exist first | Phase 1: Boot sequence | `boss.getQueue("notification.user.registered")` returns non-null after boot |
| `publish()` silent with no subscribers | Phase 1: Boot sequence | Subscriptions exist in `pgboss.subscription` before first request |
| `{ db }` only affects job INSERTs, not subscription lookup | Phase 1: Documentation | Comment in `PgBossEventBus.publish()` explains this behavior |
| Old `KNOWN_QUEUES` / old queue name collision | Phase 1: boss.ts refactor | No `"user.registered"` queue exists after migration |
| `boss.work()` on wrong queue name | Phase 2: PgBossEventBus migration | Worker fires on correct queue; verified by both subscriber logs appearing |
| Boot sequence race (server before subscribe) | Phase 1: Boot sequence | `index.ts` has subscriptions registered before `app.listen()` |
| `Promise.allSettled` swallows errors | Phase 1: Error handling | `boss.on('error', ...)` in place; verify both queues get jobs after publish |
| `IEventBus.subscribe()` signature gap | Phase 2: Interface update | TypeScript compiles cleanly with both NotificationService and AuditService wired |

---

## Sources

- **pg-boss v12.5.4 source** (`node_modules/pg-boss/dist/manager.js`, `plans.js`, `index.d.ts`) — HIGH confidence; read directly
- **pg-boss official docs** (`https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/pubsub.md`) — HIGH confidence
- **pg-boss official docs** (`https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/queues.md`) — HIGH confidence
- **Codebase analysis** (`src/infrastructure/events/boss.ts`, `PgBossEventBus.ts`, `src/index.ts`) — HIGH confidence; read directly
- **PROJECT.md v1.1 milestone requirements** — HIGH confidence; canonical source of truth

---
*Pitfalls research for: pg-boss publish/subscribe fan-out migration (v1.0 send→publish, v1.1)*
*Researched: 2026-03-21*

# Stack Research

**Domain:** pg-boss native pub/sub + fan-out migration (v1.1 milestone)
**Researched:** 2026-03-21
**Confidence:** HIGH — all findings verified directly against pg-boss 12.5.4 type declarations
and compiled source in node_modules. No training-data-only claims.

---

## Scope

This document covers only what is **new or changed** for the v1.1 migration from
`boss.send()`/`boss.work()` to `boss.publish()`/`boss.subscribe()`. The existing
stack (Bun, TypeScript strict, Kysely ^0.28.9, pg ^8.16.3, Elysia, Docker Compose)
is validated from v1.0 and is out of scope here.

---

## Stack Decision: No New Packages Required

**The entire migration is achievable with pg-boss 12.5.4 already installed.**
`boss.publish()` and `boss.subscribe()` are present in the installed version.
No upgrades, no additions.

---

## Core Technologies: Changed API Surface Only

### pg-boss 12.5.4 — Pub/Sub Methods

All three methods are available in the installed `pg-boss@12.5.4`.
Verified from `node_modules/pg-boss/dist/index.d.ts` and `manager.js`.

#### `boss.subscribe(event, name): Promise<void>`

Registers a **channel-to-queue binding** in the `pgboss.subscription` table.

```typescript
// Signature (from index.d.ts line 35)
subscribe(event: string, name: string): Promise<void>
```

- `event` — the channel name (e.g. `"user.registered"`)
- `name`  — the **queue name** that will receive jobs when the event is published
- Idempotent: uses `ON CONFLICT DO UPDATE` — safe to call at every boot
- Must be called **after** the target queue exists (queue FK constraint)
- Multiple calls with different `name` values for the same `event` produce fan-out
- No `{ db }` option — always runs on the global pg-boss connection

#### `boss.publish(event, data?, options?): Promise<void>`

Publishes an event to all subscribed queues.

```typescript
// Signature (from index.d.ts line 37)
publish(event: string, data?: object, options?: SendOptions): Promise<void>
```

**Internals (verified from manager.js):**

```
publish(event, data, options)
  → SELECT name FROM pgboss.subscription WHERE event = $1   [uses this.db, global]
  → for each subscribed queue name:
       send(name, data, options)
         → createJob(...)
              extracts `db: wrapper` from options
              uses `wrapper || this.db` for INSERT
```

**Critical: Partial transaction semantics.** The subscription lookup always uses
`this.db` (global pool connection), not the transaction. The job INSERT INTO each
queue uses `options.db` if provided. This means:

- `await boss.publish("user.registered", payload, { db: new KyselyAdapter(tx) })`
  → subscription table read: non-transactional (fine — subscriptions are stable, boot-time data)
  → job inserts for ALL matched queues: transactional (through `tx`)
  → if `tx` rolls back, **all** fan-out job inserts are rolled back atomically

This is correct behavior for the POC. The atomicity guarantee is preserved.

**`SendOptions` is the same type as `boss.send()`:**
```typescript
// From types.d.ts line 88
type SendOptions = JobOptions & QueueOptions & ConnectionOptions
// ConnectionOptions = { db?: IDatabase }
// IDatabase = { executeSql(text, values?): Promise<{ rows: any[] }> }
```

`KyselyAdapter` satisfies `IDatabase` (it implements `executeSql`). No changes needed to `IDbClient` or `KyselyAdapter`.

#### `boss.work(name, handler): Promise<string>` — Unchanged

Worker registration remains `boss.work()`. The `subscribe()` method creates the
channel→queue binding; `work()` still polls the queue. In the pub/sub pattern:

```
boss.subscribe("user.registered", "notification.user.registered")
boss.work("notification.user.registered", handler)

// Fan-out second subscriber:
boss.subscribe("user.registered", "audit.user.registered")
boss.work("audit.user.registered", handler)
```

```typescript
// Signatures (from index.d.ts lines 28-32)
work<ReqData, ResData>(name: string, handler: WorkHandler<ReqData, ResData>): Promise<string>
work<ReqData, ResData>(name: string, options: WorkOptions, handler: WorkHandler<ReqData, ResData>): Promise<string>

// WorkHandler signature (from types.d.ts line 126)
interface WorkHandler<ReqData, ResData = any> {
  (job: Job<ReqData>[]): Promise<ResData>
}
```

The existing `boss.work()` call in `PgBossEventBus.subscribe()` receives `[job]`
(batch array) — the handler already unwraps with `const [job] = jobs`. No change needed.

---

## Queue Naming Convention for Fan-Out

Pub/sub introduces a **two-level naming structure**:

| Level | Name | Example |
|-------|------|---------|
| Channel (event name) | `"<domain>.<event>"` | `"user.registered"` |
| Subscriber queue | `"<subscriberDomain>.<channel>"` | `"notification.user.registered"` |

**Why separate queue names per subscriber?**
- Each subscriber queue holds independent jobs → each subscriber processes at its own pace
- Failed NotificationService job does not block AuditService processing
- `boss.subscribe(event, name)` stores a row in `pgboss.subscription(event, name)`
- When `boss.publish(event)` fires, it finds ALL names for that event and enqueues to each

**Convention:** `"<subscriber>.<event-channel>"` is idiomatic. This avoids confusion
with the event channel name while making the subscriber's queue self-documenting.

---

## Boot Sequence Requirements

The pub/sub boot sequence must follow this order:

```
1. boss.start()                                     // pg-boss schema initialized
2. boss.createQueue("notification.user.registered") // subscriber queue created first
3. boss.createQueue("audit.user.registered")        // second subscriber queue
4. boss.subscribe("user.registered", "notification.user.registered")  // binding
5. boss.subscribe("user.registered", "audit.user.registered")          // fan-out binding
6. boss.work("notification.user.registered", notificationHandler)
7. boss.work("audit.user.registered", auditHandler)
8. server.listen()
```

**Step 2 before step 4** is required: `pgboss.subscription` has a FK reference to
`pgboss.queue`. Calling `subscribe()` before `createQueue()` will throw a FK violation.

**Idempotency**: Both `createQueue()` and `subscribe()` are safe to call on every boot:
- `createQueue()` is wrapped in a lock + `INSERT ... ON CONFLICT DO NOTHING` equivalent
- `subscribe()` uses `ON CONFLICT DO UPDATE` (upsert)

---

## `PgBossEventBus` Migration Map

| v1.0 (queue-based) | v1.1 (pub/sub) |
|-------------------|----------------|
| `boss.send(event, payload, { db })` | `boss.publish(event, payload, { db })` |
| `boss.work(event, handler)` | `boss.work(subscriberQueueName, handler)` |
| `IEventBus.subscribe(event, handler)` | needs `subscriberName` param OR the bus infers it |
| KNOWN_QUEUES `["user.registered"]` | subscriber queues per domain + subscriptions registered |

**Proposed `IEventBus.subscribe()` signature change:**

Option A — Add `subscriberName` to `IEventBus.subscribe()`:
```typescript
subscribe<K extends keyof DomainEventMap>(
  event: K,
  subscriberName: string,  // new
  handler: (payload: DomainEventMap[K]) => Promise<void>
): Promise<void>
```

Option B — Infer subscriber queue name inside `PgBossEventBus` using a counter/registry
(hides complexity, but harder to trace in logs).

**Recommendation:** Option A. The subscriber name is meaningful (it appears in
pg-boss queue monitoring and logs). Explicit is better for a POC whose goal is
to be readable. `IEventBus` is in the domain layer — adding one param is a small
boundary cost for big readability gain.

---

## Version Assessment: Should pg-boss be Upgraded?

**Current:** `pg-boss@12.5.4` (installed)
**Latest:** `pg-boss@12.14.0` (as of 2026-03-21, verified from npm registry)

**Changelog scan** (verified from GitHub releases, 12.5.4 → 12.14.0):

| Version | Change | Impact on this milestone |
|---------|--------|--------------------------|
| 12.7.2 | patch | None |
| 12.8.0 | reinstate `deadLetter` property in job options | None |
| 12.9.0 | allow queued jobs to be marked complete | None |
| 12.10.0 | new `key_strict_fifo` queue policy | None |
| 12.11.x | Job dashboard (separate package) | None |
| 12.12.0 | Heartbeat functionality | None |
| 12.13.0 | Allow `/` in queue and event names | None (not using slashes) |
| 12.14.0 | Proxy support | None |

**Verdict: No upgrade needed.** `boss.publish()`, `boss.subscribe()`, and
`boss.work()` with the `{ db }` option have identical signatures across all v12
minor versions. The installed 12.5.4 has everything required. Upgrading would add
churn with zero functional benefit for this milestone.

---

## What NOT to Add

| Avoid | Why | Instead |
|-------|-----|---------|
| New npm package for pub/sub | pg-boss already has pub/sub built in | Use `boss.publish()`/`boss.subscribe()` |
| pg-boss upgrade | No required features in 12.6–12.14 for this milestone | Stay on 12.5.4 |
| Separate `pgboss.event` table | Doesn't exist in pg-boss — pub/sub uses `pgboss.subscription` | Use `boss.subscribe()` API |
| `boss.publish()` without pre-registered subscriptions | Jobs silently dropped — `getQueuesForEvent` returns 0 rows | Always `boss.subscribe()` first |
| Calling `boss.subscribe()` without `boss.createQueue()` first | FK violation at runtime | `createQueue` → `subscribe` order |
| Using `boss.send()` for pub/sub fan-out | Single queue, not fan-out | `boss.publish()` routes to all subscribers |
| `boss.fetch()` instead of `boss.work()` | Manual polling, loses auto-retry | `boss.work()` is the correct worker API |

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| pg-boss | ^12.5.4 | TypeScript ^5 | Bundled types in `dist/*.d.ts` |
| pg-boss | ^12.5.4 | Bun runtime | Works — uses Node-compatible APIs |
| KyselyAdapter | (local) | pg-boss IDatabase | Structural match: `executeSql(text, values?)` |

---

## Sources

- `node_modules/pg-boss/dist/index.d.ts` — Method signatures for `publish`, `subscribe`, `work`, `send` — **HIGH confidence**
- `node_modules/pg-boss/dist/types.d.ts` — `SendOptions`, `IDatabase`, `WorkHandler` types — **HIGH confidence**
- `node_modules/pg-boss/dist/manager.js` — `publish()` internals: subscription lookup uses `this.db`, job INSERT uses `options.db` — **HIGH confidence**
- `node_modules/pg-boss/dist/plans.js` — SQL for `subscribe()`, `getQueuesForEvent()` — **HIGH confidence**
- `https://github.com/timgit/pg-boss/releases` — Changelog 12.5.4 → 12.14.0, no breaking changes — **HIGH confidence**
- `https://registry.npmjs.org/pg-boss/latest` — Latest version 12.14.0 confirmed — **HIGH confidence**

---
*Stack research for: pg-boss pub/sub + fan-out migration (v1.1)*
*Researched: 2026-03-21*

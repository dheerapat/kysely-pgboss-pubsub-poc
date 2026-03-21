# Architecture Research: pg-boss Pub/Sub Migration + Fan-Out (v1.1)

**Domain:** Event-driven DDD — pg-boss native pub/sub channel → queue fan-out
**Researched:** 2026-03-21
**Confidence:** HIGH — all claims verified directly from pg-boss source in node_modules

---

## Standard Architecture

### System Overview (v1.1 target state)

```
┌──────────────────────────────────────────────────────────────────────┐
│                            HTTP Layer                                │
│   Elysia → POST /users → UserService.register()                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ calls (same as v1.0)
┌──────────────────────────────▼───────────────────────────────────────┐
│                          Domain Layer                                │
│                                                                      │
│  ┌─────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │    User Domain      │  │ Notification     │  │ Audit Domain   │  │
│  │                     │  │ Domain           │  │ (NEW)          │  │
│  │  UserService        │  │                  │  │                │  │
│  │    ├─ tx INSERT      │  │ Notification     │  │ AuditService   │  │
│  │    └─ eventBus       │  │ Service          │  │                │  │
│  │       .publish(      │  │ .handleUser      │  │ .handleUser    │  │
│  │        "user.regis-  │  │  Registered()    │  │  Registered()  │  │
│  │         tered", ...) │  │                  │  │                │  │
│  └─────────────────────┘  └──────────────────┘  └────────────────┘  │
│                                                                      │
│  shared/IEventBus.ts     shared/events.ts    shared/IDbClient.ts    │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ uses (via IEventBus interface)
┌──────────────────▼───────────────────────────────────────────────────┐
│                       Infrastructure Layer                           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  PgBossEventBus (MODIFIED)                                   │   │
│  │                                                              │   │
│  │  publish("user.registered", payload, { db }) →              │   │
│  │    boss.publish("user.registered", payload, { db })          │   │
│  │      → SQL: SELECT name FROM subscription WHERE event=$1     │   │
│  │      → boss.send("notification.user.registered", payload)    │   │
│  │      → boss.send("audit.user.registered", payload)           │   │
│  │                                                              │   │
│  │  subscribe("user.registered", notifHandler) →               │   │
│  │    boss.createQueue("notification.user.registered")          │   │
│  │    boss.subscribe("user.registered",                         │   │
│  │                   "notification.user.registered")            │   │
│  │    boss.work("notification.user.registered", notifHandler)   │   │
│  │                                                              │   │
│  │  subscribe("user.registered", auditHandler) →               │   │
│  │    boss.createQueue("audit.user.registered")                 │   │
│  │    boss.subscribe("user.registered",                         │   │
│  │                   "audit.user.registered")                   │   │
│  │    boss.work("audit.user.registered", auditHandler)          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────┐    ┌───────────────────────────────────┐  │
│  │  boss.ts (MODIFIED)  │    │  Database                         │  │
│  │                      │    │                                   │  │
│  │  KNOWN_QUEUES removed│    │  pgboss.subscription table        │  │
│  │  (queues created by  │    │    event="user.registered"        │  │
│  │   subscribe() calls) │    │    name="notification.user..."    │  │
│  │                      │    │    name="audit.user.registered"   │  │
│  └──────────────────────┘    └───────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | v1.1 Change |
|-----------|----------------|-------------|
| `IEventBus` | Domain contract for publish/subscribe | **No change** — interface signature unchanged |
| `DomainEventMap` | Type registry: event name → payload type | **No change** |
| `IDbClient` | Structural interface for transactional routing | **No change** |
| `PgBossEventBus` | Routes `publish()` to `boss.publish()`, `subscribe()` to `boss.subscribe()` + `boss.work()` | **Modified** — see patterns below |
| `boss.ts` | PgBoss singleton + boot | **Modified** — remove `KNOWN_QUEUES`; queues created in `subscribe()` |
| `NotificationService` | Handle `user.registered`, log welcome email | **No change** |
| `AuditService` | Handle `user.registered`, log audit event | **NEW** — second subscriber |
| `src/index.ts` | Composition root: boot, subscribe, listen | **Modified** — add AuditService subscription |

---

## How pub/sub Fan-Out Works in pg-boss

### The Core Mechanism (verified from pg-boss source)

pg-boss pub/sub uses a `subscription` table:

```sql
-- pgboss.subscription
-- event = the channel name (e.g. "user.registered")
-- name  = the subscriber queue name (e.g. "notification.user.registered")
```

**`boss.subscribe(event, name)`** — registers a mapping in the subscription table:
```sql
INSERT INTO pgboss.subscription (event, name)
VALUES ($1, $2)
ON CONFLICT (event, name) DO UPDATE ...
```

**`boss.publish(event, data, options)`** — fans out to all registered subscriber queues:
```js
// manager.js source:
async publish(event, data, options) {
  const sql = plans.getQueuesForEvent(this.config.schema);
  const { rows } = await this.db.executeSql(sql, [event]);
  await Promise.allSettled(rows.map(({ name }) => this.send(name, data, options)));
}
// getQueuesForEvent SQL:
// SELECT name FROM pgboss.subscription WHERE event = $1
```

**Fan-out result:** One `boss.publish("user.registered", payload)` call → one `boss.send()` per registered subscriber queue → one job row per subscriber queue in PostgreSQL → each subscriber's `boss.work()` worker picks up its own job independently.

### Critical: Queues Must Exist Before publish()

`boss.send()` (called internally by `boss.publish()`) calls `getQueueCache(name)` which throws `Error: Queue ${name} does not exist` if the queue hasn't been created. Subscriber queues **must** be created with `boss.createQueue()` before any `publish()` call fires.

This means: **subscribe before listen** (already the pattern in v1.0 boot sequence).

### Transactional Atomicity Preserved

`boss.publish()` forwards `options` (including `db`) to `boss.send()`. The `db` option routes the INSERT through the active transaction. With two subscribers, this means **two job rows** are inserted in the same transaction — both committed or both rolled back atomically.

```
UserService.register():
  tx.begin()
    INSERT INTO users (...)
    boss.publish("user.registered", payload, { db: KyselyAdapter(tx) })
      → boss.send("notification.user.registered", payload, { db: ... })  ← job row 1 in tx
      → boss.send("audit.user.registered", payload, { db: ... })         ← job row 2 in tx
  tx.commit()  ← all 3 rows committed together, or none
```

---

## Architectural Patterns

### Pattern 1: Channel-Scoped Queue Names

**What:** Each subscriber gets a unique queue name derived from the event channel name plus a subscriber identifier.

**Convention:** `{subscriber}.{event}` — e.g. `notification.user.registered`, `audit.user.registered`

**Why:** pg-boss queues provide exactly-once delivery per queue. If two subscribers shared one queue, only one would receive each job. Unique queue names give each subscriber its own delivery stream.

**Trade-offs:** More queues in the database, but each has clear ownership and can be monitored independently.

**Example:**
```typescript
// In PgBossEventBus.subscribe():
async subscribe<K extends keyof DomainEventMap>(
  event: K,
  handler: (payload: DomainEventMap[K]) => Promise<void>,
  subscriberName: string,  // e.g. "notification", "audit"
): Promise<void> {
  const queueName = `${subscriberName}.${event}`;  // "notification.user.registered"
  await this.boss.createQueue(queueName);
  await this.boss.subscribe(event, queueName);      // register channel → queue mapping
  await this.boss.work(queueName, async ([job]) => {
    if (!job) throw new Error(`No job received for queue: ${queueName}`);
    await handler(job.data as DomainEventMap[K]);
  });
}
```

### Pattern 2: IEventBus Subscribe Signature Extension

**What:** The `IEventBus.subscribe()` method needs a `subscriberName` parameter so `PgBossEventBus` can derive unique queue names. Two options:

**Option A — Extend subscribe signature (recommended):**
```typescript
// IEventBus.ts
subscribe<K extends keyof DomainEventMap>(
  event: K,
  handler: (payload: DomainEventMap[K]) => Promise<void>,
  subscriberName: string,
): Promise<void>;
```

**Option B — Use options object:**
```typescript
subscribe<K extends keyof DomainEventMap>(
  event: K,
  handler: (payload: DomainEventMap[K]) => Promise<void>,
  opts?: { name?: string },
): Promise<void>;
```

**Recommendation:** Option A. The `subscriberName` is **required** for fan-out correctness — it should not be optional. An optional parameter would compile but silently fail if omitted by a second subscriber (queue name collision).

**Trade-off:** This is a breaking change to the `IEventBus` interface. All existing `.subscribe()` call sites need updating. Since there are only 2 call sites in `src/index.ts`, this is low risk.

### Pattern 3: Boot Sequence — Subscribe Before Publish

**What:** All subscriber queues must be created and registered (via `boss.subscribe()`) before any HTTP request can trigger `boss.publish()`.

**When to use:** Always. This is the same constraint as v1.0 (`boss.work()` must be registered before the server starts listening).

**Example (updated boot sequence):**
```typescript
// src/index.ts
async function main() {
  await setupSchema();
  const boss = await createBoss();           // boss.start() — no KNOWN_QUEUES needed
  const eventBus = new PgBossEventBus(boss);

  // Wire domains
  const userRepo = new UserRepository();
  const userService = new UserService(userRepo, eventBus);

  // Register ALL subscribers BEFORE server starts
  const notificationService = new NotificationService();
  await eventBus.subscribe(
    "user.registered",
    (payload) => notificationService.handleUserRegistered(payload),
    "notification",  // → queue: "notification.user.registered"
  );

  const auditService = new AuditService();   // NEW
  await eventBus.subscribe(
    "user.registered",
    (payload) => auditService.handleUserRegistered(payload),
    "audit",         // → queue: "audit.user.registered"
  );

  // THEN start server
  const app = new Elysia().get(...).post(...).listen(PORT);
}
```

---

## Data Flow

### Request Flow (v1.1 — Fan-Out)

```
POST /users { email, name }
    │
    ▼
Elysia router
    │
    ▼
UserService.register(email, name)
    │
    ├─ tx.begin()
    ├─ UserRepository.save(user, tx)          → INSERT INTO users
    ├─ eventBus.publish(                      → boss.publish(
    │    "user.registered", payload,               "user.registered", payload,
    │    { db: KyselyAdapter(tx) })                { db: KyselyAdapter(tx) })
    │                                              │
    │                                              ├─ SELECT name FROM subscription
    │                                              │    WHERE event="user.registered"
    │                                              │    → ["notification.user.registered",
    │                                              │        "audit.user.registered"]
    │                                              │
    │                                              ├─ boss.send("notification.user.registered",
    │                                              │    payload, { db })  → INSERT job row (tx)
    │                                              │
    │                                              └─ boss.send("audit.user.registered",
    │                                                   payload, { db })  → INSERT job row (tx)
    └─ tx.commit()  → 3 rows committed atomically: 1 user + 2 jobs
    │
    ▼
HTTP 201 { userId }

--- Async (pg-boss worker polling) ---

boss.work("notification.user.registered")
    → NotificationService.handleUserRegistered(payload)
    → logs "Sending welcome email to {email}"

boss.work("audit.user.registered")
    → AuditService.handleUserRegistered(payload)       [NEW]
    → logs "Audit: user {userId} registered at {timestamp}"
```

### Key Data Flows

1. **Channel → Subscription table → Queue names:** `boss.publish()` queries `pgboss.subscription` to discover which queues are subscribed to the event channel.

2. **Queue → Worker:** Each `boss.work(queueName)` registers a polling worker that picks up jobs from its dedicated queue. Workers are independent; one can fail without affecting the other.

3. **Transactional propagation:** The `{ db }` option flows from `IEventBus.publish()` → `boss.publish()` → each `boss.send()` call → `createJob()` → uses provided db client's `executeSql()` instead of the pool.

---

## Recommended Project Structure

```
src/
├── domains/
│   ├── shared/
│   │   ├── events.ts          # DomainEventMap — unchanged
│   │   ├── IEventBus.ts       # MODIFIED: subscribe() gains subscriberName param
│   │   └── IDbClient.ts       # unchanged
│   ├── user/
│   │   └── UserService.ts     # unchanged — publish() call unchanged
│   ├── notification/
│   │   └── NotificationService.ts   # unchanged — handler logic unchanged
│   └── audit/                 # NEW domain folder
│       └── AuditService.ts    # NEW — handleUserRegistered() handler
├── infrastructure/
│   ├── db/                    # unchanged
│   └── events/
│       ├── boss.ts            # MODIFIED: remove KNOWN_QUEUES
│       └── PgBossEventBus.ts  # MODIFIED: publish→boss.publish, subscribe→boss.subscribe+work
└── index.ts                   # MODIFIED: add AuditService subscription
```

### Structure Rationale

- **`domains/audit/`:** New subscriber domain follows the same pattern as `notification/` — a handler class, no infrastructure imports, no pg-boss awareness.
- **`IEventBus.ts` modified:** `subscriberName` added to `subscribe()` — minimal interface change, high semantic value.
- **`boss.ts` simplified:** Removing `KNOWN_QUEUES` because queues are now created dynamically inside `PgBossEventBus.subscribe()` as subscriber queues are registered.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| pg-boss `subscription` table | `boss.subscribe(event, queueName)` → SQL INSERT | Must call BEFORE `boss.publish()` fires |
| pg-boss `job` table (per queue) | `boss.send(queueName, data, opts)` → SQL INSERT | Called by `boss.publish()` internally |
| pg-boss worker | `boss.work(queueName, handler)` → polling loop | One worker per subscriber queue |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `UserService` ↔ `IEventBus` | `eventBus.publish(event, payload, { db })` | Unchanged — domain never touches pg-boss |
| `PgBossEventBus` ↔ `PgBoss` | `boss.publish()`, `boss.subscribe()`, `boss.work()`, `boss.createQueue()` | All infra; invisible to domain |
| `IEventBus.subscribe()` ↔ caller | Gains `subscriberName: string` param | Breaking change in interface; 2 call sites in `index.ts` |
| `src/index.ts` ↔ `AuditService` | Direct instantiation + subscription | Same wiring pattern as `NotificationService` |

---

## Files: New vs Modified vs Unchanged

| File | Status | What Changes |
|------|--------|--------------|
| `src/domains/shared/IEventBus.ts` | **MODIFIED** | `subscribe()` gains `subscriberName: string` third param |
| `src/domains/shared/events.ts` | **UNCHANGED** | |
| `src/domains/shared/IDbClient.ts` | **UNCHANGED** | |
| `src/domains/user/UserService.ts` | **UNCHANGED** | `publish()` call signature unchanged |
| `src/domains/notification/NotificationService.ts` | **UNCHANGED** | Handler unchanged |
| `src/domains/audit/AuditService.ts` | **NEW** | `handleUserRegistered()` handler, logs audit event |
| `src/infrastructure/events/PgBossEventBus.ts` | **MODIFIED** | `boss.send()` → `boss.publish()`; `boss.work()` → `boss.createQueue()` + `boss.subscribe()` + `boss.work()` |
| `src/infrastructure/events/boss.ts` | **MODIFIED** | Remove `KNOWN_QUEUES` and queue pre-creation loop |
| `src/index.ts` | **MODIFIED** | Add `AuditService` instantiation and subscription; update `NotificationService` subscription to pass `"notification"` name |

---

## Build Order

```
1. Modify IEventBus.ts
   → Add subscriberName param to subscribe() signature
   → This is the type contract; do first so TypeScript catches mismatches

2. Modify PgBossEventBus.ts
   → publish(): boss.send() → boss.publish()
   → subscribe(): boss.work() → boss.createQueue() + boss.subscribe() + boss.work()
   → subscribe() signature gains subscriberName param

3. Modify boss.ts
   → Remove KNOWN_QUEUES and createQueue() loop
   → Queue creation now happens inside PgBossEventBus.subscribe()

4. Create AuditService.ts
   → New file: src/domains/audit/AuditService.ts
   → Mirrors NotificationService shape
   → Pure domain logic: no pg-boss, no Kysely, no imports from infra

5. Modify src/index.ts
   → Update NotificationService subscription: add "notification" as third arg
   → Add AuditService import, instantiation, subscription with "audit" as third arg
   → Subscribe both BEFORE server starts (boot sequence constraint)
```

**Rationale for this order:**
- `IEventBus` first because it's the type boundary — TypeScript will surface all mismatches when the interface changes.
- `PgBossEventBus` second because it's the implementation that must conform to the new interface.
- `boss.ts` third because it loses the `KNOWN_QUEUES` constant that `PgBossEventBus` no longer needs.
- `AuditService` fourth — pure domain code, no infrastructure dependencies, safe to write before wiring.
- `index.ts` last because it depends on all of the above being correct first.

---

## Anti-Patterns

### Anti-Pattern 1: Shared Queue Name for Multiple Subscribers

**What people do:** Both subscribers call `eventBus.subscribe("user.registered", handler)` without a unique name, resulting in both workers pointing at the same queue (e.g., `"user.registered"`).

**Why it's wrong:** pg-boss queues provide exactly-once delivery per queue. Only one subscriber worker receives each job. Fan-out is silently broken — only one handler fires per event, and it's non-deterministic which one.

**Do this instead:** Use unique queue names per subscriber: `notification.user.registered`, `audit.user.registered`.

### Anti-Pattern 2: Publish Before Subscribe (Boot Race)

**What people do:** Start the HTTP server before registering subscriber queues and channel mappings.

**Why it's wrong:** If a request triggers `boss.publish()` before `boss.subscribe()` has registered the queue mapping, `getQueuesForEvent()` returns an empty result set — the event is silently dropped. Subsequent requests work after subscribers are eventually registered, creating non-deterministic behavior.

**Do this instead:** Follow the existing pattern: subscribe → listen. All `eventBus.subscribe()` calls must complete before `app.listen()`.

### Anti-Pattern 3: Optional subscriberName

**What people do:** Make `subscriberName` optional with a fallback default (e.g., fallback to the event name as the queue name).

**Why it's wrong:** Two subscribers calling without a name would both try to use the same queue name (the event name). The second `boss.subscribe()` call would succeed (idempotent upsert), but both workers would point at the same queue — same broken fan-out as Anti-Pattern 1.

**Do this instead:** Make `subscriberName` required in `IEventBus.subscribe()`. TypeScript enforces this at compile time.

### Anti-Pattern 4: Creating Queues in boss.ts for Pub/Sub

**What people do:** Pre-create subscriber queues in `boss.ts` (using `KNOWN_QUEUES`) instead of creating them inside `subscribe()`.

**Why it's wrong:** The queue name is known only to the `subscribe()` caller — moving it to `boss.ts` creates implicit coupling between the composition root's wiring choices and the boot infrastructure. Queue names must be co-located with the subscription call.

**Do this instead:** Create the queue inside `PgBossEventBus.subscribe()` using the derived `subscriberName.event` name. Remove `KNOWN_QUEUES` entirely.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| POC / local dev | Current design is correct. One `boss.work()` per subscriber queue, all in-process. |
| Multiple Node processes | pg-boss workers are multi-master safe. Each process running `boss.work()` on the same queue competes for jobs via `SKIP LOCKED`. Fan-out still correct — each subscriber has its own queue. |
| High event volume | Tune `boss.work()` `teamSize` and `batchSize` options per queue. Queues can scale independently. |

---

## Sources

- pg-boss v12.5.4 source: `node_modules/pg-boss/dist/manager.js` lines 203–220 (subscribe, unsubscribe, publish implementation) — **HIGH confidence**
- pg-boss v12.5.4 source: `node_modules/pg-boss/dist/plans.js` lines 473–494 (subscribe, unsubscribe, getQueuesForEvent SQL) — **HIGH confidence**
- pg-boss v12.5.4 types: `node_modules/pg-boss/dist/index.d.ts` and `types.d.ts` (SendOptions includes `db?: IDatabase` via ConnectionOptions) — **HIGH confidence**
- Existing codebase: `src/infrastructure/events/PgBossEventBus.ts`, `src/index.ts`, `src/domains/shared/IEventBus.ts` — **HIGH confidence**

---
*Architecture research for: pg-boss pub/sub migration + fan-out (v1.1 milestone)*
*Researched: 2026-03-21*

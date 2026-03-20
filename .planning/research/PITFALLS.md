# Pitfalls: DDD + pg-boss Event-Driven POC

## Critical Pitfalls

### 1. Publishing Event OUTSIDE the Transaction

**The mistake:** Calling `eventBus.publish()` after `tx.commit()` instead of inside the transaction.

```ts
// WRONG — dual-write problem exists here
await tx.commit()
await eventBus.publish("user.registered", payload) // separate operation
```

**What goes wrong:** If the process crashes between `tx.commit()` and `eventBus.publish()`, the user row exists but no job is created. The notification is silently lost.

**Prevention:** Always pass the transaction's `KyselyAdapter` to `publish()`. The event bus must use `{ db: kyselyAdapter }` option so pg-boss inserts the job row in the same transaction. The transaction commit/rollback applies to both.

**Phase to address:** Phase 1 (infrastructure setup) — the KyselyAdapter must be ready before UserService is built.

---

### 2. Creating Multiple PgBoss Instances

**The mistake:** Instantiating `new PgBoss(...)` in multiple places, or creating a new instance per request.

```ts
// WRONG
async function registerUser() {
  const boss = new PgBoss(connectionString) // new instance per call!
  await boss.start()
  ...
}
```

**What goes wrong:** Each PgBoss instance creates its own maintenance loops, schema locks, and connection pool entries. Multiple instances fight over the same schema. Schema init races.

**Prevention:** One PgBoss singleton, started once at boot. The existing POC already has `schemaBoss` vs `boss` — this pattern should be eliminated in the rewrite. Use a single `boss` singleton.

**Phase to address:** Phase 1 infrastructure.

---

### 3. Domain Layer Importing Infrastructure

**The mistake:** `UserService` importing `PgBoss` or `PgBossEventBus` directly.

```ts
// WRONG — domain imports infrastructure
import { PgBossEventBus } from '../../infrastructure/events/PgBossEventBus'
```

**What goes wrong:** The domain is now coupled to pg-boss. You can't test `UserService` without a real pg-boss instance. The whole point of the `IEventBus` interface is lost.

**Prevention:** `UserService` constructor takes `IEventBus`. Wire the concrete implementation in `index.ts`. Domain never imports from `infrastructure/`.

**Warning sign:** Any `import` path going `../../infrastructure/` from inside `src/domains/`.

**Phase to address:** Phase 2 (User domain).

---

### 4. Transaction Not Passed Through All Layers

**The mistake:** Opening a transaction in `UserService` but passing the base Kysely instance (not the transaction) to the repository.

```ts
// WRONG
await kysely.transaction().execute(async (tx) => {
  await userRepo.save(user) // uses kysely, not tx!
  await eventBus.publish(event, payload, { db: new KyselyAdapter(tx) })
})
```

**What goes wrong:** The INSERT uses the base connection (auto-committed), the job uses the transaction. They're no longer atomic. The INSERT commits even if something later rolls back.

**Prevention:** `UserRepository.save(user, tx)` takes the transaction as a parameter. Repository must use the provided transaction, not a captured Kysely instance.

**Phase to address:** Phase 2 (repository implementation).

---

### 5. pg-boss Queue Not Created Before Publishing

**The mistake:** Publishing to a queue that hasn't been created yet.

**What goes wrong:** pg-boss silently drops the job or throws depending on version. Queue must exist before `boss.send()` is called.

**Prevention:** Call `boss.createQueue(queueName)` at startup for all known queues, before starting workers or publishing any events.

**Phase to address:** Phase 1 infrastructure boot sequence.

---

### 6. KyselyAdapter Using Wrong Runner

**The mistake:** Passing a `Kysely<Database>` instance as the adapter runner when inside a transaction (should pass `Transaction<Database>`).

**What goes wrong:** The adapter executes SQL on the base connection, breaking the transaction guarantee entirely.

**Prevention:** `KyselyAdapter` constructor takes `Kysely<Database> | Transaction<Database>`. Inside the transaction callback, always pass `tx` (the Transaction parameter), not the outer `kysely` instance.

**Warning sign:** The KyselyAdapter is constructed outside the `transaction().execute()` callback.

**Phase to address:** Phase 1 (KyselyAdapter) and Phase 2 (UserService).

---

### 7. Over-Engineering Domain Events

**The mistake:** Building a full event sourcing system, or adding event versioning, serialization, and migration logic.

**What goes wrong:** The POC becomes a framework tutorial instead of a pattern demonstration. The atomic transaction guarantee gets buried under ceremony.

**Prevention:** Events are plain typed objects. `UserRegistered` is just `{ userId, email, name, occurredAt }`. No base class, no event store, no replay. pg-boss handles durability.

**Phase to address:** Keep in mind during Phase 2.

---

### 8. Not Demonstrating the Rollback Guarantee

**The mistake:** Only showing the happy path — user created + notification sent.

**What goes wrong:** The whole point of the pattern (atomicity) isn't demonstrated. A developer reading this POC won't understand why it's better than `await db.insert(user); await broker.publish(event)`.

**Prevention:** Include a demo endpoint or scenario that causes a transaction rollback (e.g., duplicate email constraint violation) and shows that no job was created. This is the "money moment" of the POC.

**Phase to address:** Phase 3 or 4 (demo polish).

---

*Pitfalls specific to pg-boss ^12.x + Kysely ^0.28.x + TypeScript strict mode.*

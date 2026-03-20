# Phase 1 Research: Infrastructure Foundation

**Phase:** 1 — Infrastructure Foundation
**Created:** 2026-03-20
**Source:** Synthesized from project research library + existing codebase analysis

---

## What We Need to Know

Phase 1 establishes the shared infrastructure layer: db connection, KyselyAdapter, PgBoss singleton, and the typed event bus abstraction. All Phase 2+ layers build on this foundation.

---

## Existing Codebase Baseline

The current `index.ts` already demonstrates the core `KyselyBossAdapter` pattern working correctly. Phase 1's job is to lift these into properly structured modules in `src/infrastructure/db/` and `src/infrastructure/events/`, and add the domain-layer interfaces (`IEventBus`, `DomainEventMap`) in `src/domains/shared/`.

**What exists and works:**
- `pg.Pool` + `PostgresDialect` + `Kysely<Database>` setup (lines 22-30)
- `KyselyBossAdapter` class (lines 32-44) — the central adapter
- Schema DDL via Kysely (lines 46-57)
- PgBoss singleton pattern (lines 59-112, minus the `schemaBoss` anti-pattern)

**Anti-pattern to fix:** The current code creates two PgBoss instances (`schemaBoss` + `boss`). The DDD rewrite should use a single `boss` singleton started at boot.

---

## Architecture Decisions

### Folder Structure

```
src/
  domains/
    shared/
      events.ts          # DomainEventMap type — the typed event contract
      IEventBus.ts       # Interface — domain code depends ONLY on this
  infrastructure/
    db/
      pool.ts            # pg.Pool singleton
      kysely.ts          # Kysely<Database> instance (imports pool.ts)
      types.ts           # Database, User interfaces for Kysely type params
      KyselyAdapter.ts   # KyselyAdapter class (bridges pg-boss → Kysely)
      schema.ts          # setupSchema() DDL function
    events/
      boss.ts            # PgBoss singleton + start + createQueue
      PgBossEventBus.ts  # IEventBus implementation using pg-boss
```

### KyselyAdapter Type Signature

```ts
// src/infrastructure/db/KyselyAdapter.ts
import { CompiledQuery, Kysely, Transaction } from "kysely";
import type { Database } from "./types.ts";

export class KyselyAdapter {
  constructor(private readonly runner: Kysely<Database> | Transaction<Database>) {}

  async executeSql(text: string, values: any[] = []): Promise<{ rows: any[] }> {
    const result = await this.runner.executeQuery(CompiledQuery.raw(text, values));
    return { rows: result.rows };
  }
}
```

### DomainEventMap (typed contract)

```ts
// src/domains/shared/events.ts
export type DomainEventMap = {
  "user.registered": {
    userId: string;
    email: string;
    name: string;
  };
};
```

### IEventBus (domain interface — NO pg-boss import)

```ts
// src/domains/shared/IEventBus.ts
import type { DomainEventMap } from "./events.ts";
import type { KyselyAdapter } from "../../infrastructure/db/KyselyAdapter.ts";

export interface IEventBus {
  publish<K extends keyof DomainEventMap>(
    event: K,
    payload: DomainEventMap[K],
    opts?: { db?: KyselyAdapter }
  ): Promise<void>;
  subscribe<K extends keyof DomainEventMap>(
    event: K,
    handler: (payload: DomainEventMap[K]) => Promise<void>
  ): Promise<void>;
}
```

**Note:** `IEventBus` may import `KyselyAdapter` for the optional `db` param in publish. This is a controlled dependency — KyselyAdapter is a thin adapter with no pg-boss surface, not an infrastructure implementation detail.

### PgBossEventBus.publish() Transactional Route

```ts
// src/infrastructure/events/PgBossEventBus.ts
import PgBoss from "pg-boss";
import type { IEventBus } from "../../domains/shared/IEventBus.ts";
import type { DomainEventMap } from "../../domains/shared/events.ts";
import type { KyselyAdapter } from "../db/KyselyAdapter.ts";

export class PgBossEventBus implements IEventBus {
  constructor(private readonly boss: PgBoss) {}

  async publish<K extends keyof DomainEventMap>(
    event: K,
    payload: DomainEventMap[K],
    opts?: { db?: KyselyAdapter }
  ): Promise<void> {
    await this.boss.send(event, payload as object, opts?.db ? { db: opts.db } : {});
  }

  async subscribe<K extends keyof DomainEventMap>(
    event: K,
    handler: (payload: DomainEventMap[K]) => Promise<void>
  ): Promise<void> {
    await this.boss.work(event, async ([job]) => {
      if (!job) throw new Error(`No job received for ${event}`);
      await handler(job.data as DomainEventMap[K]);
    });
  }
}
```

### PgBoss Boot Sequence (boss.ts)

Single singleton. Queues created at boot before any publish:

```ts
// src/infrastructure/events/boss.ts
import PgBoss from "pg-boss";
import { KyselyAdapter } from "../db/KyselyAdapter.ts";
import { kysely } from "../db/kysely.ts";

export const KNOWN_QUEUES = ["user.registered"] as const;

export async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss({ db: new KyselyAdapter(kysely) });
  boss.on("error", console.error);
  await boss.start();
  for (const queue of KNOWN_QUEUES) {
    await boss.createQueue(queue);
  }
  return boss;
}
```

---

## Validation Architecture

### Test Infrastructure

**Framework:** `bun test` (built-in, no install needed)

**Quick command:** `bun test --filter "infrastructure" 2>&1 | tail -20`

**Full command:** `bun test 2>&1`

**Estimated runtime:** < 5 seconds for TypeScript compilation checks (no live DB needed for type checks; integration requires Docker)

### What Can Be Validated Without a Live DB

- TypeScript compilation: `bun build src/domains/shared/events.ts --target bun`
- Type checking: `bun tsc --noEmit` (verifies IEventBus, DomainEventMap contracts)
- KyselyAdapter unit test: mock runner, verify `executeSql` calls `executeQuery` with `CompiledQuery.raw`

### Integration Validation (requires Docker)

- `PgBossEventBus.publish()` with `{ db: KyselyAdapter(tx) }` routes job in same tx
- Queue created before publish (INFRA-03)
- Schema installed once at boot

---

## Critical Pitfalls for Phase 1

1. **Two PgBoss instances** — Current `index.ts` uses `schemaBoss` + `boss`. Phase 1 uses ONE singleton.
2. **KyselyAdapter wrapping wrong runner** — Must accept `tx` (Transaction) not just `kysely` (base instance)
3. **Queue not created before publish** — `boss.createQueue("user.registered")` at boot
4. **Domain importing infrastructure** — `IEventBus` must not import PgBoss types

---

## Import Path Note

Using Bun's `allowImportingTsExtensions: true` — import paths use `.ts` extension:
```ts
import { KyselyAdapter } from "../db/KyselyAdapter.ts";
```

---

*Research complete. Ready for planning.*

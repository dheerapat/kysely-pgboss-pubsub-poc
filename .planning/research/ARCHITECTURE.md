# Architecture Research: DDD + Event-Driven TypeScript POC

## Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                         HTTP Layer                          │
│   Hono router → POST /users → UserService.register(...)    │
└───────────────────────────┬─────────────────────────────────┘
                            │ calls
┌───────────────────────────▼─────────────────────────────────┐
│                      Domain Layer                           │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │    User Domain      │    │  Notification Domain     │   │
│  │                     │    │                          │   │
│  │  User (entity)      │    │  NotificationService     │   │
│  │  Email (value obj)  │    │  (event handler only)    │   │
│  │  UserRepository     │    │                          │   │
│  │  UserService        │    └──────────────────────────┘   │
│  │    ├─ tx.INSERT      │                                   │
│  │    └─ eventBus       │                                   │
│  │       .publish(...)  │                                   │
│  └─────────────────────┘                                   │
└─────────────────────┬───────────────────────────────────────┘
                      │ uses (via interface)
┌─────────────────────▼───────────────────────────────────────┐
│                   Infrastructure Layer                       │
│                                                             │
│  ┌───────────────────┐    ┌─────────────────────────────┐  │
│  │  EventBus         │    │  Database                   │  │
│  │  (pg-boss impl)   │    │                             │  │
│  │                   │    │  pg.Pool (shared)           │  │
│  │  publish() →      │    │  Kysely instance            │  │
│  │    boss.send()    │    │  KyselyAdapter              │  │
│  │    with tx db opt │    │                             │  │
│  │                   │    │  UserRepository (Kysely)    │  │
│  │  subscribe() →    │    │                             │  │
│  │    boss.work()    │    └─────────────────────────────┘  │
│  └───────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow: User Registration

```
1. HTTP POST /users {email, name}
2. Hono router → UserService.register(email, name)
3. UserService:
     a. Build User entity (generate UUID)
     b. Open Kysely transaction
     c. UserRepository.save(user, tx)  → INSERT INTO users
     d. eventBus.publish("user.registered", payload, { db: KyselyAdapter(tx) })
        → boss.send("user.registered", payload, { db: kyselyAdapterForTx })
        → pg-boss inserts job row in SAME transaction
     e. tx.commit()
        → BOTH the user row AND the job row are committed atomically
4. HTTP response: { userId }

5. (Asynchronous, separate process/loop)
   pg-boss worker polling "user.registered" queue
   → picks up job
   → NotificationService.handleUserRegistered(payload)
   → logs "Sending welcome email to {email}"
```

## Key Architectural Decisions

### Event Bus Lives in Infrastructure, Interface in Domain

The domain layer defines an `IEventBus` interface. Infrastructure provides the pg-boss implementation. This keeps domain code testable without pg-boss.

```ts
// src/domains/shared/IEventBus.ts
export interface IEventBus {
  publish<K extends keyof DomainEventMap>(
    event: K,
    payload: DomainEventMap[K],
    opts?: { db?: KyselyAdapter }
  ): Promise<void>
}

// src/infrastructure/events/PgBossEventBus.ts
export class PgBossEventBus implements IEventBus { ... }
```

### Domain Event Map: Shared Type Contract

A single `DomainEventMap` type lives in `src/domains/shared/events.ts`. Both publisher (User domain) and subscriber (Notification domain) import from it. This is the typed contract.

### Workers Start at Boot

pg-boss workers (subscribers) are registered at application startup in `index.ts`, not inside the domain. The domain defines what to do; infrastructure wires up the listening.

### Transaction Boundary: UserService Owns It

The transaction is opened and committed in `UserService`. The repository and event bus both accept an optional transaction context. This keeps the transaction boundary explicit and in application service layer (not domain, not HTTP).

## Recommended Folder Structure

```
src/
  domains/
    shared/
      events.ts          # DomainEventMap type definition
      IEventBus.ts       # Event bus interface
    user/
      entities/
        User.ts
      value-objects/
        Email.ts
        UserId.ts
      events/
        UserRegistered.ts  # Event factory + type
      repository/
        IUserRepository.ts
      service/
        UserService.ts
    notification/
      service/
        NotificationService.ts
  infrastructure/
    db/
      pool.ts            # pg.Pool singleton
      kysely.ts          # Kysely instance
      schema.ts          # DDL setup (CREATE TABLE)
      types.ts           # Kysely Database interface
      KyselyAdapter.ts   # KyselyAdapter class (moved from index.ts)
    events/
      PgBossEventBus.ts  # pg-boss implementation of IEventBus
      boss.ts            # PgBoss singleton + start
    http/
      router.ts          # Hono routes
      server.ts          # Hono app + Bun.serve
  index.ts               # Wire everything, start server + workers
```

## Build Order

```
Phase 1: Infrastructure foundation
  → db (pool, kysely, adapter, schema)
  → event bus infrastructure (boss singleton, PgBossEventBus)

Phase 2: User domain
  → value objects → entity → repository interface → Kysely repository impl
  → UserService (tx + event publish)
  → HTTP route

Phase 3: Notification domain
  → NotificationService handler
  → Wire subscription in index.ts

Phase 4: Demo polish
  → Rollback demonstration endpoint
  → README with curl examples + annotated flow
```

---
*Confidence: High. This architecture is a direct application of hexagonal architecture principles to the existing POC, with minimal ceremony.*

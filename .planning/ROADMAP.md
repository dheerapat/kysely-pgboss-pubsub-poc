# Roadmap: Kysely + pg-boss DDD Event-Driven POC

**Created:** 2026-03-20
**Phases:** 4
**Requirements:** 20 v1 requirements, 100% mapped

## Phases

### Phase 1: Infrastructure Foundation

**Goal:** Establish the shared infrastructure layer — database connection, KyselyAdapter, PgBoss singleton, and the typed event bus abstraction — so all domain layers have a stable, correct foundation to build on.

**Requirements:** INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06

**Success Criteria:**
1. A single `pg.Pool` and `Kysely` instance are created and reusable across domains
2. `KyselyAdapter` correctly executes SQL through a Kysely transaction (testable by calling `executeSql` with a live tx)
3. `PgBoss` starts without error, installs schema, and creates all known queues
4. `DomainEventMap` type exists and TypeScript compilation fails if a publish call uses an unknown event name or wrong payload shape
5. `IEventBus` interface is defined in the domain shared layer with no import from infrastructure
6. `PgBossEventBus.publish()` with `{ db: KyselyAdapter(tx) }` routes the job through the provided transaction

---

### Phase 2: User Domain

**Goal:** Implement the User domain with full tactical DDD patterns — value objects, entity, repository interface and implementation, and the UserService that atomically saves a user and publishes a domain event inside a single transaction.

**Requirements:** USER-01, USER-02, USER-03, USER-04, USER-05, USER-06

**Success Criteria:**
1. `UserId` and `Email` value objects exist with type safety; `Email` rejects invalid format at construction time
2. `User` entity is created via factory and cannot be mutated after construction
3. `IUserRepository` interface has no Kysely or pg types in its signature
4. `UserRepository` (Kysely impl) inserts a user row into the `users` table using the provided transaction
5. `UserService.register(email, name)` runs INSERT + `eventBus.publish("user.registered", ...)` inside a single Kysely transaction; calling it results in exactly one new user row and one pending pg-boss job row — both committed together

---

### Phase 3: Notification Domain + HTTP API

**Goal:** Wire the Notification domain handler to the event bus, build the Elysia HTTP server with working endpoints, and connect all layers so a curl to `POST /users` triggers the full end-to-end flow and logs confirm the async handler fired.

**Requirements:** NOTIF-01, NOTIF-02, HTTP-01, HTTP-02, HTTP-03, DEMO-01

**Success Criteria:**
1. `NotificationService.handleUserRegistered(payload)` logs a formatted "sending welcome email" message with the user's email and id
2. The `user.registered` pg-boss worker is registered at boot and picks up jobs without manual intervention
3. Elysia server starts and responds to requests on the configured port
4. `POST /users {"email":"test@example.com","name":"Alice"}` returns `{"userId":"<uuid>"}` with HTTP 201
5. `GET /users` returns an array containing the newly created user
6. Console logs show the sequence: tx opened → INSERT → job created (same tx) → tx committed → (async) worker fired → notification handler executed

---

### Phase 4: Rollback Demo + README

**Goal:** Demonstrate the atomicity guarantee explicitly by showing a transaction rollback prevents the event from being queued, and document the pattern thesis and demo flow for any reader of the POC.

**Requirements:** HTTP-04, DEMO-02

**Success Criteria:**
1. `POST /users` with a duplicate email returns HTTP 409 and no new user row is added to the database
2. After a duplicate email attempt, the pg-boss job table contains no new pending job for `user.registered` — the rollback prevented both the INSERT and the job creation
3. `README.md` explains the core thesis (atomic tx guarantee vs dual-write problem), the folder structure, and includes working curl commands for the happy path and rollback demo

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 1 | Pending |
| INFRA-06 | Phase 1 | Pending |
| USER-01 | Phase 2 | Pending |
| USER-02 | Phase 2 | Pending |
| USER-03 | Phase 2 | Pending |
| USER-04 | Phase 2 | Pending |
| USER-05 | Phase 2 | Pending |
| USER-06 | Phase 2 | Pending |
| NOTIF-01 | Phase 3 | Pending |
| NOTIF-02 | Phase 3 | Pending |
| HTTP-01 | Phase 3 | Pending |
| HTTP-02 | Phase 3 | Pending |
| HTTP-03 | Phase 3 | Pending |
| DEMO-01 | Phase 3 | Pending |
| HTTP-04 | Phase 4 | Pending |
| DEMO-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

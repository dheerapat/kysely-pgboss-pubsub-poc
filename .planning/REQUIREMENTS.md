# Requirements: Kysely + pg-boss DDD Event-Driven POC

**Defined:** 2026-03-20
**Core Value:** Domain writes and domain event publishing are atomic — if the transaction rolls back, the event is never queued.

## v1 Requirements

### Infrastructure

- [x] **INFRA-01**: A single shared `pg.Pool` and `Kysely` instance are initialized at boot and reused across all domains
- [x] **INFRA-02**: A `KyselyAdapter` class bridges pg-boss and Kysely so pg-boss can execute SQL through an active Kysely transaction
- [x] **INFRA-03**: A single `PgBoss` instance is initialized at boot, schema is installed once, and all known queues are created before any publish or subscribe
- [x] **INFRA-04**: A `DomainEventMap` type in the shared domain layer defines all event names and their payload types — this is the typed contract between publishers and subscribers
- [x] **INFRA-05**: An `IEventBus` interface in the shared domain layer exposes `publish(event, payload, opts?)` and `subscribe(event, handler)` — domain code depends only on this interface, never on pg-boss directly
- [x] **INFRA-06**: A `PgBossEventBus` class in the infrastructure layer implements `IEventBus` using pg-boss — `publish` accepts an optional `{ db: KyselyAdapter }` to route the job through an active transaction

### User Domain

- [x] **USER-01**: A `UserId` value object wraps a UUID string with type safety
- [x] **USER-02**: An `Email` value object wraps an email string with basic format validation
- [x] **USER-03**: A `User` entity holds `UserId`, `Email`, and `name` — constructed via a factory, not mutated after creation
- [x] **USER-04**: An `IUserRepository` interface in the user domain defines `save(user, tx)` and `findAll()` — no Kysely types leak into the domain interface
- [ ] **USER-05**: A Kysely implementation of `IUserRepository` in the infrastructure layer persists users to a `users` table using the provided transaction
- [ ] **USER-06**: A `UserService.register(email, name)` method opens a Kysely transaction, saves the user, and publishes a `user.registered` event via `IEventBus` using `KyselyAdapter(tx)` — all in a single atomic transaction

### Notification Domain

- [ ] **NOTIF-01**: A `NotificationService.handleUserRegistered(payload)` method receives the `user.registered` event payload and logs a simulated welcome email notification
- [ ] **NOTIF-02**: The `user.registered` pg-boss worker is registered at boot by subscribing `NotificationService.handleUserRegistered` to the `user.registered` queue via `IEventBus`

### HTTP API

- [ ] **HTTP-01**: Elysia HTTP server starts at boot and listens for requests
- [ ] **HTTP-02**: `POST /users` accepts `{ email, name }`, calls `UserService.register()`, and returns `{ userId }` on success
- [ ] **HTTP-03**: `GET /users` returns a list of all persisted users from the database
- [ ] **HTTP-04**: `POST /users` with a duplicate email returns a 409 error and demonstrates that no `user.registered` job was created (transaction rolled back atomically)

### Demo

- [ ] **DEMO-01**: Console logs clearly show the sequence: transaction opened → user INSERT → job created (same tx) → transaction committed → (async) worker picked up job → notification handler executed
- [ ] **DEMO-02**: A `README.md` documents the pattern thesis, the folder structure, and includes annotated curl commands to run the full demo flow

## v2 Requirements

### Extended Demo

- **V2-01**: A second event type (e.g. `user.deactivated`) to show the event bus handles multiple event types
- **V2-02**: Multiple handlers for one event (fan-out) — e.g. welcome email + analytics log both triggered by `user.registered`
- **V2-03**: Dead letter queue / retry configuration visible in demo

### Additional Domains

- **V2-04**: An `Order` domain to demonstrate a more complex cross-domain flow (Order placed → Inventory reserved → Notification sent)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real email sending | Hides the pattern; handler logs to console |
| Authentication / JWT | Unrelated to event-driven pattern |
| Full CQRS | Over-engineering; query/command split adds noise |
| Event sourcing / event replay | pg-boss is a job queue, not an event store |
| Sagas / process managers | Too complex for a two-domain POC |
| External message broker (Kafka, RabbitMQ) | Explicitly excluded — the point is pg-boss replaces them |
| Outbox pattern | The transactional adapter makes it unnecessary |
| Hono HTTP framework | User preference: Elysia instead |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Complete |
| INFRA-06 | Phase 1 | Complete |
| USER-01 | Phase 2 | Complete |
| USER-02 | Phase 2 | Complete |
| USER-03 | Phase 2 | Complete |
| USER-04 | Phase 2 | Complete |
| USER-05 | Phase 2 | Pending |
| USER-06 | Phase 2 | Pending |
| NOTIF-01 | Phase 3 | Pending |
| NOTIF-02 | Phase 3 | Pending |
| HTTP-01 | Phase 3 | Pending |
| HTTP-02 | Phase 3 | Pending |
| HTTP-03 | Phase 3 | Pending |
| HTTP-04 | Phase 4 | Pending |
| DEMO-01 | Phase 3 | Pending |
| DEMO-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after initial definition*

# Features Research: DDD Event-Driven POC

## Table Stakes

These must be demonstrated or the POC fails to teach the pattern.

### Event Bus Abstraction
- **Typed event map**: TypeScript enforces payload shape per event name
- **Transactional publish**: `publish(event, payload, { db: kyselyAdapter })` routes through the active transaction
- **Non-transactional publish**: `publish(event, payload)` for fire-and-forget (outside tx)
- **Subscribe**: Register async handler per event type
- **Complexity:** Medium — core of the POC

### User Domain
- **Register user**: HTTP POST → validate → persist to DB → publish `user.registered` event — all in one transaction
- **Entity with identity**: `User` class with a `UserId` value object (not just a plain object)
- **Repository interface**: `IUserRepository` defined in domain layer, implemented with Kysely in infrastructure
- **Complexity:** Low-medium

### Notification Domain
- **Subscribe to `user.registered`**: pg-boss worker picks up the job
- **Handle asynchronously**: Log or simulate sending a welcome email
- **No entity needed**: Notification domain is handler-only for v1 POC clarity
- **Complexity:** Low

### Infrastructure
- **KyselyAdapter**: Passed to pg-boss `publish` so job is created inside same transaction
- **Atomic guarantee demonstration**: If tx rolls back (e.g., duplicate email), no job is created — demonstrable in logs
- **Single pg.Pool shared**: One pool, both Kysely and pg-boss use it
- **Complexity:** Low (already exists in POC)

### HTTP Demo Surface
- `POST /users` — trigger the full flow
- `GET /users` — verify the user was persisted
- Response shows userId; logs show event published and handled
- **Complexity:** Low

## Differentiators

These add value beyond minimum, worth including if scope allows.

- **Rollback demonstration**: A dedicated endpoint that forces a transaction rollback, showing no job is enqueued — powerfully illustrates the guarantee
- **Domain event factory**: `UserRegistered.create(user)` factory method on the event class, showing events are first-class domain objects
- **Value objects**: `Email` value object with validation (not just `string`) — shows DDD thinking
- **Multiple event handlers**: Notification domain has two handlers for `user.registered` (email + analytics log) — shows fan-out

## Anti-Features

Deliberately exclude these — they obscure the pattern.

| Anti-Feature | Reason to Exclude |
|---|---|
| Real email sending | Hides the pattern behind SMTP complexity |
| Authentication/JWT | Not related to the event-driven pattern |
| Full CQRS (command/query separation) | Over-engineering for this POC |
| Event sourcing / event store | Different pattern; pg-boss is a job queue, not an event store |
| Sagas / process managers | Too complex; one hop (User → Notification) is sufficient |
| Aggregate roots with invariant enforcement | Adds DDD complexity without adding event-bus insight |
| Multiple domains beyond User + Notification | Diminishing returns; one clear example beats two shallow ones |
| Retry / dead letter queue config | pg-boss handles this automatically; don't surface it |

---
*Research focus: What demonstrates the atomic publish guarantee most clearly, without burying it in unrelated DDD ceremony.*

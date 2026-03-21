# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-21
**Phases:** 4 | **Plans:** 9 | **Sessions:** ~4

### What Was Built
- Shared infrastructure layer: `pg.Pool` + `Kysely<Database>` singletons, `KyselyAdapter` (pg-boss ↔ Kysely tx bridge), `PgBoss` singleton with pre-created queues
- Typed event bus abstraction: `DomainEventMap` event registry + `IEventBus` interface + `PgBossEventBus` implementation — domain layer has zero pg-boss surface
- `IDbClient` domain interface (structural typing): eliminated infrastructure import from `IEventBus`, closing the domain/infra boundary cleanly
- User domain: `UserId`/`Email` branded value objects, `User` entity (private constructor + factory), `IUserRepository` + Kysely implementation
- `UserService.register()` with single-transaction atomicity — INSERT user row + pg-boss job in one Kysely tx via `KyselyAdapter(tx)`
- `NotificationService` with `handleUserRegistered()` handler wired as a pg-boss worker via `IEventBus.subscribe()`
- Elysia HTTP server: `POST /users` (201 + userId), `GET /users`, `POST /users` duplicate → 409 (rollback demo)
- README with pattern thesis, KyselyAdapter explanation, folder structure, and annotated curl commands

### What Worked
- **Structural typing for `IDbClient`**: Using a minimal structural interface instead of importing `KyselyAdapter` directly meant zero call-site changes when fixing the boundary — the adaptor satisfied it automatically
- **Fail-fast before tx open**: Validating `Email.create()` before the transaction opened avoided wasted DB I/O on invalid input
- **Worker subscription before `.listen()`**: Registering pg-boss workers before the HTTP server started prevented race conditions where a request could arrive before the handler was ready
- **Branded types (unique symbols)**: Zero runtime overhead while giving TypeScript nominal typing — cleaner than class wrappers for value objects
- **TDD for value objects**: Email validation logic had clear inputs/outputs; tests documented the contract and caught regressions

### What Was Inefficient
- **REQUIREMENTS.md tracking lag**: HTTP-04 and DEMO-02 checkboxes were not updated when Phase 4 executed — had to fix them retroactively during milestone completion
- **`summary-extract` requires relative paths**: The gsd-tools CLI fails on absolute paths, requiring workarounds during milestone reporting
- **IEventBus boundary discovered late**: The `KyselyAdapter` import in `IEventBus` was an infra leak caught during Plan 01-04 (gap closure) rather than at design time — a Plan 01-03 code review would have caught it earlier

### Patterns Established
- **Transaction ownership at service layer**: Services open and own tx; repositories receive it as a parameter — never manage their own transaction
- **KNOWN_QUEUES list at boot**: All pg-boss queues pre-created before any publish/subscribe — avoids timing issues
- **`err.code === "23505"` guard at HTTP layer**: Catch Postgres unique violation at the controller, return 409, re-throw anything else — simple and sufficient for POC scope
- **`boss.send()` over `boss.publish()`**: Queue-based send is simpler than the publish/subscribe/work three-step when queues are pre-created

### Key Lessons
1. **Domain/infra boundary violations are cheap to fix structurally**: TypeScript structural typing means introducing a minimal `IDbClient` interface in the domain costs nothing at call sites — the infra type satisfies it implicitly
2. **Transactional job queues eliminate a whole problem class**: pg-boss storing jobs in PostgreSQL means you never need an outbox pattern, saga, or two-phase commit for event publishing
3. **One clear example > many shallow ones**: A single fully-traced event (`user.registered`) with a complete rollback demo is more instructive than multiple partial flows
4. **Track requirement completion during execution**: Updating traceability tables as each plan runs avoids retroactive cleanup during milestone completion

### Cost Observations
- Model mix: ~80% sonnet, ~20% opus (planning)
- Sessions: ~4 active working days
- Notable: POC scope kept plans tight — most executed in < 30 minutes with zero rework

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~4 | 4 | Initial project; established GSD workflow patterns |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 9+ | Core paths | 0 (Bun stdlib only) |

### Top Lessons (Verified Across Milestones)

1. Structural typing makes domain/infra boundary fixes low-cost — introduce minimal interfaces early
2. Track requirement completion inline during execution, not retroactively at milestone time

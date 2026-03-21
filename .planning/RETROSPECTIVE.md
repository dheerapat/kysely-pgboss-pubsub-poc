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

## Milestone: v1.1 — pg-boss Native Pub/Sub + Fan-Out

**Shipped:** 2026-03-21
**Phases:** 3 | **Plans:** 7 | **Sessions:** ~1

### What Was Built
- `IEventBus.subscribe()` required `subscriberName: string` parameter — TypeScript enforces subscriber identity at every call site
- `boss.ts` stripped to a bare PgBoss factory — queue lifecycle ownership moved entirely to `PgBossEventBus.subscribe()`
- `PgBossEventBus.publish()` migrated from `boss.send()` to `boss.publish()` — native fan-out via `pgboss.subscription` table; `{ db }` option preserved
- `PgBossEventBus.subscribe()` uses 3-step `createQueue → boss.subscribe → boss.work` (FK-safe ordering)
- `AuditService` — pure domain class, zero pg-boss imports, second independent subscriber for `user.registered`
- Fan-out end-to-end verified: single `POST /users` fires both `NotificationService` and `AuditService` handlers
- Rollback regression confirmed with two subscriber queues: duplicate email → HTTP 409, zero jobs in both queues
- README v1.1 section: pub/sub vs queue-based approach, `pgboss.subscription` table role, fan-out mechanism, boot sequence ordering rationale
- `PgBossEventBus` inline comment documenting `{ db }` partial-transaction semantics

### What Worked
- **Research-first approach**: Researching pg-boss pub/sub APIs before writing code surfaced the `subscriberName` requirement and FK ordering constraint upfront — zero rework during implementation
- **Interface-first enforcement**: Adding `subscriberName` to `IEventBus.subscribe()` as required (not optional) forced TypeScript to catch all call sites immediately — no silent breakage
- **Fan-out test is trivial once wired**: After `AuditService` was created and `index.ts` updated, the fan-out worked on first run with zero debugging needed
- **Staged migration across phases**: Phase 5 locked the contract; Phase 6 migrated the implementation; Phase 7 verified. Each phase had a clear, single responsibility
- **Human verification gate**: Keeping VERI-01 (rollback regression) as a human test rather than automated test was the right call for a POC — fast and unambiguous

### What Was Inefficient
- **`summary-extract` one-liner field**: Several SUMMARY.md files in Phase 5 and early Phase 6 didn't have a `**One-liner:**` field, causing the CLI to return empty — manual grep needed as fallback
- **v1.0 Docker volume data**: Dev note was required to run `docker compose down -v` before first v1.1 test — a minor friction that could be baked into phase setup steps

### Patterns Established
- **Subscriber identity in interface**: `subscriberName` as required parameter means the domain interface itself encodes the fan-out contract — no implicit "default queue" footgun
- **FK-safe 3-step subscribe**: `createQueue → boss.subscribe → boss.work` is the canonical ordering for pg-boss pub/sub — deviating silently breaks subscriptions
- **Pure domain subscriber pattern**: New event handlers live in `src/domains/{name}/` and implement a typed `handleXxx()` method with zero infra imports — `AuditService` is the canonical example
- **subscribe-before-listen**: Registering all `IEventBus.subscribe()` calls before `app.listen()` is non-negotiable — `boss.publish()` silently creates zero jobs if subscriptions aren't registered

### Key Lessons
1. **Optional `subscriberName` is a trap**: If the param is optional, two subscribers will derive the same queue name and silently overwrite each other's binding in `pgboss.subscription` — making it required costs nothing and prevents the bug entirely
2. **`boss.publish()` is a no-op without prior `boss.subscribe()`**: Unlike `boss.send()` (direct queue insert), `boss.publish()` queries the subscription table. Subscriptions must be registered before any publish — boot order is not optional
3. **Fan-out is free once pub/sub is wired**: Adding a second subscriber is 3 lines in `index.ts` (create service, call `eventBus.subscribe`) — no routing code, no publish-side changes, no new queue definitions
4. **Research phase pays off in zero rework**: Every implementation detail (FK ordering, subscriberName convention, partial-transaction semantics) was identified in research and written into the PLAN before any code was written — execution was mechanical

### Cost Observations
- Model mix: ~80% sonnet, ~20% opus (planning/research)
- Sessions: ~1 active working day
- Notable: All 7 plans executed in a single session; research quality eliminated debugging time entirely

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~4 | 4 | Initial project; established GSD workflow patterns |
| v1.1 | ~1 | 3 | Research-first; zero rework; fan-out via native pub/sub |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 9+ | Core paths | 0 (Bun stdlib only) |
| v1.1 | 9+ (unchanged) | Core paths | 0 (pg-boss already a dep) |

### Top Lessons (Verified Across Milestones)

1. Structural typing makes domain/infra boundary fixes low-cost — introduce minimal interfaces early
2. Track requirement completion inline during execution, not retroactively at milestone time
3. Research phase quality directly determines execution speed — surface constraints before writing code
4. Required parameters over optional ones when missing identity causes silent correctness bugs

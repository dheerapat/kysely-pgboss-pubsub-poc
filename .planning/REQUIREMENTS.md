# Requirements: kysely-pgboss-pubsub-poc

**Defined:** 2026-03-21
**Core Value:** Domain writes and domain event publishing are atomic — if the transaction rolls back, the event is never queued.

## v1.2 Requirements

Requirements for the Elysia Decorate Refactor milestone. Zero behavioral changes — pure structural refactor.

### Plugin Architecture

- [x] **PLUG-01**: Developer can find a single `servicesPlugin` file that decorates all wired dependencies (pool, boss, eventBus, userRepo, userService, notificationService, auditService) onto Elysia context via `.decorate()`
- [x] **PLUG-02**: Developer can find a single `workersPlugin` that registers all event bus subscriptions (`NotificationService`, `AuditService`) with the same boot ordering as today
- [x] **PLUG-03**: Developer can find a single `userRoutesPlugin` that defines `/users` GET and POST handlers using context-injected services (no closure over outer variables)

### Composition Root

- [ ] **ROOT-01**: `src/index.ts` contains only plugin composition and server start — no `new Service()` instantiation, no inline `await eventBus.subscribe()` calls
- [ ] **ROOT-02**: Boot order is preserved — workers plugin registered before server starts (subscriptions before `.listen()`)
- [ ] **ROOT-03**: Graceful shutdown handler remains accessible from `index.ts`, stopping boss and pool on SIGINT

### Type Safety

- [x] **TYPE-01**: Route handlers access decorated services with full TypeScript type inference (no `any` casts required at call sites)

## Future Requirements

*(None at this stage — this is a focused refactor milestone)*

## Out of Scope

| Feature | Reason |
|---------|--------|
| New endpoints or routes | Pure refactor — zero behavioral changes |
| New event types | Out of scope for this POC milestone |
| New domain services | Not needed for refactor goal |
| Authentication/authorization | Not relevant to the event-driven pattern |
| Real email sending | Notification handler logs; sending hides the pattern |
| External message brokers | pg-boss replaces them for this use case |
| Outbox pattern | Transactional adapter makes it unnecessary |
| Full CQRS / event sourcing | Over-engineering for a two-domain POC |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLUG-01 | Phase 8 | Complete |
| PLUG-02 | Phase 8 | Complete |
| PLUG-03 | Phase 8 | Complete |
| ROOT-01 | Phase 9 | Pending |
| ROOT-02 | Phase 9 | Pending |
| ROOT-03 | Phase 9 | Pending |
| TYPE-01 | Phase 8 | Complete |

**Coverage:**
- v1.2 requirements: 7 total
- Mapped to phases: 7 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after initial definition*

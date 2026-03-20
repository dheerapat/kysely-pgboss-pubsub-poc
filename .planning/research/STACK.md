# Stack Research: DDD + Event-Driven TypeScript with Bun, Kysely, pg-boss

## Recommended Stack

### HTTP Framework: Hono

**Recommendation:** Hono over Elysia.

| Factor | Hono | Elysia |
|--------|------|--------|
| Bun support | First-class | First-class |
| Ecosystem maturity | More mature, broader adoption | Newer, Bun-centric |
| Runtime portability | Works on Bun, Node, Deno, CF Workers | Primarily Bun |
| TypeScript DX | Excellent type inference | Excellent (Elysia's Eden) |
| Community/docs | Larger, more examples | Smaller |

**Verdict:** Hono. It's more mature, well-documented, and the extra portability doesn't cost anything. Confidence: High.

```
hono ^4.x
@hono/node-server (not needed — use Bun.serve adapter)
```

### Typed Event Bus

No standard library exists. The pattern is to build a thin wrapper:

```ts
// Approach: Discriminated union map + generic publish/subscribe
type EventMap = {
  "user.registered": { userId: string; email: string; name: string }
  "notification.sent": { userId: string; type: string }
}

interface EventBus {
  publish<K extends keyof EventMap>(
    event: K,
    payload: EventMap[K],
    opts: { db?: KyselyAdapter } // for transactional publishing
  ): Promise<void>
  subscribe<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => Promise<void>
  ): Promise<void>
}
```

**Libraries to consider:** None — build the abstraction. External libs (eventstore, node-cqrs) are over-engineered for this POC.

### Folder-Per-Domain Structure

```
src/
  domains/
    user/
      entities/        # User.ts (entity class)
      value-objects/   # Email.ts, UserId.ts
      events/          # UserRegistered.ts (event type + factory)
      repository/      # UserRepository.ts (interface + Kysely impl)
      service/         # UserService.ts (orchestrates tx + event publish)
    notification/
      events/          # handlers only — no entity needed for this POC
      service/         # NotificationService.ts (event handler)
  infrastructure/
    db/                # kysely.ts, pool.ts, types.ts
    events/            # EventBus.ts (pg-boss impl), KyselyAdapter.ts
    http/              # router.ts, server.ts
  index.ts             # wires everything, starts server + boss workers
```

### Versions (current as of 2025)

| Package | Recommended Version | Notes |
|---------|---------------------|-------|
| hono | ^4.6.x | Stable |
| kysely | ^0.28.x | Already in project |
| pg-boss | ^12.x | Already in project |
| pg | ^8.x | Already in project |
| typescript | ^5.x | Already in project |
| @types/pg | ^8.x | Already in project |

### What NOT to use

- **NestJS / Fastify decorators** — too much framework, obscures the DDD pattern
- **EventEmitter (Node built-in)** — in-memory, no durability, defeats the point
- **typeorm / prisma** — conflict with Kysely; Kysely is the choice here
- **class-validator / zod on domain entities** — optional for POC, adds noise
- **Separate event store** — pg-boss IS the event store for this POC

---
*Confidence: High for framework choice. High for event bus approach. Medium for folder structure (varies by taste).*

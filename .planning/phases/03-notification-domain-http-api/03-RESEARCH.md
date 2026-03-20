# Phase 3 Research: Notification Domain + HTTP API

**Phase:** 3 — Notification Domain + HTTP API
**Created:** 2026-03-20
**Source:** Codebase analysis + project research library

---

## What We Need to Know

Phase 3 wires the `NotificationService` handler to the event bus and builds the Elysia HTTP server with working endpoints. The composition root (`index.ts`) must be updated to register the worker at boot and serve HTTP requests.

---

## Existing Codebase Baseline

Everything needed is already wired except:
1. `NotificationService` class — does not exist yet (`src/domains/notification/` is empty)
2. `IEventBus.subscribe()` call for `user.registered` — not wired in `index.ts`
3. Elysia HTTP server — not installed, not started
4. HTTP routes (`POST /users`, `GET /users`) — not defined

**What already works (do not re-implement):**
- `IEventBus` interface — `src/domains/shared/IEventBus.ts`
- `DomainEventMap` — `src/domains/shared/events.ts` (`user.registered` payload: `{ userId, email, name }`)
- `PgBossEventBus.subscribe()` — calls `boss.work(event, async ([job]) => { ... })`
- `UserService.register()` — opens tx, inserts user, publishes `user.registered` (same tx)
- `UserRepository.findAll()` — `kysely.selectFrom("users").select(["id","email","name"]).execute()`
- `createBoss()` — starts boss, creates `user.registered` queue
- `pool`, `kysely` singletons — fully functional

---

## Elysia HTTP Framework

**Requirement is Elysia** (REQUIREMENTS.md explicitly excludes Hono: "User preference: Elysia instead").

### Installation

```bash
bun add elysia
```

Elysia is Bun-first (does not run on Node). It uses `Bun.serve` under the hood. TypeScript-native with no separate type package needed.

### Elysia v1.x API (current stable)

```ts
import { Elysia } from "elysia";

const app = new Elysia()
  .get("/users", async () => {
    // returns array — Elysia serializes to JSON automatically
    return repo.findAll();
  })
  .post("/users", async ({ body, set }) => {
    // body is typed via .body() schema or plain object
    const { email, name } = body as { email: string; name: string };
    const result = await userService.register(email, name);
    set.status = 201;
    return result; // { userId }
  })
  .listen(3000);

console.log(`[http] Elysia server running on port ${app.server?.port}`);
```

**Key Elysia patterns for this project:**
- `set.status = 201` — sets HTTP status code in a route handler
- `.listen(port)` — starts server (Bun.serve internally)
- No separate server start needed — `.listen()` is all that's needed
- Error handling: wrap in try/catch inside handler, `set.status = 400/409`
- Body is `unknown` by default — cast with `as { email: string; name: string }`
- Port from env: `parseInt(process.env.PORT ?? "3000")`

### Elysia Port in index.ts

The Elysia app must be created AFTER services are wired (it closes over `userService` and `userRepo`). Placement in `main()`:

```ts
// After wiring domain services
const app = new Elysia()
  .get("/users", () => userRepo.findAll())
  .post("/users", async ({ body, set }) => {
    const { email, name } = body as { email: string; name: string };
    const result = await userService.register(email, name);
    set.status = 201;
    return result;
  })
  .listen(3000);

console.log(`[http] Server running on port ${app.server?.port}`);
```

---

## NotificationService Design

```ts
// src/domains/notification/NotificationService.ts
import type { DomainEventMap } from "../shared/events.ts";

export class NotificationService {
  async handleUserRegistered(
    payload: DomainEventMap["user.registered"],
  ): Promise<void> {
    console.log(
      `[NotificationService] Sending welcome email to ${payload.email} (userId: ${payload.userId})`,
    );
  }
}
```

**Wiring in index.ts** (after boss/eventBus created, before server starts):

```ts
const notificationService = new NotificationService();
await eventBus.subscribe("user.registered", (payload) =>
  notificationService.handleUserRegistered(payload),
);
console.log("[app] user.registered worker registered.");
```

---

## Updated src/index.ts Boot Sequence

Order matters for the demo sequence:

```
1. setupSchema()           — DB tables exist
2. createBoss()            — pg-boss started, queues created
3. new PgBossEventBus()    — event bus ready
4. new UserRepository()    — repo ready
5. new UserService()       — service ready (needs repo + eventBus)
6. new NotificationService() — handler ready
7. eventBus.subscribe()    — worker registered (picks up jobs)
8. Elysia.listen()         — HTTP server accepting requests
9. console.log("[app] Ready")
```

Console log sequence (DEMO-01 requirement):
- `[UserService] tx opened`
- `[UserService] user INSERT done`
- `[UserService] user.registered job queued (same tx)`
- `[UserService] tx committed`
- `[NotificationService] Sending welcome email to {email} (userId: {userId})`

The async worker fires AFTER the tx commits — this is the core thesis.

---

## HTTP Route Specs

### POST /users
- Input: `{ email: string, name: string }` (JSON body)
- Success: HTTP 201, body `{ "userId": "<uuid>" }`
- Called via: `curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{"email":"test@example.com","name":"Alice"}'`

### GET /users
- Input: none
- Success: HTTP 200, body `[{ "id": "...", "email": "...", "name": "..." }]`
- Called via: `curl http://localhost:3000/users`

---

## Validation Architecture

### Test Infrastructure

**Framework:** `bun test` (built-in)

**Unit tests possible without DB:**
- `NotificationService.handleUserRegistered()` — pure logging, no DB needed
- Test file: `src/domains/notification/NotificationService.test.ts`

**Integration validation (requires running app):**
- `curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{"email":"test@example.com","name":"Alice"}' | grep userId`
- `curl http://localhost:3000/users | grep email`
- Check console logs show full sequence

**TypeScript compilation check:**
```bash
bun build src/index.ts --target bun --outdir /tmp/phase3-check
```

### Verify commands
- `bun test src/domains/notification/ 2>&1` — unit test passes
- `grep -n "NotificationService" src/index.ts` — wired in composition root
- `grep -n "listen" src/index.ts` — Elysia server started
- `grep -n "elysia" package.json` — dependency installed

---

## Critical Pitfalls

1. **Elysia not in package.json** — `bun add elysia` must be run before importing
2. **Worker registration before HTTP** — subscribe BEFORE listen so workers process jobs from tests
3. **Port conflicts** — default 3000, make configurable via `process.env.PORT`
4. **Body typing** — Elysia v1 body is `unknown` without schema validation; safe cast `as { email: string; name: string }` is acceptable for POC
5. **Bun build quirk** — `bun build src/index.ts --outdir /tmp/...` not `bun build src/index.ts` (needs outdir for single entry point too in some Bun versions); use `--outdir /tmp/phase3-check`
6. **Graceful shutdown** — existing `process.on("SIGINT")` must also call `app.stop()` if Elysia exposes it (v1: `app.server?.stop()`)

---

*Research complete. Ready for planning.*

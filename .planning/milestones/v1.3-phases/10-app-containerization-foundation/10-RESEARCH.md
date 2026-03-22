# Phase 10 Research: App Containerization Foundation

**Researched:** 2026-03-22
**Phase:** 10 — App Containerization Foundation
**Requirements:** CONT-01, CONT-02, CONT-03, DOCK-01, DOCK-02, DOCK-03

---

## Executive Summary

This phase has no discovery ambiguity — the STATE.md already captured all key decisions from prior research. Implementation is a series of well-understood file modifications with one non-trivial concern: how Bun handles SIGTERM inside Docker, and ensuring pg-boss workers drain before the pool closes.

---

## Standard Stack (No Decisions Needed)

All technical choices are **locked** in STATE.md:

| Concern | Choice | Source |
|---------|--------|--------|
| Base image | `oven/bun:1.3.11` (both stages) | STATE.md D-v1.3-Phase10 |
| Dockerfile pattern | Multi-stage (install → runtime) | STATE.md D-v1.3-Phase10 |
| DB connection | `DATABASE_URL` env var, fallback to `localhost:15432` | STATE.md D-v1.3-Phase10 |
| Node_modules isolation | devDeps excluded in runtime stage | DOCK-03 |

---

## Architecture Patterns

### 1. Multi-Stage Dockerfile (Confirmed Pattern)

Official Bun docs pattern for `oven/bun:1.3.11` (no `bun build --compile` — not needed since Bun runs TS natively):

```dockerfile
FROM oven/bun:1.3.11 AS install
WORKDIR /app
COPY package.json bun.lock ./
# Dev deps (temp layer)
RUN mkdir -p /temp/dev && cp package.json bun.lock /temp/dev/ && \
    cd /temp/dev && bun install --frozen-lockfile
# Prod deps only
RUN mkdir -p /temp/prod && cp package.json bun.lock /temp/prod/ && \
    cd /temp/prod && bun install --frozen-lockfile --production

FROM oven/bun:1.3.11 AS release
WORKDIR /app
COPY --from=install /temp/prod/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
USER bun
EXPOSE 3000
ENTRYPOINT ["bun", "run", "src/index.ts"]
```

**Why no `bun build --compile`:** Bun runs TypeScript source directly. The Elysia deploy guide recommends binary compilation for production memory savings, but REQUIREMENTS.md explicitly lists `oven/bun:distroless` and compilation as **out of scope** for this POC. The source-copy approach is simpler and sufficient.

### 2. DATABASE_URL Env Var Pattern

Current `pool.ts` hardcodes `postgres://admin:pass@localhost:15432/postgres`. This must support env var override:

```typescript
// src/infrastructure/db/pool.ts
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ??
    "postgres://admin:pass@localhost:15432/postgres",
});
```

**Critical Docker pitfall (from STATE.md):** Inside Docker, `localhost` resolves to the container loopback, not the host. The fallback `localhost:15432` is intentionally preserved for local dev (`docker-compose.postgres.yaml` still runs on host port 15432). When running in Docker, `DATABASE_URL` will be provided by Compose pointing to the `postgres` service name.

`boss.ts` uses the Kysely adapter which consumes `pool` — no separate connection string needed there.

### 3. Health Endpoint

Elysia route addition in `userRoutesPlugin.ts` or a dedicated `healthPlugin.ts`. Simple approach:

```typescript
.get("/health", () => ({ status: "ok" }))
```

Returns `200 OK` with JSON body. No Elysia plugin needed — plain route handler works. Since the health check happens before Compose scales, and Caddy checks it post-start, no pg-boss or pool liveness check is required (keeping it simple — YAGNI for a POC).

### 4. SIGTERM for Graceful Shutdown

**Current state:** `src/index.ts` handles `SIGINT` only. Docker `docker stop` sends **SIGTERM** (not SIGINT). Without SIGTERM handling, Docker kills the container after its 10s timeout with SIGKILL — pg-boss workers get no chance to drain.

**pg-boss `stop()` API (confirmed from source):**
```typescript
boss.stop({ graceful: true, timeout: 30000 }) // default: graceful=true, timeout=30s
```
`stop()` stops polling, waits up to `timeout` ms for in-progress workers to finish (`hasPendingCleanups()`), then calls `failWip()` for any remaining jobs. This is the correct drain mechanism.

**Shutdown order matters:**
1. Stop HTTP server (no new requests)
2. `boss.stop()` — drains pg-boss workers (30s timeout)
3. `pool.end()` — closes pg connection pool

**Implementation pattern:**

```typescript
const shutdown = async (signal: string) => {
  console.log(`[app] Received ${signal}, shutting down...`);
  app.server?.stop();
  await services.decorator.boss.stop();
  await services.decorator.pool.end();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

**Why not Elysia `onStop` hook:** Elysia's lifecycle doesn't have a built-in shutdown hook for SIGTERM. `process.on` is the correct approach and matches the existing SIGINT pattern.

### 5. .dockerignore

Standard exclusions for Bun projects:

```
node_modules
.git
.env
.env.*
*.lock
!bun.lock
docker-compose*.yaml
Dockerfile*
.dockerignore
*.md
```

**Important:** `bun.lock` must NOT be ignored — it's needed in the install stage for `--frozen-lockfile`. Use `!bun.lock` exception if using `*.lock` glob.

---

## Validation Architecture

### Test Strategy

No automated test framework in this codebase (POC). Verification is CLI-based:

| Check | Command | Expected |
|-------|---------|----------|
| DB env var fallback | `bun run src/index.ts` (with local postgres) | Connects successfully |
| Health endpoint | `curl http://localhost:3000/health` | `{"status":"ok"}` + HTTP 200 |
| SIGTERM handling | `kill -SIGTERM <pid>` then check logs | "[app] Received SIGTERM, shutting down..." |
| Docker build | `docker build -t app .` | Exit 0, no errors |
| Docker run | `docker run -e DATABASE_URL=... -p 3000:3000 app` | App starts, `/health` returns 200 |
| Image layers | `docker history app` | Runtime stage has no devDeps |

### Acceptance Criteria (by Requirement)

- **CONT-01**: `pool.ts` contains `process.env["DATABASE_URL"] ??`
- **CONT-02**: `GET /health` returns HTTP 200 (curl confirms)
- **CONT-03**: `src/index.ts` contains `process.on("SIGTERM",`
- **DOCK-01**: `Dockerfile` first line is `FROM oven/bun:1.3.11`
- **DOCK-02**: `.dockerignore` contains `node_modules`, `.git`, `.env`
- **DOCK-03**: Runtime stage copies from `/temp/prod/node_modules` (production only)

---

## Common Pitfalls

| Pitfall | Mitigation |
|---------|-----------|
| `localhost` in DATABASE_URL inside Docker | Fallback only for local dev; Docker always uses env var |
| SIGKILL before drain | SIGTERM handler calls `boss.stop()` before `process.exit(0)` |
| devDeps in runtime image | Two-stage install: `/temp/dev` vs `/temp/prod` |
| `bun.lock` excluded in dockerignore | Add `!bun.lock` exception |
| Health route 404 in plugin | Add route to `userRoutesPlugin` or separate plugin before `listen()` |

---

## File Modification Map

| File | Change | Requirement |
|------|--------|-------------|
| `src/infrastructure/db/pool.ts` | `DATABASE_URL` env var with fallback | CONT-01 |
| `src/plugins/userRoutesPlugin.ts` | Add `GET /health` route | CONT-02 |
| `src/index.ts` | Add SIGTERM handler alongside SIGINT | CONT-03 |
| `Dockerfile` (new) | Multi-stage Bun image | DOCK-01, DOCK-03 |
| `.dockerignore` (new) | Exclude node_modules, .git, .env | DOCK-02 |

Total: 3 modified files, 2 new files. Simple, low-risk phase.

---

## ## RESEARCH COMPLETE

All technical questions answered. No blockers. Planning can proceed with:
- 2 plans: Plan 01 (app code changes: CONT-01, CONT-02, CONT-03) + Plan 02 (Docker artifacts: DOCK-01, DOCK-02, DOCK-03)
- All plans autonomous (no external services, no human-action checkpoints)
- Wave 1: Plan 01 and Plan 02 are independent — can run parallel (different files)

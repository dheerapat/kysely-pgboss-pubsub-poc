# Pitfalls Research

**Domain:** Containerizing a Bun/Elysia/pg-boss event-driven app with Docker Compose replicas and Caddy load balancing
**Researched:** 2026-03-22
**Confidence:** HIGH — pg-boss advisory lock behavior verified from official docs; Caddy health check behavior from official docs; Docker Compose startup ordering from official docs; Bun Docker from official bun.sh guide

---

## Critical Pitfalls

### Pitfall 1: pg-boss `start()` schema race on simultaneous boot — NOT actually dangerous

**What goes wrong:**
6 replicas start simultaneously. All 6 call `boss.start()` at roughly the same time. First instinct is to fear a schema creation race where two instances try to `CREATE TABLE` the pgboss schema simultaneously and one crashes.

**Why it matters:**
This concern is real for *most* libraries, and teams add workarounds like "only the first pod runs migrations". For pg-boss, this is NOT needed — but not knowing this leads to over-engineered migration init containers.

**How to avoid:**
**Do nothing special.** pg-boss `start()` wraps all schema creation and migrations in `pg_advisory_xact_lock()`. From the official docs:

> "All schema operations, both first-time provisioning and migrations, are nested within advisory locks to prevent race conditions during `start()`. ... One example of how this is useful would be including `start()` inside the bootstrapping of a pod in a ReplicaSet in Kubernetes."

This is explicitly designed for multi-master use. All 6 instances can call `start()` concurrently — the advisory lock serializes schema work, and the others wait and then discover schema already installed.

**Warning signs:**
Any `ERROR: relation "pgboss.version" already exists` or similar DDL errors indicate your pg driver or connection string is NOT pointing at the same Postgres, or schema isolation is misconfigured.

**Phase to address:**
Dockerfile + Compose phase — document this explicitly so the reader understands they don't need a schema migration init container.

---

### Pitfall 2: Hardcoded `localhost:15432` connection string breaks inside Docker

**What goes wrong:**
`src/infrastructure/db/pool.ts` currently has:
```typescript
export const pool = new Pool({
  connectionString: "postgres://admin:pass@localhost:15432/postgres",
});
```
`localhost` resolves to the container itself inside Docker. The port `15432` is the *host-machine* port mapping. Inside the Docker network, Postgres is reachable at the service name (e.g., `postgres`) on port `5432`. The app will fail with `ECONNREFUSED` on every connection attempt.

**Why it happens:**
The hardcoded string works fine for local dev (outside Docker) because `localhost:15432` maps to the Postgres container via the host port. Inside Docker Compose, containers communicate via service DNS names on container-internal ports.

**How to avoid:**
Replace the hardcoded string with an environment variable:
```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://admin:pass@localhost:15432/postgres",
});
```
In `docker-compose.yml`, set:
```yaml
environment:
  DATABASE_URL: postgres://admin:pass@postgres:5432/postgres
```
The service name `postgres` (or whatever the Compose service is named) resolves via Docker's internal DNS. Port `5432` is the container-internal Postgres port.

The same applies to `src/infrastructure/events/boss.ts` — if `PgBoss` receives a separate connection string or connection options, those must also be environment-variable-driven. In this codebase, `boss.ts` passes `{ db: new KyselyAdapter(kysely) }`, so the pool is the single source of truth — only the pool's connection string needs changing.

**Warning signs:**
- App container logs: `ECONNREFUSED 127.0.0.1:15432` or `ECONNREFUSED ::1:15432`
- App exits immediately after `docker compose up`
- `docker compose logs app` shows connection errors before any pg-boss logs

**Phase to address:**
Dockerfile + Compose phase — this is the first thing to fix before any pg-boss or Caddy concerns.

---

### Pitfall 3: `pg.Pool` connection exhaustion with 6 replicas sharing one Postgres

**What goes wrong:**
With the default `max` pool size of 10 per `pg.Pool` instance, 6 replicas create up to 60 simultaneous connections to one Postgres. Each pg-boss instance also opens its own internal connections for maintenance and monitoring (the `supervise` loop). During boot, all 6 instances call `start()` simultaneously, spiking connection demand further.

Postgres's default `max_connections` is 100. With 6 replicas × 10 pool connections = 60, plus pg-boss maintenance connections, you risk hitting the limit under load — or definitely if tests or the CI pipeline also connects.

**Why it happens:**
`new Pool({ max: 10 })` is the pg default. Teams don't think about `max_connections` until they see `sorry, too many clients already` errors in production.

**How to avoid:**
Calculate: `6 replicas × max_pool_size ≤ postgres_max_connections - headroom`. For a development/POC setup with `max_connections=100`, use `max: 5` per pool (6 × 5 = 30, leaving 70 for maintenance, tools, and pg-boss internal connections).

In `pool.ts`:
```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "5"),
});
```

For production multi-replica setups, use PgBouncer (connection pooler) between the app and Postgres. For this POC, `max: 5` is sufficient.

The pg-boss `max` constructor option separately controls pg-boss's own internal pool. When using `{ db: KyselyAdapter }` (as this codebase does), pg-boss doesn't manage its own pool — it routes through yours. This is already handled correctly.

**Warning signs:**
- Postgres logs: `FATAL: sorry, too many clients already`
- App logs: `Error: Connection terminated unexpectedly` or `remaining connection slots are reserved`
- Replica pods failing readiness checks intermittently

**Phase to address:**
Dockerfile + Compose phase — set `DB_POOL_MAX` environment variable. Document the math.

---

### Pitfall 4: Caddy health checks failing before pg-boss finishes boot sequence

**What goes wrong:**
Caddy's `health_uri /health` starts polling immediately after the app container reports as running. The app's boot sequence is:
1. `setupSchema()` (creates users table)
2. `createBoss()` → `boss.start()` (schema provision + start)
3. `createWorkersPlugin()` (queue creation + subscription registration)
4. `app.listen(PORT)` ← **HTTP starts here, health check accessible**

If Caddy sends a health check before step 4 completes (which takes several seconds for pg-boss initialization), it gets `ECONNREFUSED` and marks the backend as down. Depending on `health_fails` and `health_interval`, this can mean Caddy marks a replica permanently unhealthy even after it's ready.

With the existing architecture (`.listen()` comes AFTER all workers register), the health endpoint is unavailable during boot — which is **correct behavior** but requires Caddy to tolerate initial failures.

**Why it happens:**
Default Caddy active health check: `health_fails: 1` (one failure = marked unhealthy), `health_interval: 30s`. If the app takes 5 seconds to boot and Caddy polls at second 3, one failure can mark it down with default settings.

**How to avoid:**
Configure Caddy with:
```
health_uri /health
health_interval 10s
health_passes 1
health_fails 3
health_timeout 5s
```
`health_fails 3` means the backend must fail 3 consecutive checks before being marked unhealthy. This gives ~20-30 seconds of tolerance — ample time for pg-boss to boot.

Additionally, set `health_passes 1` (one successful check restores health) so backends come online quickly once ready.

In Docker Compose, add a `depends_on` with `service_healthy` condition on the Caddy service so it doesn't even start until the app containers report healthy — though this requires an app-level healthcheck in the Compose service definition.

**Warning signs:**
- `docker compose logs caddy` shows upstream health failures at startup
- Caddy logs: `upstream marked as unhealthy` shortly after start
- `GET /health` works via `curl` but Caddy still shows 502

**Phase to address:**
Caddy configuration phase — set `health_fails 3` or higher; document the timing contract.

---

### Pitfall 5: Docker Compose `depends_on: postgres` only waits for container start, not Postgres readiness

**What goes wrong:**
```yaml
depends_on:
  - postgres
```
This only waits for the Postgres container to *start*, not for PostgreSQL to be ready to accept connections. The Postgres process takes 1-3 seconds after container start to initialize. The app container starts, tries to connect, gets `ECONNREFUSED` or `connection refused`, and crashes before pg-boss `start()` completes.

With `restart: unless-stopped`, the app will retry — but this creates log noise and a flapping startup that's confusing in development.

**Why it happens:**
`depends_on` in Docker Compose does not understand application-level readiness. It's a container lifecycle signal only.

**How to avoid:**
Use `depends_on` with `condition: service_healthy` and add a healthcheck to the Postgres service:
```yaml
services:
  postgres:
    image: postgres:17
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  app:
    depends_on:
      postgres:
        condition: service_healthy
```

This ensures Postgres is accepting connections before any app replica starts.

**Warning signs:**
- App container logs: `Error: Connection terminated unexpectedly` within first 2 seconds
- Rapid restart loops in `docker compose up` output
- `pg-boss started` log never appears on first startup

**Phase to address:**
Docker Compose phase — add Postgres healthcheck; update `depends_on` condition.

---

### Pitfall 6: `createQueue` + `subscribe` idempotency — safe by design, but understand why

**What goes wrong:**
All 6 instances simultaneously call `boss.createQueue(queueName)` and `boss.subscribe(event, queueName)` during the workers boot phase. If these are not idempotent, you get errors or duplicate subscriptions.

**Reality check (HIGH confidence from pg-boss official docs):**
- `createQueue()` uses `INSERT ... ON CONFLICT DO NOTHING` — idempotent, no error on duplicate
- `subscribe()` also upserts the subscription record — idempotent
- The `pgboss.subscription` table stores `(event, queue_name)` pairs; pg-boss deduplicates fan-out targets when publishing

So 6 instances all subscribing `"notification.user.registered"` to `"user.registered"` results in one subscription row, not 6. No job duplication from the subscription layer.

**What IS a concern:**
If each instance registers its own polling `work()` loop against the same queue, all 6 workers compete to process jobs from that queue. This is **intentional and safe** — pg-boss uses `SELECT ... FOR UPDATE SKIP LOCKED` to ensure exactly-once delivery across competing workers. No job will be processed twice.

**How to avoid:**
Nothing special needed — but verify logs show only one `[infra] Subscription registered:` line per event type in steady state (subsequent instances will upsert silently).

**Warning signs:**
- If you see a job handler fire more than once for a single event, it indicates the queue subscription was registered twice with different queue names (a naming convention bug, not a pg-boss bug)
- Multiple rows in `pgboss.subscription` for the same `(event, queue_name)` pair (indicates a pg-boss internal bug — should not happen)

**Phase to address:**
Testing/verification phase — confirm exactly-once delivery under 6 replicas via `POST /users` smoke test.

---

### Pitfall 7: Multi-stage Dockerfile — production stage missing source files or wrong entry point

**What goes wrong:**
The official Bun Docker guide shows a multi-stage build where only `index.ts` and `node_modules` are copied to the final stage. This codebase has:
```
index.ts         ← top-level entry point
src/             ← all TypeScript source
```

If the final Docker stage only copies `index.ts` and not `src/`, the app crashes at runtime with `Cannot find module './src/...'`.

Additionally, `genMockUser.ts` (a dev-only script in the project root) must NOT be included in the production image — it's not needed and may import dev dependencies.

**Why it happens:**
Copy-pasting the Bun official Dockerfile example (which assumes a single-file app) without adapting for a multi-file TypeScript project with a `src/` tree.

**How to avoid:**
In the final release stage, copy:
```dockerfile
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/index.ts .
COPY --from=prerelease /usr/src/app/src ./src
COPY --from=prerelease /usr/src/app/package.json .
USER bun
EXPOSE 3000/tcp
ENTRYPOINT ["bun", "run", "index.ts"]
```

Do NOT run `bun run build` unless you have a `build` script configured — Bun executes TypeScript directly, so no compilation step is needed.

Also add a `.dockerignore` to prevent `node_modules`, `.git`, `docker-compose*`, and `.env` from being copied into the build context.

**Warning signs:**
- Build succeeds but container exits immediately with `Error: Cannot find module './src/plugins/servicesPlugin'`
- Image size is unexpectedly large (node_modules included in final stage from host)

**Phase to address:**
Dockerfile phase — this is the first deliverable.

---

### Pitfall 8: `bun.lock` lockfile filename and format must match Dockerfile

**What goes wrong:**
The official Bun Dockerfile uses `bun install --frozen-lockfile` which requires `bun.lock`. If the `COPY` instruction references the wrong filename (e.g., `bun.lockb` from older Bun versions), the build fails.

Current Bun version (1.x) uses `bun.lock` (text format). The project already has `bun.lock` (confirmed in directory listing). Mixing `npm install` or `npm ci` with the `oven/bun` image is also wrong.

**How to avoid:**
Use exact filenames in the Dockerfile COPY:
```dockerfile
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile
```

Do NOT mix `npm install` with `oven/bun` image.

**Warning signs:**
- Docker build fails at `bun install --frozen-lockfile` with `No lockfile found`
- Build succeeds but uses a different version of a dependency than local dev

**Phase to address:**
Dockerfile phase — verify with `docker build .` locally before moving to Compose.

---

### Pitfall 9: `PORT` environment variable and host port conflicts with Compose replicas

**What goes wrong:**
With `deploy.replicas: 6`, Docker Compose assigns container-internal ports but does NOT automatically configure each replica on a different port. The app listens on `PORT` (defaulting to 3000). All 6 replicas listen on port 3000 internally — this is correct. But if `ports:` is specified in the Compose service (e.g., `"3000:3000"`), only one replica can bind the host port, and the others fail.

Caddy must route to replicas by their internal Docker Compose addresses, not via host-mapped ports.

**Why it happens:**
Instinct to add `ports: "3000:3000"` for debugging. With `deploy.replicas`, port mapping causes conflicts.

**How to avoid:**
Do NOT add `ports:` to the app service in Compose when using replicas. Caddy accesses the app containers through Docker's internal network using the service name. Docker Compose with `deploy.replicas` and a named service exposes all replicas under the service's DNS name via round-robin or load-balanced DNS.

Caddy config should use:
```
reverse_proxy app:3000
```
Where `app` is the Compose service name. Docker's embedded DNS resolves `app` to all replica IPs.

If you need to access an individual replica for debugging, use `docker compose exec` or a separate debug port on a single-replica service.

**Warning signs:**
- `docker compose up` shows errors: `Bind for 0.0.0.0:3000 failed: port is already allocated`
- Caddy reaches only one backend (round-robin DNS not working)
- `502 Bad Gateway` on all requests from Caddy

**Phase to address:**
Docker Compose phase — explicitly document that `ports:` must be absent from replicated app service.

---

### Pitfall 10: Secrets and credentials leaking into image layers

**What goes wrong:**
If `DATABASE_URL` with a password is set via `ARG` in the Dockerfile, it bakes the credential into the image layer — visible via `docker history`. Similarly, if `.env` files are committed or copied into the image, credentials are exposed.

**How to avoid:**
- Use `ENV` (not `ARG`) for runtime values that must be set by Compose or the orchestrator
- Never `COPY .env` into any Dockerfile stage
- Add `.env` to `.dockerignore`
- Pass credentials only at runtime via `docker-compose.yml` `environment:` section or Docker secrets

For this POC, plaintext credentials in `docker-compose.yml` are acceptable (dev-only). Production use must use Docker secrets or a secrets manager.

**Warning signs:**
- `docker history <image>` shows database passwords in ENV layers
- `.env` file committed to git alongside Dockerfile

**Phase to address:**
Dockerfile phase — add `.env` to `.dockerignore` immediately.

---

### Pitfall 11: `SIGTERM` not handled — pg-boss workers don't drain on container shutdown

**What goes wrong:**
Docker sends `SIGTERM` to gracefully shut down containers, followed by `SIGKILL` after a timeout (default 10s). The existing `index.ts` handles `SIGINT` (Ctrl+C) but NOT `SIGTERM`. In Docker Compose and Kubernetes, `SIGTERM` is the signal sent by `docker compose stop`, `docker compose down`, and container orchestrators.

Without a `SIGTERM` handler, pg-boss workers don't drain active jobs before exit. Any job currently being processed by a worker will be abandoned, enter retry state (if retries configured), or be marked failed.

**Why it happens:**
Developers test with Ctrl+C locally, which sends `SIGINT`. Docker production environments use `SIGTERM`.

**How to avoid:**
Add `SIGTERM` handling alongside `SIGINT`:
```typescript
const shutdown = async () => {
  console.log("[app] Shutting down...");
  app.server?.stop();
  await services.decorator.boss.stop({ graceful: true, timeout: 25000 });
  await services.decorator.pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

`boss.stop({ graceful: true, timeout: 25000 })` waits up to 25 seconds for active workers to finish (within Docker's 30s kill timeout).

**Warning signs:**
- Jobs appear in `retry` state after `docker compose restart`
- `docker compose down` hangs for 10 seconds before force-killing containers (the SIGKILL timeout)
- No `[app] Shutting down...` log on container stop

**Phase to address:**
Dockerfile/Compose phase — fix shutdown handling before testing replicas.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode `postgres://admin:pass@...` in source | No env var setup needed | Credentials in source; breaks in Docker | Never — move to env var in Dockerfile phase |
| Use `oven/bun:latest` in Dockerfile | Always current | Build breaks on Bun major version bump | POC only; pin to `oven/bun:1.3` for stability |
| Use `postgres:latest` in Compose | Always current Postgres | Schema behavior changes between Postgres major versions | Never in any persistent environment; pin to `postgres:17` |
| Skip Postgres healthcheck in Compose | Simpler config | Flaky startup; app races Postgres init | Never — trivial to add, significant upside |
| `deploy.replicas` without resource limits | Easy horizontal scale demo | Postgres connection exhaustion under load | Acceptable for POC with small pool size |
| Skip `bun test` in Dockerfile prerelease stage | Faster builds | Broken images can be released | Only acceptable if tests run in CI before Docker build |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| pg-boss + Docker replicas | Add migration init container to prevent race | Don't — pg-boss `start()` uses advisory locks; safe for multi-master |
| Caddy + Docker Compose replicas | Use static upstream list per replica IP | Use service DNS name (`app:3000`); Docker resolves to all replicas |
| pg Pool + replicas | Default pool size × replicas exceeds Postgres `max_connections` | Set `max: 5` per pool for 6-replica POC; document the math |
| Bun + Docker | Run `bun build` to compile before serving | Bun executes TypeScript directly; no build step needed (unless targeting Node) |
| Caddy health checks + pg-boss boot | Assume instant health | `health_fails 3` tolerates startup time; pg-boss needs ~2-5s to boot |
| SIGTERM + pg-boss workers | Handle only SIGINT | Handle both; `boss.stop({ graceful: true })` needed for clean worker drain |
| Postgres service name in Compose | Use `localhost` or `127.0.0.1` | Use Compose service name (e.g., `postgres`) — Docker DNS resolves it |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Default pool size (10) × 6 replicas = 60 connections | `sorry, too many clients` Postgres errors under load | `max: 5` per pool for this POC | At any non-trivial load with default Postgres `max_connections: 100` |
| pg-boss monitoring interval (60s default) on 6 instances | 6 concurrent maintenance queries every 60s | Acceptable for POC; increase `superviseIntervalSeconds` if needed | Not a POC concern; matters at high job volume |
| Caddy `lb_policy random` with 6 backends | Uneven distribution during Caddy restarts | `round_robin` for predictable distribution in demos | Not a real perf issue at POC scale |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Hardcoded DB password in pool.ts | Credentials in git history | Move to `DATABASE_URL` env var; add to `.dockerignore` |
| `postgres:latest` with default superuser `admin` | Weak credentials, unpredictable schema changes | Use pinned version; document that `admin`/`pass` are dev-only |
| No `USER bun` in Dockerfile | App runs as root in container | Add `USER bun` before `ENTRYPOINT` (already in official Bun guide) |
| Publishing Docker image with dev dependencies | Larger attack surface | `bun install --production` in final stage (multi-stage handles this) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Postgres connection string:** Uses service name (`postgres:5432`) inside Docker, not `localhost:15432` — verify with `docker compose exec app env | grep DATABASE_URL`
- [ ] **pg-boss multi-instance:** All 6 replicas start without schema creation errors — verify `docker compose logs app | grep "pg-boss started"` shows 6 lines
- [ ] **SIGTERM handling:** Container stops gracefully — verify `docker compose stop` takes < 5s and logs `[app] Shutting down...`
- [ ] **Caddy health check:** All replicas appear healthy after 30s startup window — check `docker compose logs caddy | grep unhealthy`
- [ ] **Job deduplication:** `POST /users` under 6 replicas fires each worker exactly once (not 6 times) — verify notification logs show 1 per event, not 6
- [ ] **Postgres healthcheck in Compose:** App doesn't race Postgres on `docker compose up --build` from scratch — verify first boot succeeds without connection errors
- [ ] **No host port conflict:** `docker compose up` shows no `port is already allocated` errors — app service has no `ports:` mapping
- [ ] **`.dockerignore` in place:** Image doesn't include `node_modules`, `.env`, or `.git` from build context — verify image size is reasonable (< 200MB)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hardcoded connection string | LOW | Add `DATABASE_URL` env var; update pool.ts; redeploy |
| Pool exhaustion hitting Postgres limits | LOW | Set `DB_POOL_MAX=5` env var; restart replicas |
| Caddy marking backend permanently unhealthy | LOW | `docker compose restart caddy`; or increase `health_fails` and redeploy |
| pg-boss schema left in partial state from crashed `start()` | MEDIUM | Connect to DB; `DROP SCHEMA pgboss CASCADE`; restart app (pg-boss recreates on next `start()`) |
| SIGTERM not handled — jobs stuck in active state | MEDIUM | `SELECT * FROM pgboss.job WHERE state='active'`; manually retry or wait for expiration (`expireInSeconds`, default 15 min) |
| 6 replicas all try `ports:` mapping — only 1 starts | LOW | Remove `ports:` from app service in Compose; use Caddy for external access |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hardcoded localhost connection string | Phase 1: Dockerfile | `docker compose up` shows pg-boss started on all replicas |
| Pool exhaustion (6 × default max) | Phase 1: Dockerfile / Compose env vars | No Postgres `too many clients` errors under load |
| SIGTERM not handled | Phase 1: Dockerfile | `docker compose stop` completes < 10s with shutdown logs |
| Multi-stage Dockerfile missing src/ | Phase 1: Dockerfile | Container starts without module resolution errors |
| bun.lock filename mismatch | Phase 1: Dockerfile | `docker build .` completes without lockfile errors |
| Secrets leaking into image layers | Phase 1: Dockerfile | `docker history` shows no plaintext credentials in ENV |
| Postgres healthcheck missing from Compose | Phase 2: Compose | First `docker compose up --build` succeeds without connection races |
| App `depends_on` postgres without healthcheck | Phase 2: Compose | Cold start never shows ECONNREFUSED errors |
| Host port conflicts with replicas | Phase 2: Compose | All 6 replicas start; no `port is already allocated` |
| pg-boss start() race (non-issue — advisory locks) | Phase 2: Compose | All 6 replicas log `pg-boss started` without DDL errors |
| createQueue/subscribe idempotency (safe by design) | Phase 2: Compose | Single subscription row per queue in pgboss.subscription |
| Caddy health check timing | Phase 3: Caddy | All backends healthy within 30s of startup |
| Caddy DNS-based service routing | Phase 3: Caddy | Requests distributed across all 6 replicas (visible in logs) |

---

## Sources

- pg-boss `start()` advisory lock documentation: https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/ops.md — explicitly states multi-master safety via `pg_advisory_xact_lock()`
- pg-boss worker documentation: https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/workers.md — confirms `SKIP LOCKED` for exactly-once delivery across competing workers
- pg-boss constructor options: https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/constructor.md — `max` pool size, `migrate` flag, `supervise` flag
- pg-boss pub-sub API: https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/pubsub.md — `subscribe()` idempotency behavior
- pg-boss introduction: https://raw.githubusercontent.com/timgit/pg-boss/master/docs/introduction.md — multi-master compatible, SKIP LOCKED
- Caddy reverse_proxy active health check documentation: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy — `health_fails`, `health_passes`, `health_interval` options
- Docker Compose startup ordering: https://docs.docker.com/compose/how-tos/startup-order/ — `condition: service_healthy`, Postgres `pg_isready` healthcheck
- Bun Docker guide (official): https://bun.sh/guides/ecosystem/docker — multi-stage Dockerfile, `--frozen-lockfile`, `USER bun`
- Codebase inspection: `src/infrastructure/db/pool.ts` (hardcoded connection string), `src/index.ts` (SIGINT only), `docker-compose.postgres.yaml` (no healthcheck)

---
*Pitfalls research for: Bun/Elysia/pg-boss → Docker Compose 6 replicas + Caddy containerization*
*Researched: 2026-03-22*

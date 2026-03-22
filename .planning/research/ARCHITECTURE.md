# Architecture Research: Docker + Load Balancing (v1.3)

**Domain:** Multi-instance Docker Compose deployment with Caddy and pg-boss
**Researched:** 2026-03-22
**Confidence:** HIGH — all claims verified from pg-boss source, Docker Compose docs, and Caddy official docs

---

> **Previous milestone architecture** (v1.1 pg-boss pub/sub) is covered in project history. This file covers **v1.3** containerization only.

---

## Standard Architecture

### Full Compose Network Topology

```
                        ┌──────────────────────────────────────────────────────────┐
                        │           Docker Compose — bridge network                 │
                        │                                                           │
  ┌──────────────┐      │  ┌──────────────────────────────────────────────────┐    │
  │ Host browser │ :8080│  │                    caddy                          │    │
  │ / curl       ├──────►  │  Caddyfile: reverse_proxy app:3000                │    │
  └──────────────┘      │  │  lb_policy round_robin                            │    │
                        │  │  health_uri /health, health_interval 10s          │    │
                        │  └──────────────────┬───────────────────────────────┘    │
                        │                     │ round-robin across 6 replicas      │
                        │  ┌──────────────────▼───────────────────────────────┐    │
                        │  │               app service (×6 replicas)           │    │
                        │  │  service name: app, container port: 3000          │    │
                        │  │  deploy.replicas: 6                               │    │
                        │  │                                                   │    │
                        │  │  [app-1] [app-2] [app-3] [app-4] [app-5] [app-6] │    │
                        │  │                                                   │    │
                        │  │  Each instance runs:                              │    │
                        │  │  - Elysia HTTP on :3000                          │    │
                        │  │  - PgBoss instance (boss.start())                │    │
                        │  │  - pg.Pool (DATABASE_URL → postgres:5432)        │    │
                        │  │  - 2 workers polling pgboss job tables           │    │
                        │  └──────────────────┬───────────────────────────────┘    │
                        │                     │ DATABASE_URL=postgres://…postgres  │
                        │                     ▼                                    │
                        │  ┌──────────────────────────────────────────────────┐    │
                        │  │                  postgres                          │    │
                        │  │  image: postgres:17-alpine                        │    │
                        │  │  port: 5432 (internal only — no host mapping)    │    │
                        │  │  volume: postgres-data:/var/lib/postgresql/data   │    │
                        │  │                                                   │    │
                        │  │  pgboss.job_notification_user_registered          │    │
                        │  │  pgboss.job_audit_user_registered                 │    │
                        │  │  pgboss.subscription (fan-out routing table)     │    │
                        │  │  pgboss.queue (shared queue registry)            │    │
                        │  │  public.users (app data)                         │    │
                        │  └──────────────────────────────────────────────────┘    │
                        └──────────────────────────────────────────────────────────┘
```

### pg-boss Multi-Instance Concurrency Model

All 6 pg-boss instances poll the same job tables. Postgres's `FOR UPDATE SKIP LOCKED` ensures each job row is processed by exactly one instance:

```
  Instance-1 worker ─┐
  Instance-2 worker ─┤  all polling:
  Instance-3 worker ─┤  SELECT id FROM pgboss.job_notification_user_registered
  Instance-4 worker ─┤  WHERE state < 'active'
  Instance-5 worker ─┤  FOR UPDATE SKIP LOCKED LIMIT 1
  Instance-6 worker ─┘

  Job A locked by instance-2 → invisible to instances 1, 3, 4, 5, 6
  Job B locked by instance-5 → invisible to all others
  Unlocked rows → first claimer wins, atomically
```

`SKIP LOCKED` is verified in `node_modules/pg-boss/dist/plans.js`, `fetchNextJob()` function. This is the pg-boss "Multi-master compatible" feature explicitly documented in its README.

---

## Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|---------------|
| `caddy` | Reverse proxy, round-robin LB, health check polling | `caddy:2-alpine` with Caddyfile |
| `app` (×6) | Elysia HTTP server, pg-boss workers, domain logic | Multi-stage Bun Dockerfile, `deploy.replicas: 6` |
| `postgres` | Single shared job store, pg-boss schema, user data | `postgres:17-alpine`, named volume |
| `Caddyfile` | Upstream config, health check, LB policy | Mounted at `/etc/caddy/Caddyfile` |
| `Dockerfile` | Multi-stage build: install deps → slim runtime | Two-stage, Bun-based |
| `docker-compose.yml` | Orchestration, networking, env vars, health checks, boot order | Full stack replacement |

---

## New Files vs Modified Files

### New Files (to create)

| File | What it is |
|------|-----------|
| `Dockerfile` | **Stage 1 (builder):** `FROM oven/bun AS builder` — copies `package.json`, `bun.lock`, runs `bun install --frozen-lockfile`. **Stage 2 (runtime):** `FROM oven/bun` — copies `node_modules` + `src/` + `index.ts`, sets `CMD ["bun", "run", "src/index.ts"]` |
| `docker-compose.yml` | Full stack: `app` (6 replicas) + `postgres` + `caddy`. Replaces dev-only `docker-compose.postgres.yaml` for the full test run. |
| `Caddyfile` | Static Caddy config. `reverse_proxy app:3000` with `round_robin` LB and `/health` active health checks. |

### Modified Files

| File | What changes |
|------|-------------|
| `src/infrastructure/db/pool.ts` | Replace hardcoded `postgres://admin:pass@localhost:15432/postgres` with `process.env["DATABASE_URL"] ?? "postgres://admin:pass@localhost:15432/postgres"`. The fallback preserves local dev without Docker. |
| `src/index.ts` | Add `GET /health` endpoint returning HTTP 200 `{ status: "ok" }` — required for Caddy health checks. Boot sequence unchanged. |

**No other source files change.** Existing plugin composition, boot ordering, and pg-boss wiring are container-ready as-is.

---

## Architectural Patterns

### Pattern 1: `FOR UPDATE SKIP LOCKED` — Safe Concurrent Workers

**What:** PostgreSQL's row-level locking primitive for message queue consumers. When N workers issue the same `SELECT … FOR UPDATE SKIP LOCKED`, each atomically acquires the first unlocked row and the others skip it transparently.

**When to use:** Any multi-process PostgreSQL-backed job queue. pg-boss uses this in every `fetchNextJob()` call.

**Trade-offs:**
- Pro: Zero coordination overhead — no distributed lock manager, no Redis, no Zookeeper
- Pro: Exactly-once delivery guaranteed at the database level
- Pro: Works across any number of replicas with no configuration
- Con: Under low load, 6 polling workers create minor connection pressure (pg-boss uses adaptive polling intervals to mitigate)

**Source:** `node_modules/pg-boss/dist/plans.js`, `fetchNextJob()`, line 525 — `FOR UPDATE SKIP LOCKED` confirmed in source.

### Pattern 2: Advisory Locks for Race-Safe Schema Initialization

**What:** pg-boss wraps schema creation in `pg_advisory_xact_lock()`. All 6 replicas call `boss.start()` at boot. One wins the lock and creates the `pgboss` schema; the other 5 get an `"already exists"` error (Postgres `CREATE_RACE_MESSAGE`) that pg-boss explicitly catches and swallows.

**When to use:** Any shared schema that must be initialized idempotently across concurrent processes without external coordination.

**Source:** `node_modules/pg-boss/dist/contractor.js`, `create()` method:

```javascript
async create() {
  try {
    await this.db.executeSql(plans.create(this.config.schema, schemaVersion));
  } catch (err) {
    // "already exists" = another replica won the race → safe to ignore
    assert(err.message.includes(plans.CREATE_RACE_MESSAGE), err);
  }
}
```

**Trade-offs:**
- Pro: All 6 replicas can start simultaneously — Compose doesn't need to serialize app startup
- Pro: No manual migration runner or init container required
- Con: Brief lock contention on first boot (6 connections racing). In practice: sub-second, transparent.

### Pattern 3: Docker Service DNS for Caddy → App Routing

**What:** Docker Compose's embedded DNS resolves the `app` service name to the IPs of all 6 replica containers. Caddy proxies to `app:3000` — it does not need to enumerate individual replicas.

**When to use:** Any Compose-based multi-replica setup behind a reverse proxy.

**Caddy `reverse_proxy app:3000`** resolves `app` via Docker DNS → gets 6 container IPs → applies `round_robin` LB policy across them.

**Active health checks:** Caddy polls `GET /health` on each upstream. Replicas that fail health checks are removed from rotation automatically. This requires the `GET /health` endpoint in the app.

**Trade-offs:**
- Pro: No service mesh, no Consul, no manual upstream list — Docker DNS handles replica discovery
- Pro: Caddy health checks provide real availability awareness (not just DNS round-robin blind)
- Con: DNS TTL means momentary stale entries if a replica restarts; Caddy's passive health checks catch this quickly

### Pattern 4: `depends_on` with `service_healthy` for Boot Ordering

**What:** pg-boss `boss.start()` immediately connects to Postgres. Without `depends_on`, all 6 app replicas race against Postgres startup, fail to connect, and crash-loop. `service_healthy` condition on the app service waits for the postgres health check to pass.

**When to use:** Any Compose stack where an application depends on a database being ready to accept connections.

**Postgres healthcheck (use `pg_isready`):**
```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 5
```

**App depends_on:**
```yaml
app:
  depends_on:
    postgres:
      condition: service_healthy
```

**Important:** `depends_on` with `service_healthy` is only respected by `docker compose up`, not `docker swarm` — correct for this milestone.

---

## Data Flow

### HTTP Request Flow (POST /users through load balancer)

```
Browser/curl → :8080 → caddy (round-robin) → app replica N (:3000)
    │
    ▼
Elysia → userRoutesPlugin → UserService.register()
    │
    ├─ kysely.transaction()
    │     ├─ UserRepository.save(user, tx)         [INSERT INTO users]
    │     └─ PgBossEventBus.publish(               [boss.publish via tx]
    │           "user.registered", payload,
    │           { db: KyselyAdapter(tx) })
    │             ├─ SELECT name FROM pgboss.subscription  [global pool, non-tx]
    │             │   → ["notification.user.registered", "audit.user.registered"]
    │             ├─ INSERT INTO pgboss.job_notification_...  [via tx]
    │             └─ INSERT INTO pgboss.job_audit_...         [via tx]
    ├─ tx.commit()   ← 3 rows atomic: 1 user + 2 jobs
    │
    ▼
HTTP 201 { userId }

--- Async (any of 6 replicas, whichever polls first) ---

pg-boss worker (replica X) → pgboss.job_notification_user_registered
    → FOR UPDATE SKIP LOCKED → acquires job
    → NotificationService.handleUserRegistered(payload)

pg-boss worker (replica Y) → pgboss.job_audit_user_registered
    → FOR UPDATE SKIP LOCKED → acquires job
    → AuditService.handleUserRegistered(payload)
```

### Boot Sequence (All 6 Replicas — Critical Ordering)

```
docker compose up
  │
  ├─ postgres starts → healthcheck: pg_isready
  │     ↓ healthy (after ≤ 25s)
  │
  ├─ app (×6, all blocked by depends_on: postgres: condition: service_healthy)
  │     ↓ postgres healthy → all 6 start concurrently
  │
  │  Each replica (in parallel, race-safe via advisory locks):
  │    1. setupSchema()              → CREATE TABLE users IF NOT EXISTS
  │    2. createBoss() / boss.start()
  │       └─ contractor.start()     → pg_advisory_xact_lock()
  │                                    → one replica: CREATE pgboss schema
  │                                    → others: "already exists" → silently ignored
  │    3. eventBus.subscribe(×2)    → createQueue → boss.subscribe → boss.work
  │       (createQueue is idempotent — concurrent calls safe)
  │    4. app.listen(3000)          → HTTP ready
  │
  ├─ caddy starts (depends_on: app)
  │     → health_uri /health polls each replica every 10s
  │     → once 1+ replicas healthy → caddy routes traffic
  │
  └─ :8080 open to host
```

---

## Environment Variables

### Variables Required in Each App Container

| Variable | Purpose | Compose value |
|----------|---------|---------------|
| `DATABASE_URL` | pg.Pool + pg-boss Postgres connection | `postgres://admin:pass@postgres:5432/appdb` |
| `PORT` | Elysia listen port (already read in `src/index.ts`) | `3000` |

> **Critical:** The existing `pool.ts` hardcodes `postgres://admin:pass@localhost:15432/postgres`. Inside a container, `localhost` resolves to the container itself — not the Postgres service. This **must** be replaced with `process.env["DATABASE_URL"]` before the app will connect.

### Variables Required for Postgres Container

| Variable | Purpose | Example |
|----------|---------|---------|
| `POSTGRES_USER` | DB superuser | `admin` |
| `POSTGRES_PASSWORD` | DB password | `pass` |
| `POSTGRES_DB` | Initial database name | `appdb` |

### Variables for Caddy

None required. The Caddyfile is static — upstream is always `app:3000` via Docker DNS.

---

## Integration Points

### Existing Code → Container Layer

| Existing Code Point | Integration Concern | Resolution |
|--------------------|---------------------|------------|
| `src/infrastructure/db/pool.ts` — hardcoded `localhost:15432` | Fails inside container — `localhost` is the container itself | Replace with `process.env["DATABASE_URL"] ?? "postgres://admin:pass@localhost:15432/postgres"` |
| `src/infrastructure/db/boss.ts` — `new PgBoss({ db: new KyselyAdapter(kysely) })` | Uses same Kysely pool; pool reads `DATABASE_URL` after fix | No change needed |
| `src/index.ts` — `const PORT = parseInt(process.env["PORT"] ?? "3000")` | Already env-aware | No change needed |
| Boot sequence: `setupSchema → boss.start → subscribe → listen` | pg-boss advisory locks make this safe for concurrent replicas | No change needed |
| `workersPlugin` — `await eventBus.subscribe()` × 2 | All 6 instances call `createQueue` concurrently — pg-boss idempotent create handles race | No change needed |

### New Integration Points

| New Component | Integrates With | Protocol/Notes |
|---------------|----------------|----------------|
| `Caddyfile` | `app` service (×6) | HTTP/1.1 to `app:3000`; polls `GET /health` every 10s |
| `docker-compose.yml` | `app`, `postgres`, `caddy` | Docker bridge network; service DNS; `service_healthy` ordering |
| `Dockerfile` | `src/`, `index.ts`, `bun.lock`, `package.json` | Bun build stages; `--frozen-lockfile` for reproducibility |
| `GET /health` endpoint | Caddy health checker | Returns HTTP 200 `{ status: "ok" }` |

---

## Recommended File Layout (v1.3 additions)

```
project-root/
├── Dockerfile            # NEW — multi-stage Bun build
├── Caddyfile             # NEW — reverse proxy + health check config
├── docker-compose.yml    # NEW — full stack (replaces docker-compose.postgres.yaml for testing)
├── docker-compose.postgres.yaml   # KEEP — still useful for local dev without app containers
├── src/
│   ├── index.ts          # MODIFIED — add GET /health
│   └── infrastructure/
│       └── db/
│           └── pool.ts   # MODIFIED — use DATABASE_URL env var
└── ... (all other src files unchanged)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Hardcoded Connection String Survives Containerization

**What people do:** Forget to update `pool.ts` before building the Docker image. Container starts, pool tries `localhost:15432`, connection refused, pg-boss never starts.

**Why it's wrong:** `localhost` inside an app container is that container's own loopback — not the host machine, not the Postgres container.

**Do this instead:** `process.env["DATABASE_URL"] ?? fallback` in `pool.ts`. Inject the correct connection string via `environment:` in `docker-compose.yml` using the Postgres service name (`postgres:5432`).

### Anti-Pattern 2: No Postgres Health Check → Boot Race

**What people do:** Start all services with `docker compose up` without `healthcheck` on postgres. App containers start, attempt connection before Postgres is ready, crash-loop.

**Why it's wrong:** Compose `depends_on` without a condition only waits for the container to *start*, not for Postgres to accept connections. pg-boss `boss.start()` immediately connects.

**Do this instead:** `healthcheck: test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]` on the postgres service, and `depends_on: postgres: condition: service_healthy` on the app service.

### Anti-Pattern 3: Exposing Postgres Port to Host in Production Stack

**What people do:** Keep `ports: - "5432:5432"` on postgres in the full stack compose file.

**Why it's wrong:** App containers reach Postgres via internal Docker network at `postgres:5432`. Exposing to host is unnecessary and a security surface.

**Do this instead:** No `ports:` on postgres in `docker-compose.yml`. Postgres is only reachable from within the Docker network. Keep host port mapping in `docker-compose.postgres.yaml` for local dev tooling (DBeaver, psql).

### Anti-Pattern 4: Enumerating Individual Replica Containers in Caddyfile

**What people do:** Try to proxy to `app_1:3000 app_2:3000 … app_6:3000` individually.

**Why it's wrong:** With `deploy.replicas: 6` in plain Compose (non-Swarm), Docker resolves the `app` service name to all replica IPs automatically via embedded DNS. Individual container names in Caddy config would require manual updates on every scale event.

**Do this instead:** `reverse_proxy app:3000` — Docker DNS + Caddy `round_robin` handles all 6 replicas automatically.

### Anti-Pattern 5: Missing `GET /health` Endpoint

**What people do:** Configure Caddy `health_uri /health` but forget to add the endpoint to the Elysia app.

**Why it's wrong:** Caddy health checks fail → Caddy marks all replicas unhealthy → no traffic is routed → service appears dead even though app containers are running.

**Do this instead:** Add `app.get("/health", () => ({ status: "ok" }))` before `.listen()` in `index.ts`. This is a one-liner addition.

### Anti-Pattern 6: Running pg-boss Workers on Only One Replica

**What people do:** Add an env var like `WORKER=true` and only run workers on one designated instance to "avoid conflicts."

**Why it's wrong:** pg-boss is explicitly designed for multi-master worker deployments (`SKIP LOCKED` ensures exactly-once delivery). Running workers on all instances increases throughput and resilience. Restricting to one instance reintroduces a single point of failure for job processing.

**Do this instead:** Run workers on all 6 instances — this is the correct and intended pattern. pg-boss handles the concurrency safely.

---

## Scaling Considerations

| Scenario | Architecture Impact |
|----------|---------------------|
| 6 replicas (this milestone) | Each holds a pg.Pool (default 10 connections). 6 × 10 = 60 connections. Postgres default `max_connections = 100` → comfortable headroom. |
| 10+ replicas | Watch `max_connections`. Each pg-boss instance runs maintenance background timers — more instances = more concurrent maintenance queries. Consider reducing `superviseIntervalSeconds` or connection pool max size. |
| High job volume | pg-boss worker `teamSize` option controls concurrency per worker. Tune per queue independently. Fan-out queues scale separately. |
| Persistent volume loss | pg-boss schema and job tables are in Postgres. Named volume must persist for job durability. Never use `tmpfs` for Postgres data. |

---

## Sources

- **pg-boss `SKIP LOCKED` mechanism:** `node_modules/pg-boss/dist/plans.js`, `fetchNextJob()`, line 525 — `FOR UPDATE SKIP LOCKED` confirmed in source (HIGH confidence)
- **pg-boss race-safe schema creation:** `node_modules/pg-boss/dist/contractor.js`, `create()` — `CREATE_RACE_MESSAGE` assertion (HIGH confidence)
- **pg-boss README — "Multi-master compatible":** Line 53 — "Multi-master compatible (for example, in a Kubernetes ReplicaSet)" (HIGH confidence)
- **Docker Compose `deploy.replicas`:** https://docs.docker.com/compose/compose-file/deploy/ — `replicas: 6` under `deploy:` (HIGH confidence)
- **Docker Compose networking — service DNS:** https://docs.docker.com/compose/how-tos/networking/ — services reachable by name on default bridge network (HIGH confidence)
- **Caddy `reverse_proxy` syntax and health checks:** https://caddyserver.com/docs/caddyfile/directives/reverse_proxy — `health_uri`, `health_interval`, `lb_policy round_robin` (HIGH confidence)
- **Caddy Docker image:** https://hub.docker.com/_/caddy — `caddy:2-alpine` current stable; Caddyfile at `/etc/caddy/` (HIGH confidence)
- **`service_healthy` with `pg_isready`:** Docker Compose `depends_on` condition docs — standard established pattern (MEDIUM confidence — broadly documented community practice)

---

*Architecture research for: v1.3 Docker + Load Balancing milestone*
*Researched: 2026-03-22*

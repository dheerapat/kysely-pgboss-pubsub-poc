# Feature Research

**Domain:** Docker containerization + horizontal scaling for Bun/Elysia/pg-boss app (v1.3 milestone)
**Researched:** 2026-03-22
**Confidence:** HIGH (all findings verified against official documentation)

---

## Context: This is a Subsequent Milestone

Existing features (already built and working in v1.0–v1.2):
- `GET /users`, `POST /users` Elysia routes
- pg-boss pub/sub workers (NotificationService + AuditService fan-out)
- PostgreSQL-backed pg-boss job queue with `KyselyAdapter`
- Elysia plugin composition root (`servicesPlugin`, `workersPlugin`, `userRoutesPlugin`)

This research covers ONLY the new features in v1.3: Dockerfile, Compose scale-out, Caddy, `GET /health`.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that are non-negotiable for the goal of proving horizontal scalability. Missing any of these = the milestone thesis is not demonstrated.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-stage Dockerfile (build + runtime) | Standard Bun containerization pattern; official bun.sh guide uses 4-stage Dockerfile (base → install → prerelease → release) | LOW | `FROM oven/bun:1 AS base` → separate install stage caches `node_modules`; release stage copies only prod deps + src. No build step needed — Bun runs TypeScript natively. Official pattern: skip `bun run build` for interpreted TS server apps |
| `.dockerignore` file | Prevents `node_modules`, `.git`, `docker-compose*` from entering build context; Docker best practice required alongside any Dockerfile | LOW | Without it: slow builds, large images, risk of leaking `.env`. Explicit omissions: `node_modules`, `Dockerfile*`, `docker-compose*`, `.git`, `.gitignore`, `README.md` |
| `DATABASE_URL` env var injection in `pool.ts` | `pool.ts` currently hardcodes `postgres://admin:pass@localhost:15432/postgres`; must be parameterized before any container can connect to the Compose-networked Postgres service | LOW | **Most critical code change — it's a dependency on existing app code.** Must change `pool.ts` to read `process.env.DATABASE_URL`. Caddy and Compose can't help here — the app must accept env injection. `PORT` is already parameterized in `index.ts` |
| `GET /health` endpoint in Elysia | Required for Caddy active health checks (`health_uri /health`); without it, Caddy marks all backends as unhealthy after first check | LOW | Elysia: `.get("/health", () => ({ status: "ok" }))` returns HTTP 200. Caddy checks status code by default (`health_status 200`). Body content is optional |
| Docker Compose file with `replicas: 6` | `deploy: mode: replicated, replicas: 6` directly demonstrates horizontal scalability — the milestone thesis | LOW | **Do NOT use `container_name` on the replicated service** — Docker Compose rejects scaling if `container_name` is set ("Compose does not scale a service beyond one container if container_name is specified"). Confirmed in Docker Compose Deploy Specification |
| PostgreSQL service in Compose | Database must be co-located in Compose so all 6 app instances can reach it via Docker service name DNS | LOW | Migrate and extend the existing `docker-compose.postgres.yaml`. App instances reference Postgres by service name (e.g. `postgres-db:5432`), not `localhost:15432` |
| Postgres `healthcheck` in Compose | Required for `depends_on: condition: service_healthy` to gate app startup — without it, app instances race Postgres startup | LOW | `test: ["CMD-SHELL", "pg_isready -U admin -d postgres"]`, `interval: 5s`, `timeout: 5s`, `retries: 5`. pg-boss calls `boss.start()` at boot which requires DB to be ready |
| `depends_on: condition: service_healthy` on app service | Prevents app instances from starting before Postgres is accepting connections | LOW | `depends_on: postgres-db: condition: service_healthy`. Without this, pg-boss crashes at boot when Postgres isn't ready yet |
| Caddy service in Compose | The load balancer that routes external traffic from port 8080 to the 6 app instances | LOW | Official image: `caddy:latest`. Mount `Caddyfile` via volume bind (`./Caddyfile:/etc/caddy/Caddyfile`). Expose port 8080 externally |
| Caddyfile with `reverse_proxy` round-robin to 6 instances | Demonstrates the load-balanced routing — the external-facing part of the horizontal scaling thesis | LOW | List all 6 instances statically by service name + port (Docker Compose DNS resolves per-replica). Use `lb_policy round_robin` to make load distribution visible in logs |
| Caddy `health_uri /health` active health check | Verifies that Caddy correctly excludes unhealthy/booting instances; connects the `GET /health` endpoint to observable load balancer behavior | LOW | `health_uri /health`, `health_interval 10s` (default is 30s). Caddy probes each upstream independently. Must be present to show active health monitoring |

### Differentiators (Competitive Advantage)

Features that go beyond the minimum viable milestone demo. Not required, but improve quality.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `start_period` on Postgres healthcheck | Prevents false-negative "unhealthy" during first-run Postgres data directory initialization (which is slower than subsequent starts) | LOW | Add `start_period: 10s` to Postgres service healthcheck. Simple one-liner; prevents spurious boot failures |
| App `healthcheck` in Compose (Docker-level) | Docker itself can restart unhealthy app containers, not just Caddy routing around them; improves crash recovery in the demo | LOW | `test: ["CMD-SHELL", "curl -f http://localhost:3000/health \|\| exit 1"]`. Requires `curl` — `oven/bun:1` is Debian-based (84MB) and has it. Alternative: `bun -e "await fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1))"` |
| `lb_retries` in Caddyfile | If a backend is mid-boot and fails a request, Caddy retries against another backend — makes restarts transparent | LOW | Add `lb_retries 2` inside the `reverse_proxy` block. Zero complexity, clear observable benefit |
| `restart: unless-stopped` on all services | Ensures services restart after Docker daemon restart or container crash — appropriate for a persistent demo environment | LOW | Simple one-liner per service. Already present on Postgres in the existing `docker-compose.postgres.yaml` |
| Passive health checks (`fail_duration 30s`) | Caddy also marks backends down based on failed real requests, not just active polls — faster failover | LOW | Add `fail_duration 30s` to `reverse_proxy` block. Complements active health checks. Not critical for the POC |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Dynamic DNS upstream in Caddyfile (`dynamic a app 3000`) | Seems elegant — single config line auto-discovers all replicas | **Caddy docs explicitly warn:** active health checks do not run for dynamic upstreams; passive health checks are unreliable without stable upstream list. Behavior unpredictable with Docker's embedded DNS TTL and replica churn | List all 6 instances statically by hostname. For plain Compose (non-Swarm), this is the documented safe approach |
| `container_name` on replicated app service | Makes configs look explicit and clean | Docker Compose **rejects scaling** when `container_name` is set — it enforces name uniqueness and errors: "Compose does not scale a service beyond one container if the Compose file specifies a container_name" | Omit `container_name`; let Compose auto-generate `{project}_{service}_{n}` names |
| `bun run build` step in Dockerfile | Compiling to binary reduces image size and startup time | Bun's server-app build requires extra bundler config; TypeScript source runs directly without a build step. Adding a build step adds complexity without benefit for a dev/POC image | Use `ENTRYPOINT ["bun", "run", "src/index.ts"]` directly. Bun transpiles TypeScript at runtime with zero config |
| `oven/bun:alpine` base image | Smaller image (~43MB vs 84MB for debian) | Alpine uses musl libc; while `pg` in this project uses pure-JS bindings (no native addon), it's an unnecessary risk for a POC — musl compatibility issues have caused real production failures with Node packages | Use `oven/bun:1` (Debian-based, 84MB compressed). Size difference doesn't matter for a local POC |
| Sticky sessions (`lb_policy cookie`) | Ensures each user always hits the same instance — "fair" routing | Defeats the purpose of the horizontal scaling demo. The thesis is that ANY instance handles any request because all state lives in PostgreSQL, not in app memory. Sticky sessions mask bugs | Use `round_robin` or `random` (default). Stateless-by-design is the POC's proof |
| TLS/HTTPS in Caddyfile | Caddy auto-TLS is a differentiator — automatic HTTPS with no config | For `localhost`/loopback, Let's Encrypt cannot issue certificates (ACME requires publicly reachable domain). Auto-TLS causes startup failures for local-only deployments. Adds port confusion (443 vs 8080) | Use `auto_https off` in global Caddy options, or bind to `http://localhost:8080`. TLS is irrelevant to the horizontal scaling thesis |
| One instance handles pg-boss schema migration | Avoid N instances racing to run `setupSchema()` at boot | pg-boss `setupSchema()` is idempotent (all DDL uses `IF NOT EXISTS`). pg-boss is explicitly documented as "Multi-master compatible" and internally uses advisory locks for safe concurrent initialization | Let all 6 instances call `setupSchema()` at boot. pg-boss handles the race safely — no coordination needed |

---

## Feature Dependencies

```
DATABASE_URL env injection (pool.ts change)
    └──required──> All 6 app instances connect to Compose-networked Postgres

GET /health Elysia endpoint
    └──required──> Caddy active health_uri check works
    └──required──> App Docker healthcheck works (differentiator)

Postgres healthcheck in Compose
    └──required──> depends_on: condition: service_healthy on app service
                       └──required──> App instances don't boot before Postgres is ready
                                          └──prevents──> pg-boss start failure at boot

Dockerfile (multi-stage)
    └──required──> Docker Compose build: context: . target: release

Docker Compose (replicas: 6 + Postgres + Caddy)
    └──required──> Caddy has backends to load-balance to

Caddyfile (reverse_proxy to 6 instances + health_uri)
    └──required──> Port 8080 is external entry point with active health monitoring
```

### Dependency Notes

- **`DATABASE_URL` injection requires pool.ts change:** The existing `pool.ts` hardcodes `localhost:15432`. Inside Docker, the Postgres service is reachable as `postgres-db:5432` (or whatever service name is used in Compose). This is the most critical code change in the existing codebase — everything else is new files.
- **`GET /health` required before Caddy health check:** If Caddy's `health_uri /health` fires before the route exists, all backends are immediately marked unhealthy and no traffic is routed. The health endpoint must be present in the app before the Caddyfile references it.
- **Postgres healthcheck gates app startup:** Without `condition: service_healthy`, app instances race with Postgres. pg-boss calls `boss.start()` which runs DB migrations — if Postgres isn't accepting connections yet, the entire app process crashes.
- **pg-boss multi-instance is safe without extra config:** pg-boss explicitly documents "Multi-master compatible" and uses PostgreSQL's `SKIP LOCKED` for exactly-once job delivery. All 6 instances subscribing to the same queues is the expected and designed use case — they compete for jobs via DB-level row locking, not application-level coordination.
- **Fan-out still works across instances:** Each subscriber queue (e.g. `notification.user.registered`, `audit.user.registered`) is picked up by exactly one worker across all 6 instances via `SKIP LOCKED`. Result: one instance handles the notification job, a different instance may handle the audit job — same fan-out behavior as single-instance, distributed.

---

## MVP Definition

### Launch With (v1.3)

Minimum features to demonstrate: "6 app instances behind a load balancer, all connected to the same pg-boss queue, proving horizontal scalability."

- [ ] **`DATABASE_URL` env var in `pool.ts`** — blocks all container networking; must be done first
- [ ] **`GET /health` endpoint in Elysia** — needed before Caddyfile health check config
- [ ] **Multi-stage Dockerfile** — enables `docker compose up --build`
- [ ] **`.dockerignore`** — required for correct build context
- [ ] **Docker Compose with `replicas: 6`** — the horizontal scaling demonstration
- [ ] **PostgreSQL service in Compose with `healthcheck`** — database must be ready before app boots
- [ ] **`depends_on: condition: service_healthy`** on app service — enforces boot ordering
- [ ] **Caddy service with Caddyfile** — the load balancer entry point on port 8080
- [ ] **Caddyfile with `health_uri /health` and `lb_policy round_robin`** — active health monitoring + observable round-robin routing

### Add After Validation (v1.3+)

- [ ] **App `healthcheck` in Compose** — Docker-level crash recovery; add after basic flow works
- [ ] **`lb_retries` in Caddyfile** — retry failed requests to another backend; trivial add once happy path works
- [ ] **`start_period` on Postgres healthcheck** — prevents first-run false negatives

### Future Consideration (v2+)

- [ ] **Named Docker networks** — explicit isolation; cosmetic improvement
- [ ] **`oven/bun:distroless` base** — 43MB vs 84MB; only matters if image size is a concern
- [ ] **Caddy Prometheus metrics** — Caddy exposes `/metrics` by default; surfacing them is a v2 observability concern

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `DATABASE_URL` env injection in `pool.ts` | HIGH (blocking all networking) | LOW | P1 |
| `GET /health` Elysia endpoint | HIGH (required by Caddy) | LOW | P1 |
| Multi-stage Dockerfile | HIGH (enables containers) | LOW | P1 |
| `.dockerignore` | HIGH (correctness) | LOW | P1 |
| Postgres `healthcheck` in Compose | HIGH (prevents boot race) | LOW | P1 |
| `depends_on: condition: service_healthy` | HIGH (enforces safe boot order) | LOW | P1 |
| Docker Compose `replicas: 6` | HIGH (thesis demo) | LOW | P1 |
| Caddy service + Caddyfile | HIGH (thesis demo) | LOW | P1 |
| Caddy `health_uri /health` | HIGH (load balancer correctness) | LOW | P1 |
| `lb_policy round_robin` | HIGH (makes distribution visible) | LOW | P1 |
| App `healthcheck` in Compose | MEDIUM (crash recovery) | LOW | P2 |
| `lb_retries` in Caddyfile | MEDIUM (resilience) | LOW | P2 |
| `start_period` on Postgres healthcheck | MEDIUM (first-run stability) | LOW | P2 |
| Passive health checks (`fail_duration`) | LOW (redundant with active checks for POC) | LOW | P3 |
| Named Docker networks | LOW (cosmetic) | LOW | P3 |

**Priority key:**
- P1: Must have — milestone thesis cannot be demonstrated without it
- P2: Should have — improves demo quality meaningfully at low cost
- P3: Nice to have — cosmetic or redundant for a local POC

---

## Key Behaviors Expected at Runtime

Observable outcomes that verify the milestone is working. Not features to build — validation checkpoints.

| Behavior | Why It Happens | How to Verify |
|----------|----------------|---------------|
| `POST /users` distributes across 6 instances | Caddy `lb_policy round_robin` sequences through backends | Check container logs — each request appears in a different container's stdout |
| pg-boss jobs processed exactly once across 6 workers | `SKIP LOCKED` in pg-boss guarantees at-most-once pickup per job row | Multiple `POST /users` → each `user.registered` event processed by exactly ONE instance's NotificationService and ONE instance's AuditService (may be different instances) |
| Fan-out still produces 2 handler logs per event | `boss.publish()` routes to both subscriber queues; each queue picked up by exactly one worker across all instances | Across all container logs: exactly 2 handler logs per `POST /users` (one `[NotificationService]`, one `[AuditService]`) |
| Rollback still works — no jobs on duplicate email | Atomic Kysely tx: if INSERT fails on unique constraint, the `boss.publish()` call (which uses the same tx) is also rolled back | `POST /users` with duplicate email → HTTP 409, zero job logs across all 6 containers |
| Caddy removes unhealthy backend | Active health check polls `/health` every 10s; failed backends excluded from rotation | Kill one container → Caddy stops routing to it; remaining 5 continue serving |
| pg-boss schema initialized without race errors | `setupSchema()` is idempotent + pg-boss uses advisory locks for concurrent init | 6 simultaneous boots complete without errors; schema exists once |

---

## Sources

- Bun official Docker guide: https://bun.sh/guides/ecosystem/docker (HIGH confidence — official docs)
- `oven/bun` Docker Hub tags (debian, slim, alpine, distroless variants): https://hub.docker.com/r/oven/bun/tags (HIGH confidence — official registry)
- Docker Compose Deploy Specification (`replicas`, `container_name` restriction, `mode: replicated`): https://docs.docker.com/reference/compose-file/deploy/ (HIGH confidence — official docs)
- Docker Compose services (`healthcheck`, `depends_on: condition: service_healthy`): https://docs.docker.com/reference/compose-file/services/#healthcheck (HIGH confidence — official docs)
- Caddy `reverse_proxy` directive (active health checks, `health_uri`, `lb_policy round_robin`, dynamic upstreams warning): https://caddyserver.com/docs/caddyfile/directives/reverse_proxy (HIGH confidence — official docs)
- Caddy `respond` directive (simple static health endpoint pattern): https://caddyserver.com/docs/caddyfile/directives/respond (HIGH confidence — official docs)
- pg-boss multi-master compatibility + `SKIP LOCKED` exactly-once delivery: https://github.com/timgit/pg-boss (HIGH confidence — official README)

---

*Feature research for: Docker + Caddy horizontal scaling milestone (v1.3)*
*Researched: 2026-03-22*

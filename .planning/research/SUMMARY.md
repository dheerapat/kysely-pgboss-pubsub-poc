# Project Research Summary

**Project:** kysely-pgboss-pubsub-poc — v1.3 Docker + Load Balancing milestone
**Domain:** Docker containerization + Caddy load balancing for Bun/Elysia/pg-boss event-driven app
**Researched:** 2026-03-22
**Confidence:** HIGH

## Executive Summary

This milestone (v1.3) proves horizontal scalability of the existing Bun/Elysia/pg-boss pub/sub application by containerizing it with Docker, running 6 parallel replicas behind a Caddy load balancer, all sharing one PostgreSQL database. The core thesis is that **all application state lives in PostgreSQL** — pg-boss uses `FOR UPDATE SKIP LOCKED` for exactly-once job delivery across competing workers, making all 6 replicas interchangeable without any coordination layer. Experts build this as: multi-stage Bun Dockerfile → Docker Compose with `deploy.replicas: 6` → Caddy `reverse_proxy` with `lb_policy round_robin` and `health_uri /health` active health checks.

The recommended approach requires only two code changes to the existing app: (1) replace the hardcoded connection string in `pool.ts` with `process.env["DATABASE_URL"]`, and (2) add a `GET /health` endpoint to Elysia. Everything else is new infrastructure files — Dockerfile, `docker-compose.yml`, Caddyfile, `.dockerignore`. pg-boss is already multi-master compatible by design; no concurrency configuration changes are needed. The critical boot ordering is enforced via Postgres `pg_isready` healthcheck + `depends_on: condition: service_healthy` on the app service.

The primary risks are operational, not architectural: forgetting to update `pool.ts` before containerizing (causes instant `ECONNREFUSED` on all replicas), missing the Postgres healthcheck (causes boot race and crash loops), and not handling `SIGTERM` (causes in-flight jobs to be abandoned on `docker compose stop`). All three are well-understood, trivially preventable, and have clear warning signs. The pg-boss schema race concern (6 instances calling `boss.start()` simultaneously) is a non-issue — pg-boss uses `pg_advisory_xact_lock()` and is explicitly documented as "Multi-master compatible."

---

## Key Findings

### Recommended Stack

The entire new stack (Docker infrastructure layer) is built on three official images with verified versions as of 2026-03-22. All configuration follows official documentation with no experimental features. The existing Bun/Elysia/pg-boss/Kysely/pg stack requires zero changes to versions or packages. Caddy was chosen over nginx (no built-in health checks without Plus) and Traefik (Docker label discovery is overkill for static `replicas: 6`).

**Core technologies:**
- `oven/bun:1.3.11`: Dockerfile base image (both builder and runtime stages) — official image, ~84MB, Debian-based (avoids musl/Alpine incompatibility risks with pg native bindings)
- `caddy:2.11.2`: Reverse proxy and load balancer — inline `reverse_proxy` with `lb_policy round_robin` and native active health checks; binding to `:8080` (not `:80`/`:443`) auto-disables HTTPS, no cert config needed
- `postgres:17`: Database in Compose — pinned away from `latest` (which resolved to pg18 as of research date); pg-boss 12.5.4 confirmed compatible with pg13–pg17, pg18 untested
- Multi-stage Dockerfile: builder stage installs deps with `--frozen-lockfile`; runtime stage copies only prod deps + `src/` — no `bun build` step (Bun runs TypeScript natively)
- `deploy.replicas: 6`: Docker Compose Deploy Specification (standalone Compose mode, not Swarm); all replicas share `app` DNS name — no `ports:` on app service, no `container_name` (Compose rejects scaling when set)

### Expected Features

All v1.3 features are low-complexity. The milestone's implementation cost is primarily configuration, not code. The single most critical code change — `DATABASE_URL` env var in `pool.ts` — blocks everything else and must be done first.

**Must have (table stakes — P1, milestone thesis cannot be demonstrated without):**
- `DATABASE_URL` env var injection in `pool.ts` — blocks all container networking; `localhost:15432` resolves to container loopback inside Docker
- `GET /health` Elysia endpoint — required for Caddy `health_uri` active checks; without it Caddy marks all backends unhealthy immediately
- Multi-stage Dockerfile — enables `docker compose up --build`; must copy both `index.ts` and `src/` to final stage
- `.dockerignore` — prevents `node_modules`, `.git`, `.env` from entering build context
- Docker Compose with `replicas: 6`, Postgres service, `healthcheck`, `depends_on: condition: service_healthy` — enforces boot ordering that prevents crash loops
- Caddy service + Caddyfile with `health_uri /health` and `lb_policy round_robin` — the external-facing proof of horizontal scaling

**Should have (P2 — low cost, meaningful improvement):**
- `SIGTERM` handler alongside existing `SIGINT` — Docker uses SIGTERM for graceful stop; without it, in-flight pg-boss jobs are abandoned
- `health_fails 3` in Caddyfile — tolerates pg-boss boot time (~2-5s) without prematurely marking replicas unhealthy
- App `healthcheck` in Compose — Docker-level crash recovery (not just Caddy routing around failures)
- `start_period: 10s` on Postgres healthcheck — prevents false-negative during first-run data directory initialization
- `lb_retries 2` in Caddyfile — transparent retry to another backend on mid-boot failures

**Defer (v2+):**
- Named Docker networks (cosmetic isolation)
- `oven/bun:distroless` runtime stage (43MB vs 84MB — irrelevant for POC, removes shell access needed for debugging)
- Caddy Prometheus metrics endpoint

### Architecture Approach

The architecture is a three-tier Docker Compose stack sharing a single bridge network. Caddy sits at the edge (port 8080 host-exposed), reverse-proxying to 6 app replicas reachable via Docker DNS `app:3000`. All replicas connect to a single Postgres instance via `DATABASE_URL`. pg-boss tables live in Postgres — shared by all 6 instances — with `FOR UPDATE SKIP LOCKED` providing exactly-once job delivery at the database level. No application-level coordination or distributed locking is needed. Boot ordering is enforced by `pg_isready` healthcheck + `depends_on: service_healthy`.

**Major components:**
1. **`caddy`** — Edge proxy; Caddyfile configures `reverse_proxy app:3000` with `lb_policy round_robin`, `health_uri /health`, `health_interval 10s`, `health_fails 3`; Docker DNS resolves `app` to all 6 replica IPs automatically
2. **`app` (×6 replicas)** — Elysia HTTP on `:3000`, pg-boss workers on all instances (all call `boss.start()`, `boss.work()` — SKIP LOCKED ensures no duplicate job processing), DATABASE_URL-driven pg.Pool
3. **`postgres`** — Single shared store; pg-boss schema + job tables + `public.users`; gated by `pg_isready` healthcheck; no host port exposure in full-stack Compose

**Key patterns:**
- `FOR UPDATE SKIP LOCKED` — exactly-once delivery across competing workers, zero coordination overhead, verified in pg-boss source `plans.js:fetchNextJob()`
- `pg_advisory_xact_lock()` — race-safe schema initialization; one replica creates pgboss schema, others get `CREATE_RACE_MESSAGE` and swallow it silently
- Docker service DNS — `app` resolves to all 6 replica container IPs; Caddy + `round_robin` distributes across them without enumerating individual containers
- `depends_on: condition: service_healthy` — gates app start on Postgres readiness, not just container start

**New files:** `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.dockerignore`
**Modified files:** `src/infrastructure/db/pool.ts` (DATABASE_URL), `src/index.ts` (GET /health + SIGTERM handler)
**Unchanged:** All plugin composition, pg-boss wiring, domain logic, Kysely integration

### Critical Pitfalls

1. **Hardcoded `localhost:15432` in `pool.ts`** — `localhost` inside a container is container loopback, not the host or Postgres service. Fix first: `process.env["DATABASE_URL"] ?? "postgres://admin:pass@localhost:15432/postgres"`. Warning sign: `ECONNREFUSED 127.0.0.1:15432` in app container logs immediately on startup.

2. **`depends_on: - postgres` without `condition: service_healthy`** — Compose waits for container start, not Postgres readiness. pg-boss `boss.start()` connects immediately; Postgres needs 1-3s to initialize. Fix: add `pg_isready` healthcheck to postgres service and `condition: service_healthy` on app's `depends_on`. Warning sign: ECONNREFUSED within first 2 seconds, crash-loop restarts.

3. **Missing `SIGTERM` handler** — Docker sends SIGTERM on `docker compose stop`/`down`; existing code only handles SIGINT. Without it, active pg-boss jobs are abandoned on container shutdown. Fix: add `process.on("SIGTERM", shutdown)` alongside SIGINT; use `boss.stop({ graceful: true, timeout: 25000 })`. Warning sign: `docker compose stop` takes 10s (hits SIGKILL timeout), no shutdown log.

4. **`ports:` mapping on replicated app service** — With `deploy.replicas: 6`, all 6 containers fight over the same host port. Fix: remove all `ports:` from app service in Compose; only Caddy exposes port `8080:8080`. Warning sign: `Bind for 0.0.0.0:3000 failed: port is already allocated`.

5. **Caddy `health_fails 1` (default) with pg-boss boot time** — pg-boss takes ~2-5s to initialize. With default `health_fails 1`, one health check failure before boot completes permanently marks the backend down. Fix: set `health_fails 3` in Caddyfile (gives ~20-30s tolerance). Warning sign: Caddy logs `upstream marked as unhealthy` immediately after startup; `GET /health` works via curl but Caddy returns 502.

---

## Implications for Roadmap

Based on research, all features are low-complexity. The natural implementation order follows strict dependency chains: code changes before Docker, Docker before Compose, Compose before Caddy. Suggested 3-phase structure:

### Phase 1: App Containerization Foundation
**Rationale:** The two code changes (`DATABASE_URL` + `GET /health` + SIGTERM handler) are hard dependencies of everything else. They must land before any Docker infrastructure is testable. The Dockerfile and `.dockerignore` must also exist before `docker compose up --build` works. This phase produces a containerizable app image.
**Delivers:** Runnable single-container Docker image with environment-driven config and health endpoint
**Addresses:** `DATABASE_URL` env injection (P1), `GET /health` endpoint (P1), multi-stage Dockerfile (P1), `.dockerignore` (P1), SIGTERM handler (P2)
**Avoids:** Pitfall 2 (hardcoded connection string), Pitfall 3 (SIGTERM not handled), Pitfall 7 (multi-stage Dockerfile missing src/), Pitfall 8 (bun.lock filename), Pitfall 10 (secrets in image layers)

### Phase 2: Docker Compose Orchestration
**Rationale:** Compose is the foundation for multi-replica behavior. Postgres healthcheck + `depends_on: service_healthy` must be established before scaling to 6 replicas — otherwise the first `docker compose up` crash-loops. This phase validates that the single-instance containerized app connects to Compose-networked Postgres correctly before scaling.
**Delivers:** Full 3-service Compose stack (postgres + app + caddy) with correct boot ordering and pg-boss multi-instance startup
**Uses:** `postgres:17`, `deploy.replicas: 6`, `pg_isready` healthcheck, `condition: service_healthy`
**Implements:** Docker service DNS topology, pg-boss advisory lock schema init, pool size tuning
**Avoids:** Pitfall 5 (depends_on without healthcheck), Pitfall 9 (port conflicts with replicas), Pitfall 1 (pg-boss schema race — confirm it's a non-issue), Pitfall 3 (connection pool exhaustion — set `max: 5` per pool)

### Phase 3: Caddy Load Balancing + Verification
**Rationale:** Caddy is the final layer and requires all 6 app replicas to be healthy and responding to `/health` before meaningful testing. This phase adds Caddy to the Compose stack, validates round-robin distribution across all 6 replicas, and runs the full verification checklist (exactly-once delivery, fan-out, rollback, health failover).
**Delivers:** Complete horizontal scaling demo: 6 replicas behind Caddy on port 8080, observable round-robin routing, active health monitoring, exactly-once pg-boss job processing
**Uses:** `caddy:2.11.2`, Caddyfile with `lb_policy round_robin`, `health_uri /health`, `health_fails 3`
**Implements:** Caddy service DNS routing, passive + active health checks, load-balanced fan-out verification
**Avoids:** Pitfall 4 (Caddy health check timing — `health_fails 3`), Pitfall 6 (createQueue/subscribe idempotency — verify in logs)

### Phase Ordering Rationale

- **Code changes before containers:** `DATABASE_URL` and `/health` are app-level changes; they must exist in the source before any Docker image is built — no chicken-and-egg problem
- **Single-container validation before scaling:** Verify the Dockerfile produces a working image (`docker run`) before introducing `deploy.replicas: 6` complexity
- **Postgres healthcheck before replicas:** With 6 instances calling `boss.start()` simultaneously, boot-ordering correctness is non-negotiable — must be verified before scaling
- **Caddy last:** Caddy's value (round-robin, health monitoring) is only visible once multiple healthy replicas exist; adding it first would surface confusing errors

### Research Flags

Phases with well-documented patterns (skip `/gsd-research-phase`):
- **Phase 1:** Bun Docker guide is canonical; multi-stage pattern is copy-paste from official docs; `DATABASE_URL` env injection is trivial
- **Phase 2:** Docker Compose `deploy.replicas` and `depends_on: service_healthy` are standard; pg-boss multi-master safety is verified from source
- **Phase 3:** Caddy `reverse_proxy` directive is well-documented; all config patterns verified against official Caddy docs

**No phases need deeper research** — all three phases use patterns verified against official documentation with HIGH confidence. Research is complete.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All 3 image versions verified against Docker Hub on 2026-03-22; Bun Docker guide is official; Caddy and Compose docs are authoritative |
| Features | HIGH | All features verified against official Docker Compose, Caddy, and Bun documentation; pg-boss multi-master confirmed in official README |
| Architecture | HIGH | pg-boss SKIP LOCKED verified in source (`plans.js:fetchNextJob()`); advisory lock behavior verified in source (`contractor.js:create()`); Docker DNS confirmed in official Compose networking docs |
| Pitfalls | HIGH | pg-boss schema race non-issue confirmed from official pg-boss docs; Caddy health check timing confirmed from official Caddy docs; Docker startup ordering from official docs; codebase inspection for hardcoded connection string |

**Overall confidence:** HIGH

### Gaps to Address

- **pg18 compatibility:** `postgres:latest` resolves to pg18 as of research date. pg-boss 12.5.4 compatibility with pg18 is untested. Mitigated by pinning to `postgres:17`. Monitor when upgrading Postgres in future milestones.
- **Connection pool tuning in production:** `max: 5` per pool (6 × 5 = 30 connections) is validated math for this POC with Postgres `max_connections=100`. Real production use would require PgBouncer. Out of scope for this milestone but worth documenting as technical debt.
- **`pg_advisory_xact_lock()` behavior under network partition:** Verified for concurrent boot on same network; edge cases under container network failures not explored. Acceptable for a local Compose POC.

---

## Sources

### Primary (HIGH confidence)
- **Docker Hub oven/bun** — https://hub.docker.com/r/oven/bun/tags — version `1.3.11` verified
- **Docker Hub caddy** — https://hub.docker.com/_/caddy/tags — version `2.11.2` verified
- **Docker Hub postgres** — https://hub.docker.com/_/postgres/tags — version `17`/`17.9` verified; `latest` → pg18 warning
- **Bun Docker guide** — https://bun.sh/guides/ecosystem/docker — multi-stage pattern, `--frozen-lockfile --production`, `USER bun`
- **Caddy `reverse_proxy` directive** — https://caddyserver.com/docs/caddyfile/directives/reverse_proxy — `lb_policy round_robin`, `health_uri`, `health_interval`, `health_fails`, `health_passes`
- **Caddy Automatic HTTPS** — https://caddyserver.com/docs/automatic-https — bare port `:8080` disables auto-HTTPS
- **Docker Compose Deploy Specification** — https://docs.docker.com/compose/compose-file/deploy/ — `deploy.replicas: 6`, standalone Compose mode
- **Docker Compose Networking** — https://docs.docker.com/compose/how-tos/networking/ — service DNS resolution
- **Docker Compose startup ordering** — https://docs.docker.com/compose/how-tos/startup-order/ — `condition: service_healthy`
- **pg-boss README** — https://github.com/timgit/pg-boss — "Multi-master compatible (for example, in a Kubernetes ReplicaSet)"
- **pg-boss introduction.md** — https://github.com/timgit/pg-boss/blob/master/docs/introduction.md — SKIP LOCKED exactly-once delivery
- **pg-boss ops.md** — https://raw.githubusercontent.com/timgit/pg-boss/master/docs/api/ops.md — `start()` advisory lock documentation
- **pg-boss source `plans.js`** — `node_modules/pg-boss/dist/plans.js`, `fetchNextJob()` — `FOR UPDATE SKIP LOCKED` verified
- **pg-boss source `contractor.js`** — `node_modules/pg-boss/dist/contractor.js`, `create()` — `CREATE_RACE_MESSAGE` advisory lock verified

### Secondary (MEDIUM confidence)
- **`service_healthy` + `pg_isready` pattern** — broadly documented community practice; standard established approach across Docker Compose documentation and community

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*

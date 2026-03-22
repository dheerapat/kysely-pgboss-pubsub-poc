---
phase: 11-docker-compose-orchestration
plan: "01"
subsystem: infra

tags: [docker-compose, postgres, pg-boss, replicas, healthcheck]

# Dependency graph
requires:
  - phase: 10-app-containerization-foundation
    provides: Dockerfile that builds the app image, pool.ts reading DATABASE_URL from env

provides:
  - docker-compose.yml with full 3-service stack (postgres:17 + app×6)
  - pg_isready healthcheck ensuring postgres is ready before app replicas start
  - PGBOSS_MAX_CONNECTIONS env var wired into pg Pool max connections

affects: [12-caddy-load-balancer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "deploy.replicas for scaling app instances without ports (Caddy will expose host port)"
    - "depends_on: condition: service_healthy for guaranteed boot ordering"
    - "pg pool max via env var for per-replica connection cap"

key-files:
  created:
    - docker-compose.yml
  modified:
    - src/infrastructure/db/pool.ts

key-decisions:
  - "deploy.replicas: 6 with no ports: on app service — Caddy (Phase 12) is the sole host-facing entry point"
  - "DATABASE_URL points to postgres service name (not localhost) — localhost resolves to container loopback causing ECONNREFUSED"
  - "PGBOSS_MAX_CONNECTIONS: 5 — 6×5=30 connections, safely under Postgres default max of 100"
  - "postgres:17 pinned (not latest) — pg-boss 12.5.4 compatibility with pg18 untested"
  - "start_period: 10s on healthcheck — gives postgres time for initial cluster setup before retries count"

patterns-established:
  - "Compose service name used as DNS hostname in DATABASE_URL"
  - "Env-var-configurable pool max for per-replica connection budget control"

requirements-completed: [COMP-01, COMP-02, COMP-03, COMP-04]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 11 Plan 01: Docker Compose Orchestration Summary

**Full 3-service Compose stack (postgres:17 + 6 app replicas) with pg_isready healthcheck, guaranteed boot ordering, and env-var-capped pg pool connections**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-22T05:32:56Z
- **Completed:** 2026-03-22T05:34:14Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `docker-compose.yml` with postgres:17 service using `pg_isready` healthcheck (start_period 10s, retries 5, interval 5s)
- Added app service with 6 replicas, `DATABASE_URL` pointing to `postgres` service name, `PGBOSS_MAX_CONNECTIONS: "5"`, and no `ports:` block
- Updated `pool.ts` to read `PGBOSS_MAX_CONNECTIONS` env var for `max` pool connections (6×5=30, under pg default 100)
- All 4 requirements satisfied (COMP-01 through COMP-04); `docker compose config --quiet` validates clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create postgres service with pg_isready healthcheck** - `2e64edc` (feat)
2. **Task 2: Add app service with 6 replicas and wire pg pool max env var** - `2c3069a` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `docker-compose.yml` - Full Compose stack: postgres:17 with healthcheck + app×6 replicas with dependency and env wiring
- `src/infrastructure/db/pool.ts` - Added `max: parseInt(process.env["PGBOSS_MAX_CONNECTIONS"] ?? "10", 10)` to Pool constructor

## Decisions Made
- SERVICE DNS: `DATABASE_URL` uses `postgres` (service name) not `localhost` — inside Docker, `localhost` resolves to the container loopback, causing ECONNREFUSED. Service name resolves via Compose internal DNS.
- POOL CAP: `PGBOSS_MAX_CONNECTIONS: "5"` caps each replica's pg connections. 6 replicas × 5 = 30 total, safely under Postgres default max_connections of 100.
- BOOT ORDER: `depends_on: condition: service_healthy` prevents app replica crash-loop on startup — replicas only boot after postgres passes pg_isready.
- NO PORTS: App service has no `ports:` block — Phase 12 (Caddy) will be the sole host-facing entry point, enabling load-balanced routing across all 6 replicas.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. `docker compose up --build` is all that's needed (requires Docker daemon running).

## Known Stubs

None — all env vars are wired, all services are connected with real values.

## Next Phase Readiness
- `docker-compose.yml` is ready for Phase 12 (Caddy) to add as the third service
- Caddy will expose host port 8080, reverse-proxy to app replicas via `app:3000` with health checks
- Phase 12 must NOT modify the postgres or app services already defined here

## Self-Check: PASSED

All created files exist on disk. All task commits verified in git log.

---
*Phase: 11-docker-compose-orchestration*
*Completed: 2026-03-22*

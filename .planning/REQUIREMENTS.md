# Requirements: Kysely + pg-boss DDD Event-Driven POC

**Defined:** 2026-03-22
**Milestone:** v1.3 — Docker + Load Balancing
**Core Value:** Domain writes and domain event publishing are atomic — if the transaction rolls back, the event is never queued.

## v1.3 Requirements

### Container Readiness

- [ ] **CONT-01**: App reads `DATABASE_URL` env var for Postgres connection (fallback to `postgres://admin:pass@localhost:15432/postgres` for local dev)
- [ ] **CONT-02**: App exposes `GET /health` endpoint returning HTTP 200
- [ ] **CONT-03**: App handles `SIGTERM` for graceful shutdown alongside existing `SIGINT` handler

### Docker Image

- [ ] **DOCK-01**: Multi-stage Dockerfile uses `oven/bun:1.3.11` for both builder and runtime stages
- [ ] **DOCK-02**: `.dockerignore` excludes `node_modules`, `.git`, `.env` from build context
- [ ] **DOCK-03**: Runtime image copies only production deps + `src/` (no devDependencies in final layer)

### Compose Orchestration

- [x] **COMP-01**: Docker Compose defines `postgres:17` service using credentials from existing `docker-compose.postgres.yaml` (`admin`/`pass`/`postgres`) with volume path `/var/lib/postgresql` and a `pg_isready` healthcheck
- [x] **COMP-02**: App service uses `deploy.replicas: 6` with `depends_on: condition: service_healthy` on Postgres
- [x] **COMP-03**: App service configures pg pool `max: 5` via env var (6 × 5 = 30 connections, under Postgres default of 100)
- [x] **COMP-04**: App service has no `ports:` mapping — only Caddy exposes a host port

### Caddy Load Balancing

- [x] **CADDY-01**: `Caddyfile` configures `reverse_proxy app:3000` with `lb_policy round_robin`
- [x] **CADDY-02**: `Caddyfile` sets `health_uri /health`, `health_interval 10s`, `health_fails 3`
- [x] **CADDY-03**: Caddy service in Docker Compose exposes port `8080:8080`

## Future Requirements

*(None identified — scope is fully contained in v1.3)*

## Out of Scope

| Feature | Reason |
|---------|--------|
| TLS / HTTPS | `:8080` bare port disables Caddy auto-HTTPS — not needed for local POC |
| PgBouncer connection pooling | Production concern; pg pool max:5 × 6 = 30 connections is sufficient for POC |
| Named Docker networks | Default Compose bridge network is sufficient; named networks are cosmetic isolation |
| `oven/bun:distroless` runtime image | Removes shell access needed for debugging; irrelevant size saving for POC |
| Caddy Prometheus metrics | Operational concern beyond POC scope |
| Modifying `docker-compose.postgres.yaml` | Existing file stays as-is for local dev; new `docker-compose.yml` is separate |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONT-01 | Phase 10 | Pending |
| CONT-02 | Phase 10 | Pending |
| CONT-03 | Phase 10 | Pending |
| DOCK-01 | Phase 10 | Pending |
| DOCK-02 | Phase 10 | Pending |
| DOCK-03 | Phase 10 | Pending |
| COMP-01 | Phase 11 | Complete |
| COMP-02 | Phase 11 | Complete |
| COMP-03 | Phase 11 | Complete |
| COMP-04 | Phase 11 | Complete |
| CADDY-01 | Phase 12 | Complete |
| CADDY-02 | Phase 12 | Complete |
| CADDY-03 | Phase 12 | Complete |

**Coverage:**
- v1.3 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 — traceability confirmed after roadmap creation (Phases 10-12)*

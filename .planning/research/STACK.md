# Stack Research

**Domain:** Docker containerization + Caddy load balancing for Bun/Elysia/pg-boss app
**Researched:** 2026-03-22
**Confidence:** HIGH — all versions verified against official Docker Hub and official docs

---

## Scope

This document covers **only what is new for v1.3** (Docker + Load Balancing milestone). The existing stack (Bun, TypeScript strict, Kysely ^0.28.9, pg ^8.16.3, pg-boss ^12.5.4, Elysia) is validated and out of scope.

New surface: Dockerfile, Docker Compose (6 replicas + Postgres + Caddy), Caddyfile, `GET /health` endpoint.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `oven/bun` | `1.3.11` | Dockerfile base image (builder + runtime stages) | Official image from oven team, multi-arch (amd64 + arm64), ~84MB compressed. Current stable as of 2026-03-22. Project already runs Bun 1.3.10 locally — 1.3.11 is compatible. |
| `caddy` | `2.11.2` | Reverse proxy + load balancer Compose service | Official Docker image, ~22MB. Native `reverse_proxy` with `lb_policy round_robin` and active `health_uri` checks. No plugins required. Binding to `:8080` avoids auto-HTTPS (no TLS config needed). |
| `postgres` | `17` | Database service in Compose | Latest LTS-equivalent stable (17.9 patch). pg-boss 12.5.4 requires PostgreSQL 13+; pg17 is confirmed compatible. Existing dev compose uses `postgres:latest` — pin to `17` for reproducibility. |

### Supporting Configuration Choices

| Item | Value | Purpose | Why |
|------|-------|---------|-----|
| Dockerfile builder stage | `oven/bun:1.3.11 AS builder` | Install all deps including devDeps | Separate stage — devDeps never reach runtime image |
| Dockerfile runtime stage | `oven/bun:1.3.11` | Final slim runtime | Only prod deps + source files; builder layer discarded |
| `bun install` (builder) | `--frozen-lockfile` | Reproducible with lockfile | `bun.lock` must be committed |
| `bun install` (runtime) | `--frozen-lockfile --production` | No devDeps in final image | Excludes `@types/bun`, `@types/pg`, etc. |
| `EXPOSE` port | `3000` | App listens on PORT env | Matches existing `src/index.ts` `PORT` default |
| `USER bun` | non-root user in runtime stage | Security: don't run as root | `oven/bun` ships a `bun` user; required in ENTRYPOINT stage |
| `ENTRYPOINT` | `["bun", "run", "src/index.ts"]` | Start the composition root | `src/index.ts` is the Elysia composition root; root `index.ts` is the old scratch PoC |
| Compose `deploy.replicas` | `6` | Six parallel app instances | Confirmed in Docker Compose Deploy Specification docs. Works in standalone Compose mode, not Swarm-only. |
| Postgres volume mount | `/var/lib/postgresql/data` | Persistent DB across restarts | Existing dev compose uses `/var/lib/postgresql` (missing `/data`) — this is incorrect; pg data lives in the `data` subdirectory |
| Caddy listen address | `:8080` | Host-exposed port | Bare port (not domain + not `:80`/`:443`) disables Caddy auto-HTTPS automatically per official docs |
| `DATABASE_URL` env var | `postgres://admin:pass@postgres:5432/postgres` | Postgres connection for app containers | `postgres` = Compose service DNS name; replaces hardcoded `localhost:15432` in existing code |

### Docker Compose Service Topology

| Service | Image | Role | Depends On |
|---------|-------|------|------------|
| `postgres` | `postgres:17` | Database | — |
| `app` | local build | App (×6 via replicas) | `postgres` (healthcheck) |
| `caddy` | `caddy:2.11.2` | Load balancer | `app` |

---

## Canonical Config Patterns

### Multi-Stage Dockerfile

```dockerfile
# Stage 1: install production dependencies
FROM oven/bun:1.3.11 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 2: runtime
FROM oven/bun:1.3.11
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json tsconfig.json ./

USER bun
EXPOSE 3000/tcp
ENTRYPOINT ["bun", "run", "src/index.ts"]
```

**Why no `bun build` step:** Bun runs TypeScript natively — no transpilation step. `bun run src/index.ts` works directly in production.

**Why no test step in Dockerfile:** `bun test` requires DB connectivity not available at build time. Tests belong in CI, not the build layer.

**Why `--production` in builder:** Keeps `@types/bun`, `@types/pg`, `typescript` peer dep out of the image. Zero runtime weight, but cleaner convention.

### docker-compose.yaml

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: postgres
      TZ: UTC
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin -d postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  app:
    build: .
    environment:
      DATABASE_URL: postgres://admin:pass@postgres:5432/postgres
      PORT: "3000"
    deploy:
      replicas: 6
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  caddy:
    image: caddy:2.11.2
    ports:
      - "8080:8080"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres-data:
    driver: local
```

**Key decisions:**
- `postgres` healthcheck with `pg_isready` is required — prevents app containers from starting before Postgres accepts connections. pg-boss schema setup (`setupSchema()` + `boss.start()`) must not run against an unready DB.
- `depends_on` with `condition: service_healthy` waits for the healthcheck, not just container start.
- No `ports:` on `app` service — replicas share no stable host port; Caddy reaches them by service DNS name over internal network.
- `deploy.replicas: 6` — all 6 containers join the same internal Docker network and are reachable via the `app` DNS name.

### Caddyfile

```caddyfile
:8080 {
  reverse_proxy app:3000 {
    lb_policy round_robin
    health_uri /health
    health_interval 10s
    health_timeout 2s
  }
}
```

**Why `:8080` not `:80`:** Caddy auto-HTTPS is activated by domain names and ports 80/443. Binding to a bare port (`:8080`) with no hostname prevents auto-HTTPS entirely — no ACME, no cert generation, no TLS config required. Confirmed: Caddy Auto-HTTPS docs list "Listening exclusively on the HTTP port" as a deactivation condition.

**Why `app:3000`:** Docker Compose creates a DNS entry `app` that resolves to all replica containers. Combined with `lb_policy round_robin`, Caddy distributes requests evenly across all 6.

**Why `health_uri /health`:** Caddy active health checks poll each upstream's `/health` every 10s. Unhealthy replicas are removed from rotation automatically.

### `GET /health` Endpoint (Elysia addition)

Add to `userRoutesPlugin` or a dedicated `healthPlugin`:

```typescript
// Minimal — Caddy only checks HTTP status code
app.get("/health", () => new Response("OK", { status: 200 }))

// Or idiomatic Elysia:
app.get("/health", ({ set }) => {
  set.status = 200
  return "OK"
})
```

**What NOT to put in `/health`:** DB connectivity check (pg pool ping). If DB is down, all 6 replicas fail simultaneously and Caddy removes them all — total blackout. Keep `/health` as a pure process liveness check. DB issues surface in error responses on real endpoints.

### Environment Variable: `DATABASE_URL`

`src/infrastructure/db/` must be updated to read `process.env["DATABASE_URL"]` instead of the hardcoded `postgres://admin:pass@localhost:15432/postgres` in the current scratch `index.ts`. The Compose `app` service provides `postgres://admin:pass@postgres:5432/postgres` where `postgres` is the Compose internal service DNS name.

---

## pg-boss Multi-Instance Safety (No Code Changes Required)

All 6 app instances share one PostgreSQL database and all run `boss.work()`. This is safe by design:

- pg-boss uses **PostgreSQL `SKIP LOCKED`** for job claiming — multiple workers compete for the same jobs but each job is claimed by exactly one worker. This is the documented "exactly-once delivery" guarantee.
- pg-boss README explicitly states: **"Multi-master compatible (for example, in a Kubernetes ReplicaSet)"** — 6 replicas in Docker Compose is equivalent.
- Schema setup (`setupSchema()` + `boss.start()`) is **idempotent** — `IF NOT EXISTS` guards and pg-boss's own schema installer handle concurrent boot safely.
- `boss.publish()` fan-out still works identically across all instances — all subscriber queues receive the job, each processed by exactly one worker across the fleet.

No `teamSize`, `teamConcurrency`, or pg-boss config changes needed.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `caddy:2.11.2` | nginx | Caddy `reverse_proxy` is inline — LB policy and health checks configured in one block. nginx requires separate `upstream` block, `proxy_pass`, and no built-in health checks without Plus. Caddy is lower config for this POC. |
| `caddy:2.11.2` | traefik | Traefik discovers upstreams via Docker labels on containers — elegant for dynamic services, but `deploy.replicas: 6` is static config. Caddy's Caddyfile is more readable and explicit. |
| `postgres:17` | `postgres:latest` | `latest` resolves to `postgres:18.3` as of 2026-03-22 (just released). pg-boss 12.5.4 compatibility with pg18 is untested. Pin to `17` which is confirmed compatible with SKIP LOCKED semantics. |
| `oven/bun:1.3.11` | `oven/bun:1.3.11-alpine` | Alpine uses musl libc — some native Node addons break. The default Debian-based Bun image matches local dev. Size difference (~40MB) irrelevant for a POC. |
| `oven/bun:1.3.11` | `oven/bun:1.3.11-distroless` | Distroless is smallest (~43MB) but has no shell — cannot exec into containers for debugging. Useful for production hardening; premature for a POC. |
| Multi-stage Dockerfile | Single-stage | Single-stage includes devDeps and would include all build tools in the production image. Multi-stage is the documented Bun best practice. |

---

## What NOT to Add or Change

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ports:` on the `app` service | With `deploy.replicas: 6`, all 6 containers would fight over the same host port — Docker Compose errors. Caddy is the only service needing a host port. | No `ports` on app; only `caddy` exposes `8080:8080` |
| `postgres:latest` | Resolves to postgres:18 as of 2026-03. pg-boss 12.5.4 untested against pg18. | `postgres:17` — confirmed stable, compatible with pg-boss |
| Docker healthcheck on `app` service | Conflicts with Caddy's proxy-layer active health checks. Adds container restart complexity. Caddy already monitors `/health`. | Caddy `health_uri` in Caddyfile only |
| `network_mode: host` on any service | Breaks Docker internal DNS — service names stop resolving. Caddy cannot reach `app:3000`. | Default bridge networking (Docker Compose default) |
| `links:` between services | Deprecated. Use service name DNS automatically provided by Compose. | Use `app:3000` in Caddyfile directly |
| `auto_https off` in Caddyfile global options | Not needed — binding to `:8080` (bare port, no hostname) already disables auto-HTTPS automatically. Explicit `auto_https off` is redundant noise. | Use bare port address `:8080` |
| pg-boss `teamSize` / `teamConcurrency` tuning | Don't tune worker concurrency to compensate for 6 instances — SKIP LOCKED already handles safe concurrent job pickup. | Leave pg-boss worker config at defaults |
| Separate message queue (Redis, RabbitMQ) | Out of scope per PROJECT.md — pg-boss replaces them. | No change |
| Elysia `cluster` mode (Node cluster API) | Bun doesn't implement `cluster` module. Horizontal scaling is done at container level via `deploy.replicas`. | Docker Compose replicas |

---

## Stack Patterns by Variant

**If you want to further reduce image size (post-POC only):**
- Switch runtime stage to `oven/bun:1.3.11-distroless` (~43MB vs 84MB)
- Only after POC is validated — distroless removes shell access needed for debugging

**If deploying to production (out of scope for this POC):**
- Use Docker Secrets or a vault for `POSTGRES_PASSWORD` / `DATABASE_URL`
- Replace `restart: unless-stopped` with proper orchestration (Kubernetes, ECS)
- Pin Postgres to `17.9` (patch-pinned) not just `17`

**Adding `.dockerignore` (recommended alongside Dockerfile):**
```
node_modules
Dockerfile*
docker-compose*
.dockerignore
.git
.gitignore
.planning
.opencode
README.md
*.md
.env*
genMockUser.ts
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `pg-boss@12.5.4` | `postgres:13` through `postgres:17` | Requires SKIP LOCKED (pg13+). pg18 is untested as of 2026-03. |
| `oven/bun:1.3.11` | `node_modules` built on same arch | Builder and runtime use the same base image — no cross-arch native module issues. |
| `caddy:2.11.2` | Any HTTP/1.1 backend | App serves HTTP/1.1; Caddy default `http` transport handles this. No h2c/h3 config needed. |
| Docker Compose `deploy.replicas` | Docker Compose v2+ | Works in standalone Compose mode. Not Swarm-only. Confirmed in Docker Compose Deploy Specification docs. |

---

## Sources

- **Docker Hub oven/bun** — https://hub.docker.com/r/oven/bun/tags — `1.3.11` confirmed current stable (pushed 4 days ago as of 2026-03-22). HIGH confidence.
- **Docker Hub caddy** — https://hub.docker.com/_/caddy/tags — `2.11.2` confirmed current stable (pushed 11 days ago). HIGH confidence.
- **Docker Hub postgres** — https://hub.docker.com/_/postgres/tags — `17.9` / tag `17` confirmed current stable. `18.3` (`latest`) also available but untested with pg-boss. HIGH confidence.
- **Bun Docker guide** — https://bun.sh/guides/ecosystem/docker — canonical multi-stage Dockerfile pattern with `--frozen-lockfile --production`. HIGH confidence.
- **Caddy `reverse_proxy` directive** — https://caddyserver.com/docs/caddyfile/directives/reverse_proxy — `lb_policy round_robin`, `health_uri`, `health_interval`, `health_timeout` options confirmed. HIGH confidence.
- **Caddy Automatic HTTPS** — https://caddyserver.com/docs/automatic-https — confirmed bare port `:8080` (not a hostname, not `:80`/`:443`) disables auto-HTTPS automatically. HIGH confidence.
- **Docker Compose Deploy Specification** — https://docs.docker.com/compose/compose-file/deploy/ — `deploy.replicas: 6` confirmed with example. Standalone Compose support confirmed. HIGH confidence.
- **Docker Compose Networking** — https://docs.docker.com/compose/how-tos/networking/ — service name DNS resolution confirmed. `app` resolves to replica containers. HIGH confidence.
- **pg-boss README** — https://github.com/timgit/pg-boss — "Multi-master compatible (for example, in a Kubernetes ReplicaSet)" confirmed. HIGH confidence.
- **pg-boss introduction.md** — https://github.com/timgit/pg-boss/blob/master/docs/introduction.md — SKIP LOCKED multi-instance exactly-once delivery confirmed. HIGH confidence.

---

*Stack research for: Docker + Caddy + Postgres containerization of Bun/Elysia/pg-boss app (v1.3)*
*Researched: 2026-03-22*

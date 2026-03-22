# syntax=docker/dockerfile:1

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM oven/bun:1.3.11 AS install
WORKDIR /app

# Install dev deps (for potential type-checking, not copied to runtime)
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install production deps only (what the runtime stage will use)
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM oven/bun:1.3.11 AS release
WORKDIR /app

# Copy only production node_modules from install stage (no devDependencies)
COPY --from=install /temp/prod/node_modules ./node_modules

# Copy application source and package manifest
COPY package.json ./
COPY src/ ./src/

# Run as non-root bun user (provided by oven/bun image)
USER bun

# Expose HTTP port (default 3000, overridable via PORT env var)
EXPOSE 3000

# DATABASE_URL must be provided at runtime — no default connection in container
# Example: docker run -e DATABASE_URL=postgres://admin:pass@host:5432/postgres ...
ENTRYPOINT ["bun", "run", "src/index.ts"]

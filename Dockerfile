# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM oven/bun:1.3.11 AS install

# Install dev deps
WORKDIR /temp/dev
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install production deps only
WORKDIR /temp/prod
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM oven/bun:1.3.11 AS release
WORKDIR /app

COPY --from=install /temp/prod/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

USER bun
EXPOSE 3000
ENTRYPOINT ["bun", "run", "./src/index.ts"]

# syntax=docker/dockerfile:1.7
# BudgetPro production image — multi-stage, Next.js 16 standalone.
# Built for FO Holding deployment on PASHA Technology VM.

# ═════════════════════════════════════════════════════════════════════════════
# Stage 1: deps — install npm dependencies against pinned lockfile
# ═════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

# `npm ci` is reproducible and ~3× faster than `npm install` in CI contexts.
RUN npm ci --no-audit --no-fund

# ═════════════════════════════════════════════════════════════════════════════
# Stage 2: build — generate Prisma client and compile Next.js standalone bundle
# ═════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS build

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client is required by the build (server components / API routes import it).
RUN npx prisma generate

# Disable telemetry; `output: "standalone"` is already set in next.config.ts.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ═════════════════════════════════════════════════════════════════════════════
# Stage 3: runtime — minimal image, non-root user, standalone server
# ═════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS runtime

# tini = PID 1 signal forwarder so Ctrl+C / SIGTERM actually stops the app.
# curl = healthcheck.
RUN apk add --no-cache libc6-compat openssl curl tini

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# Non-root runtime user.
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Install the Prisma CLI globally — pinned to the version in package.json.
# This pulls in all of Prisma's transitive deps (@prisma/debug, @prisma/engines,
# @prisma/internals, @prisma/fetch-engine, …) cleanly, instead of cherry-picking
# individual folders from the build stage (fragile — breaks on minor-version
# bumps that add new transitive deps).
RUN npm install -g --no-fund --no-audit prisma@6.19.3

# Standalone Next.js output — includes only the node_modules Next.js traced
# for server-side imports. Prisma is listed in `serverExternalPackages` so it
# isn't bundled; we supply it via the COPYs below.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public          ./public

# In-app User Guide (`/guide`) reads `docs/USER_GUIDE.<lang>.md` at request time
# via fs. The standalone output does NOT trace plain data files, so without this
# COPY the guide 500s on prod (the file simply isn't in the image). Keep this in
# sync with any other page that reads from `docs/` at runtime.
COPY --from=build --chown=nextjs:nodejs /app/docs            ./docs

# Prisma schema + generated client, required at runtime:
#   /app/prisma                     → schema.prisma + migrations/ folder
#   /app/node_modules/.prisma       → generated client (types + WASM engine)
#   /app/node_modules/@prisma/client → @prisma/client package wrapper
COPY --from=build --chown=nextjs:nodejs /app/prisma                        ./prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma          ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma/client   ./node_modules/@prisma/client

# Entrypoint: run migrations then exec the server.
COPY --chown=nextjs:nodejs deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

# Simple healthcheck — any 200/30x response means the Next.js server is alive.
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD curl -fsS -o /dev/null http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]

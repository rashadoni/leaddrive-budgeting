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

# Keep the help-guide videos out of the Next build. They are pure runtime
# assets — streamed by /api/help-videos/[file], never imported by any module —
# but `COPY . .` puts them in front of the build's file tracer, which walks
# them and holds them in memory for nothing.
#
# 2026-08-04: adding the AI Import guide took video/player from ~20MB to ~51MB
# and the prod build died with "JavaScript heap out of memory" at 1.9GB on a
# 3.8GB server (node's default old-space ceiling is ~2GB there). The runtime
# stage now copies these straight from the build context instead of from this
# stage, so the image is unchanged and the next guide cannot push the build
# over the edge again.
RUN rm -rf video/player

# Prisma client is required by the build (server components / API routes import it).
RUN npx prisma generate

# Disable telemetry; `output: "standalone"` is already set in next.config.ts.
ENV NEXT_TELEMETRY_DISABLED=1
# The build peaks just under node's default ~2GB old-space ceiling on the 3.8GB
# prod server, and started tipping over it ("Ineffective mark-compacts near heap
# limit" at 1.9GB). CI hit the identical wall at 2009MB on an unchanged commit,
# so this is the build's real size, not a leak introduced by one branch. 2560MB
# leaves the server ~1.2GB for postgres and the running container during the
# build; going higher would trade a heap error for the OOM killer.
ENV NODE_OPTIONS=--max-old-space-size=2560
# Skip the type-check phase here only — see the long note in next.config.ts.
# Compilation itself finishes in ~35s; it was the type-check that sat for ten
# minutes and got SIGKILLed by the OOM killer on this 3.8GB box. Types are
# already gated by the pre-commit hook and by CI's own `tsc --noEmit`, and
# deploy/update-prod.sh only ships commits that are origin/main with CI green.
ENV DOCKER_BUILD_SKIP_TYPECHECK=1
RUN npm run build

# ═════════════════════════════════════════════════════════════════════════════
# Stage 3: runtime — minimal image, non-root user, standalone server
# ═════════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS runtime

# tini = PID 1 signal forwarder so Ctrl+C / SIGTERM actually stops the app.
# curl = healthcheck. System Chromium is required by the authenticated,
# read-only Board Deck PDF renderer; Playwright's downloaded browser is not
# present in the minimal standalone runtime image.
RUN apk add --no-cache libc6-compat openssl curl tini chromium

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

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

# tsx — run the TypeScript admin/maintenance scripts (scripts/*.ts) on prod
# (e.g. create-admin, rotate-admin-password). Node 20 can't strip TS types
# natively, and the standalone image ships no dev toolchain, so without this a
# `docker compose exec app npx tsx scripts/…` fails. Major-pinned (no breaking
# jumps); it's only used for occasional operator scripts, never on the request path.
RUN npm install -g --no-fund --no-audit tsx@4

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

# Operator scripts (scripts/*.ts) + their runtime deps. The standalone output
# doesn't trace CLI scripts or their imports, so ship them explicitly so
# `npx tsx scripts/…` works on prod (create-admin, rotate-admin-password).
# bcryptjs is a zero-dep pure-JS package (used for password hashing); Prisma is
# already copied above. `crypto` is a Node builtin.
COPY --from=build --chown=nextjs:nodejs /app/scripts                       ./scripts
COPY --from=build --chown=nextjs:nodejs /app/node_modules/bcryptjs         ./node_modules/bcryptjs
# Git-tracked help-guide videos, served by /api/help-videos/[file]. The
# standalone output does not trace plain data files, so copy them explicitly.
# Straight from the build CONTEXT, not from the build stage — that stage deletes
# them before `npm run build` so the Next file tracer never walks ~51MB of mp4
# (see the note there). Same files in the image either way.
COPY --chown=nextjs:nodejs video/player ./video/player

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

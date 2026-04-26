#!/bin/sh
# BudgetPro container entrypoint.
# Runs pending Prisma migrations against DATABASE_URL, then execs the server.
# Any failure here stops the container before it starts serving traffic —
# that's intentional (fail-fast beats silently running an out-of-date schema).

set -e

echo "→ [entrypoint] Applying pending Prisma migrations (migrate deploy)..."
prisma migrate deploy

echo "→ [entrypoint] Migrations up to date. Starting Next.js server..."
exec "$@"

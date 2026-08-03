#!/bin/sh
# BudgetPro container entrypoint.
# Runs pending Prisma migrations against DATABASE_URL, then execs the server.
# Any failure here stops the container before it starts serving traffic —
# that's intentional (fail-fast beats silently running an out-of-date schema).

set -e

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  echo "→ [entrypoint] Applying pending Prisma migrations (migrate deploy)..."
  prisma migrate deploy
  echo "→ [entrypoint] Migrations up to date."
else
  echo "→ [entrypoint] Skipping migrations; a dedicated migration job owns schema changes."
fi

echo "→ [entrypoint] Starting Next.js server..."
exec "$@"

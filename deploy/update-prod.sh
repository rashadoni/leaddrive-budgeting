#!/usr/bin/env bash
#
# One-command prod deploy — runs on the developer machine.
#
#   bash deploy/update-prod.sh
#
# Flow: guard (main + clean tree) → prod DB backup → `git push prod main`
# (server worktree updates via receive.denyCurrentBranch=updateInstead) →
# stamp .deploy-revision → docker compose rebuild (migrations run in the
# entrypoint on startup) → smoke test.
#
# ONE-TIME SETUP (already documented in deploy/README.md §4):
#   ssh root@46.225.60.142 'cd /opt/budgetpro && git init -b main -q \
#     && git config receive.denyCurrentBranch ignore \
#     && git config --global --add safe.directory /opt/budgetpro'
#   git remote add prod ssh://root@46.225.60.142/opt/budgetpro
#   git push prod main
#   ssh root@46.225.60.142 'cd /opt/budgetpro && git reset --hard main -q \
#     && git config receive.denyCurrentBranch updateInstead'
#
# No credentials live on the server: the VM never talks to GitHub (repo is
# private); code travels over the same SSH access used for administration.

set -euo pipefail

PROD_HOST="root@46.225.60.142"
APP_DIR="/opt/budgetpro"

SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$BRANCH" != "main" ]; then
  echo "✗ Deploy only from main (current: $BRANCH)" >&2
  exit 1
fi
# Clean-tree guard ignores .claude/ — local harness settings (permission
# allow-lists) legitimately stay uncommitted on dev machines.
if [ -n "$(git status --porcelain --untracked-files=no -- ':(exclude).claude')" ]; then
  echo "✗ Working tree not clean — commit or stash first." >&2
  exit 1
fi
if ! git remote get-url prod >/dev/null 2>&1; then
  echo "✗ No 'prod' remote — run the one-time setup in the header comment." >&2
  exit 1
fi

echo "→ Backing up prod DB…"
ssh "$PROD_HOST" "cd $APP_DIR && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production exec -T db \
     pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\" \
   | gzip > backups/pre-deploy-\$(date +%F-%H%M).sql.gz"

echo "→ Pushing $SHA to prod…"
git push prod main

echo "→ Stamping revision + rebuilding containers…"
ssh "$PROD_HOST" "cd $APP_DIR && printf '%s\n' '$SHA' > .deploy-revision \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production up -d --build"

echo "→ Waiting for app health…"
ssh "$PROD_HOST" "cd $APP_DIR \
  && for i in \$(seq 1 30); do \
       s=\$(docker inspect -f '{{.State.Health.Status}}' budgetpro-app 2>/dev/null || echo starting); \
       [ \"\$s\" = healthy ] && break; sleep 5; done; \
  docker compose ps --format '{{.Name}} {{.Status}}' \
  && docker compose logs app 2>/dev/null | grep -iE 'migrat|error' | tail -6 \
  && curl -s -o /dev/null -w 'HTTP /login: %{http_code}\n' http://localhost/login"

echo "✓ Deployed $SHA"

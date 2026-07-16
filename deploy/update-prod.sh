#!/usr/bin/env bash
#
# One-command prod deploy — runs on the developer machine.
#
#   bash deploy/update-prod.sh
#
# Flow: guard (main + clean tree + already pushed to origin) → verified prod
# DB backup → `git push prod main` (server worktree updates via
# receive.denyCurrentBranch=updateInstead) → docker compose rebuild
# (migrations run in the entrypoint) → health + HTTP smoke → stamp the
# successfully deployed revision.
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
# Refresh the tracking ref before comparing. A cached origin/main can equal
# HEAD even after another actor advanced GitHub main, which would let this
# laptop deploy a stale commit while claiming origin parity.
git fetch --quiet origin main
if [ "$(git rev-parse origin/main)" != "$SHA" ]; then
  echo "✗ HEAD is not origin/main — push the reviewed commit and pass CI before deploying." >&2
  exit 1
fi

echo "→ Backing up prod DB…"
BACKUP_FILE="backups/pre-deploy-$(date -u +%Y-%m-%dT%H%M%SZ)-${SHA:0:12}.sql.gz"
# Run through bash explicitly: `pipefail` makes a failed pg_dump fail the
# deploy even if gzip exits cleanly. `noclobber` + second-resolution UTC name
# prevents an immediate retry from replacing the only recovery point; umask
# and chmod keep financial data root-readable only. gzip -t proves that the
# completed artifact is structurally readable before any code is pushed.
ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && umask 077 && set -o pipefail && set -o noclobber \
  && docker compose --env-file .env.production exec -T db \
     pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\" \
   | gzip > \"$BACKUP_FILE\" \
  && gzip -t \"$BACKUP_FILE\" \
  && chmod 600 \"$BACKUP_FILE\"'"
echo "✓ Verified prod DB backup: $BACKUP_FILE"

echo "→ Pushing $SHA to prod…"
git push prod main

echo "→ Rebuilding containers…"
ssh "$PROD_HOST" "cd $APP_DIR \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production up -d --build"

echo "→ Waiting for app health…"
ssh "$PROD_HOST" "set -e
  cd $APP_DIR
  healthy=0
  for i in \$(seq 1 30); do
    s=\$(docker inspect -f '{{.State.Health.Status}}' budgetpro-app 2>/dev/null || echo starting)
    if [ \"\$s\" = healthy ]; then healthy=1; break; fi
    sleep 5
  done
  if [ \"\$healthy\" -ne 1 ]; then
    docker compose ps --format '{{.Name}} {{.Status}}' || true
    docker compose logs --tail=80 app 2>/dev/null || true
    echo '✗ App did not become healthy within 150 seconds' >&2
    exit 1
  fi
  code=\$(curl -sS --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' http://localhost/login)
  printf 'HTTP /login: %s\n' \"\$code\"
  if [ \"\$code\" != 200 ]; then
    echo '✗ Login smoke check failed' >&2
    exit 1
  fi
  printf '%s\n' '$SHA' > .deploy-revision
  docker compose ps --format '{{.Name}} {{.Status}}'
  docker compose logs app 2>/dev/null | grep -iE 'migrat|error' | tail -6 || true"

echo "✓ Deployed $SHA"

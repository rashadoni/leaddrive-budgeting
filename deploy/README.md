# BudgetPro — Production Deployment Runbook

Target: single VM at PASHA Technology, running Ubuntu 22.04 LTS.
Stack: Docker Compose → Nginx (reverse proxy) → Next.js 16 standalone app → Postgres 16.

> **Before first deploy:** Phase 7.A schema changes (in `prisma/schema.prisma`) are uncommitted / local-only and should be stashed so the deploy builds against a clean schema. `git stash push -m "phase-7A-foundation" -- prisma/schema.prisma` → run deploy → `git stash pop` to resume Phase 7.A work.

---

## 1. VM prerequisites (one-time, ~10 min)

SSH into the VM with a public-key-authenticated user that has sudo.

```bash
# System packages
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl ca-certificates gnupg git ufw

# Docker Engine + Compose plugin (official Docker repo)
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Non-root docker
sudo usermod -aG docker $USER
newgrp docker   # or re-login

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Verify: `docker --version && docker compose version`.

---

## 2. First deploy (~15 min)

> **Shortcut:** once `.env.production` is filled (step 2 below), `bash
> deploy/first-deploy.sh` automates steps 3-5 (build+start, RLS roles, seed
> admin) — idempotent, prompts for the role passwords, prints the remaining
> manual steps. The detailed steps below are the source of truth / for when you
> want to run them by hand.

```bash
# Clone repo
cd /opt
sudo git clone <git-url> budgetpro
sudo chown -R $USER:$USER budgetpro
cd budgetpro

# Configure environment
cp .env.production.example .env.production
nano .env.production
#  → fill POSTGRES_PASSWORD (openssl rand -base64 24)
#  → fill NEXTAUTH_SECRET (openssl rand -base64 32)
#  → set NEXTAUTH_URL to the real host (e.g. http://203.0.113.5 or https://budget.fo.az)

# Prepare nginx cert directory (empty for HTTP-only first boot)
mkdir -p deploy/nginx/certs

# Build & start
docker compose --env-file .env.production up -d --build

# Watch logs until you see "Ready in XXXms" from the app container
docker compose logs -f app
```

**Expected at first startup:**
- `db` container healthy in ~20s
- `app` entrypoint runs `prisma migrate deploy` — creates all tables in the fresh DB
- `app` Next.js server bound to `0.0.0.0:3000`
- `nginx` proxies `:80` → `app:3000`

> **Migration path verified end-to-end (2026-05-31).** `prisma migrate deploy` was run against a throwaway fresh DB: it applies the single `00000000000000_init` baseline → **60 tables + 56 RLS policies + 7 enums**, recorded in `_prisma_migrations`. The entrypoint is fail-fast (`set -e`), so a migration error stops the container before it serves traffic.
>
> ⚠️ **If the baseline is ever regenerated from `pg_dump`** (`prisma/migrations/00000000000000_init/migration.sql`) — e.g. after a future schema squash — strip the two pg_dump artifacts that break Prisma's migration engine (it runs SQL directly, not via `psql`):
> 1. the `\restrict` / `\unrestrict` psql meta-commands (top + bottom of the dump);
> 2. `SELECT pg_catalog.set_config('search_path', '', false);` — it empties the session search_path, so `migrate deploy` applies the schema but then fails **P1014** recording `_prisma_migrations`. Replace it with `SET search_path = public;`.
>
> `migrate dev` does NOT surface #2 (its shadow flow differs) — always test a regenerated baseline with `migrate deploy` against a fresh DB.

Open `http://<VM-IP>/` — you should see the BudgetPro login page.

### Create the first admin user

The app ships with no users in a fresh DB. Seed one:

```bash
docker compose exec app node -e "
  const bcrypt = require('bcryptjs');
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const org = await p.organization.upsert({
      where: { slug: 'fo-holding' },
      update: {},
      create: { name: 'FO Holding', slug: 'fo-holding' },
    });
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'change-me-on-login', 12);
    await p.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email: 'admin@fo.az' } },
      update: { passwordHash: hash, role: 'admin' },
      create: {
        organizationId: org.id,
        email: 'admin@fo.az',
        name: 'FO Admin',
        passwordHash: hash,
        role: 'admin',
        isActive: true,
      },
    });
    console.log('✓ admin@fo.az seeded (change password immediately)');
    await p.\$disconnect();
  })();
"
```

Then log in and change the password via the UI.

### Provision the RLS roles (Phase 5.2 — required for DB-layer tenant isolation)

The `*_rls_*` migrations enable Row-Level Security + create per-org policies,
but the two Postgres ROLES they rely on must be created manually (once),
AFTER the migrations have created the tables. Skipping this is not a crash —
the app falls back to the default DB user and RLS is simply NOT enforced at
the DB layer (app-layer `where: { organizationId }` still isolates tenants),
so you lose the defence-in-depth. For a hardened deploy:

```bash
# 1. BYPASSRLS role for migrations + cross-org cron (budgetpro_admin)
docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB" \
  -v admin_password="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)" \
  -v db_name="$POSTGRES_DB" \
  < scripts/sql/create-bypass-role.sql

# 2. Restricted RLS-enforced role for request handlers (budgetpro_app)
docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB" \
  -v app_password="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)" \
  -v db_name="$POSTGRES_DB" \
  < scripts/sql/create-app-role.sql
```

Then set `DATABASE_URL_ADMIN` + `DATABASE_URL_APP` in `.env.production` to the
two roles' connection strings (host `db`, port 5432, same database; each with
the password you passed above) and restart: `docker compose --env-file
.env.production restart app`. Verify isolation with the RLS integration test
(`DATABASE_URL_APP=... npx vitest run src/lib/db/rls-leak.integration.test.ts`).
See `docs/DEPLOYMENT_READINESS.md` §8.2 for the full RLS posture.

---

## 3. TLS setup (after the HTTP deploy is working)

Two paths — pick one.

### 3a. Let's Encrypt (public domain, recommended)

Requires: domain DNS pointing at the VM's public IP. Port 80 reachable.

```bash
# Install certbot standalone
sudo apt -y install certbot

# Temporarily stop nginx so certbot can bind :80
docker compose stop nginx
sudo certbot certonly --standalone -d budget.fo.az --agree-tos -m admin@fo.az --non-interactive

# Copy certs where nginx container can read them
sudo cp /etc/letsencrypt/live/budget.fo.az/fullchain.pem deploy/nginx/certs/
sudo cp /etc/letsencrypt/live/budget.fo.az/privkey.pem   deploy/nginx/certs/
sudo chown $USER:$USER deploy/nginx/certs/*

# Uncomment the HTTPS server block in deploy/nginx/budgetpro.conf,
# AND uncomment the `return 301 https://...` redirect in the HTTP block.
# Update NEXTAUTH_URL in .env.production to https://budget.fo.az.
nano deploy/nginx/budgetpro.conf
nano .env.production

# Restart stack
docker compose --env-file .env.production up -d

# Auto-renew (adds a cron job)
sudo systemctl enable --now certbot.timer
```

### 3b. Internal PKI cert from PASHA Technology

If FO has an internal CA, ask IT for a cert + key for `budget.fo.az` (or whatever host). Drop the two files into `deploy/nginx/certs/` as `fullchain.pem` and `privkey.pem`, then same uncomment-and-restart as above.

---

## 4. Subsequent updates

Standard flow for code / schema changes:

```bash
cd /opt/budgetpro
git pull
docker compose --env-file .env.production up -d --build

# Watch migrations run on startup
docker compose logs -f app
```

Rollback (in case of broken build):

```bash
git reset --hard <previous-good-sha>
docker compose --env-file .env.production up -d --build
```

---

## 5. Backups

Daily Postgres dump (add to crontab — `crontab -e`):

```cron
15 2 * * * cd /opt/budgetpro && docker compose exec -T db pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > /opt/budgetpro/backups/budgetpro-$(date +\%F).sql.gz
0 3 * * 0 find /opt/budgetpro/backups -name "budgetpro-*.sql.gz" -mtime +30 -delete
```

Create the directory first: `mkdir -p /opt/budgetpro/backups`.

### Restore

```bash
gunzip -c backups/budgetpro-YYYY-MM-DD.sql.gz | \
  docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB
```

---

## 6. Migrating existing AAC data from local dev DB

On local Mac:

```bash
# From the project root where docker-compose.yml lives (dev setup)
pg_dump "postgresql://user:password@localhost:5432/budgetpro" \
  --no-owner --no-acl --clean --if-exists \
  | gzip > /tmp/aac-initial.sql.gz

# SCP to VM
scp /tmp/aac-initial.sql.gz user@<VM-IP>:/tmp/
```

On VM:

```bash
cd /opt/budgetpro
# Stop the app so nothing writes during restore
docker compose stop app
gunzip -c /tmp/aac-initial.sql.gz | \
  docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB
docker compose start app
```

---

## 7. Troubleshooting

| Symptom | Diagnose |
|---|---|
| `docker compose up` hangs at build | `docker system df` then `docker system prune -af` to free space |
| `app` container restart-loops | `docker compose logs app` — look for Prisma migration errors; usually means `DATABASE_URL` is wrong |
| 502 Bad Gateway from nginx | `docker compose ps` — is `app` healthy? `docker compose logs app` |
| NextAuth "callback error" / login redirects broken | `NEXTAUTH_URL` in `.env.production` must exactly match the URL in the browser (protocol + host + port) |
| Healthcheck failing but app works in browser | Sometimes healthcheck timeout is too tight during slow first boot — tweak `HEALTHCHECK` interval in Dockerfile |
| Port 80/443 blocked | `sudo ufw status` + `sudo ss -tlnp` — check nothing else is holding the port |

---

## 8. Emergency: full reset

**⚠️ Destroys all data. Confirm before running.**

```bash
cd /opt/budgetpro
docker compose down -v      # -v wipes the pgdata volume
docker compose --env-file .env.production up -d --build
# → then re-seed admin user (see § 2)
# → then restore backup if needed (see § 5)
```

---

## Appendix: what goes into a new version

Checklist when shipping a new version:
1. ✅ All tests pass locally
2. ✅ `npx prisma validate` clean
3. ✅ `npm run build` succeeds locally
4. ✅ If schema changed: migration reviewed (`prisma migrate dev --name <desc>` generated a SQL file under `prisma/migrations/`)
5. ✅ `.env.production.example` updated if new env vars were added
6. ✅ This README updated if the deployment process changed
7. ✅ Git tag for the release: `git tag v1.x.y && git push --tags`

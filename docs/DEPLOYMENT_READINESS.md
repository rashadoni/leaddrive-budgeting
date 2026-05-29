# BudgetPro — Deployment Readiness

**Audience:** SRE / DevOps reviewer signing off before a production push.
Differs from `deploy/README.md` (sysadmin one-time setup) and
`ADMIN_RUNBOOK.md` (operational admin running the system day-to-day).

This doc is the **pre-deploy gate** — the checklist + reference an
on-call reviewer walks through to confirm the stack is ready for
real-customer load.

**Phase status (updated 2026-05-29, Phase 8):** The app deploys via
`deploy/README.md`'s Docker Compose flow (single-VM target). Since the v1 of
this doc (2026-05-03), shipped + relevant to a deploy: **Phase 5.2 RLS** (two
Postgres roles + `withOrgScope` on 16 routes — §1 + §8.2 updated), **Phase 6
BullMQ/Redis** queue behind `QUEUE_BACKEND` (§1.1 updated), the **Phase 8 G3
auth-gate audit** (`docs/AUTH_GATE_AUDIT.md` — 0 exposed endpoints; F1 SSE gate
shipped, F3 `/api` middleware deferred — see §8.2), CI `tsc --noEmit` gate, and
the M7 + visual-baseline regression gates. Vercel serverless is still a future
target with the §4.3 gaps open.

---

## 1. Environment variable matrix

Every env var the app reads, where it's referenced, who supplies it,
rotation cadence, and what breaks if it's wrong.

| Var | Required | Read from | Supplier | Rotation | Failure mode if wrong |
|-----|----------|-----------|----------|----------|------------------------|
| `DATABASE_URL` | YES | `prisma/schema.prisma`, all Prisma calls | DBA | Never (rotate via password change in `POSTGRES_PASSWORD`) | App container restart-loops; logs show Prisma `P1001` |
| `DATABASE_URL_ADMIN` | YES (RLS) | `src/lib/prisma-admin.ts` — BYPASSRLS role for migrations + admin/cron paths | DBA | With `budgetpro_admin` pw | RLS migrations + admin tasks fail; falls back to default client |
| `DATABASE_URL_APP` | YES (RLS) | `withOrgScope` (16 org-scoped routes) — restricted `budgetpro_app` role, NO BYPASSRLS | DBA | With `budgetpro_app` pw | DB-layer tenant isolation NOT enforced (app-layer org-scope still holds, but defence-in-depth lost) |
| `QUEUE_BACKEND` | NO (default `inprocess`) | `src/lib/queue/feature-flag.ts` | SRE | Never | `bullmq` without a running worker → recompute jobs never drain |
| `REDIS_URL` | NO (only if `QUEUE_BACKEND=bullmq`) | `src/lib/queue/redis-client.ts` | SRE | On Redis credential change | BullMQ worker can't connect; jobs queue with no consumer |
| `LOG_LEVEL` | NO (default `info`) | `src/lib/log.ts` | SRE | Never | Wrong verbosity only |
| `POSTGRES_USER` | YES (deploy) | `docker-compose.yml` | DBA | Annual or on incident | DB container won't init |
| `POSTGRES_PASSWORD` | YES (deploy) | `docker-compose.yml` | DBA | Annual or on incident | App can't connect; downstream of `DATABASE_URL` |
| `POSTGRES_DB` | YES (deploy) | `docker-compose.yml` | DBA | Never | DB container won't init |
| `NEXTAUTH_SECRET` | YES | next-auth (implicit at runtime) | SRE | Annual; rotate together with all sessions invalidating | Logins fail with cryptic JWT errors |
| `NEXTAUTH_URL` | YES | next-auth (implicit) | SRE | When DNS / TLS / port changes | Login redirect loop; OAuth callback fails (if added) |
| `ANTHROPIC_API_KEY` | NO | `src/lib/ai/client.ts:hasAnthropicKey()` + `runMapper`/explain endpoints | Product owner / SRE | Quarterly OR on suspected leak | AI Data Mapper analyze returns 503; Variance Explainer disabled (graceful degradation) |
| `NODE_ENV` | YES | next-build, prisma | Build pipeline | Never | Wrong build output (dev mode in prod) |
| `ADMIN_EMAIL` | NO (script-only) | `scripts/create-admin.ts` | Operator | Per-script-run | Script falls back to `admin@budgetpro.com` |
| `ADMIN_PASSWORD` | NO (script-only) | `scripts/create-admin.ts` | Operator | Per-script-run | Script falls back to a default; user must change on first login |
| `ADMIN_ORG_NAME` | NO (script-only) | `scripts/create-admin.ts` | Operator | Per-script-run | Falls back to "Default Organization" |
| `ADMIN_ORG_SLUG` | NO (script-only) | `scripts/create-admin.ts` | Operator | Per-script-run | Falls back to "default-org" |
| `HOME` | (set by OS) | `scripts/pre-demo-check.sh` | OS / shell | N/A | Pre-demo script can't find `~/Downloads/DEMO-CO.xlsx` |

**Provenance check:** `grep -rn "process\.env\." src/ scripts/` — any new
env var added MUST be reflected in this table AND
`.env.production.example`. The pre-deploy reviewer should diff the two
to catch drift.

### 1.1 What's NOT in the matrix (and why)

- `REDIS_URL` / BullMQ — **shipped Phase 6** (now IN the §1 matrix), behind
  the `QUEUE_BACKEND` flag (default `inprocess`). Only needed if you run the
  dedicated worker (`scripts/run-worker.ts`); see `docs/QUEUE_RUNBOOK.md`.
- `SMTP_*` / `RESEND_API_KEY` — no email pipeline yet (alerts surface
  in-app only). Roadmap.
- `SENTRY_DSN` / `DATADOG_API_KEY` — no APM/error-tracking integration
  yet. Phase 7.G+ scope.
- `STRIPE_*` / billing — explicitly out of scope (FO Holding is internal-
  use; subscription model not in Phase 7).

---

## 2. Secrets management

### 2.1 Generation

```bash
# NEXTAUTH_SECRET (32 bytes base64)
openssl rand -base64 32

# POSTGRES_PASSWORD (24 chars, URL-safe)
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24

# Admin user password (operator chooses or generates)
openssl rand -base64 16 | tr -d '/+=' | cut -c1-16
```

### 2.2 Storage

Production: `.env.production` on the VM, **never committed to git**
(`.gitignore` excludes it). File mode `0600`, owned by the docker-
running user.

```bash
chmod 0600 /opt/budgetpro/.env.production
ls -l /opt/budgetpro/.env.production   # -rw------- 1 user user
```

Backup: store a copy in 1Password / vault under "FO Holding —
budgetpro production env". DO NOT store in S3 / GitHub Secrets / public
cloud KMS without org sign-off.

### 2.3 Rotation playbook

**Annual rotation (NEXTAUTH_SECRET):**
1. Generate new secret (§2.1)
2. Edit `.env.production` on VM
3. `docker compose --env-file .env.production up -d` (no rebuild needed)
4. **All existing sessions invalidate** — users must re-login
5. Notify users 24h ahead

**Postgres password rotation:**
1. Connect to running DB: `docker compose exec db psql -U $POSTGRES_USER`
2. `ALTER USER budgetpro WITH PASSWORD '<new>';`
3. Update `POSTGRES_PASSWORD` in `.env.production`
4. Update `DATABASE_URL` (the `:password@` segment)
5. `docker compose --env-file .env.production restart app`
6. Verify `docker compose logs app` — no `P1001`

**Anthropic key rotation (suspected leak):**
1. Generate new key in Anthropic console
2. Edit `.env.production`
3. `docker compose --env-file .env.production restart app`
4. Revoke old key in Anthropic console (within 1h of rotation)
5. Audit: `grep ANTHROPIC ~/Library/Logs/budgetpro.log` for any unexpected callers

### 2.4 Who has access

Document in your org's secrets vault. Minimum:
- 1 primary SRE (knows the rotation flow)
- 1 backup SRE (can run rotation if primary unavailable)
- 0 developers (developers should NEVER need prod secrets;
  staging/dev have separate keys)

---

## 3. Migration runbook

### 3.1 Migration lifecycle

```
DEV → MIGRATE-DEV → COMMIT → PR REVIEW → STAGING DEPLOY → SANITY CHECK → PROD DEPLOY
```

Concrete steps per phase:

**DEV (developer machine):**
```bash
# Edit prisma/schema.prisma
npx prisma migrate dev --name descriptive_change_name --skip-seed
# → generates prisma/migrations/<timestamp>_<name>/migration.sql
# → applies to local DB
# → commits both schema.prisma + the migration folder
```

**STAGING (recommended for any non-trivial schema change):**
```bash
ssh staging-vm
cd /opt/budgetpro
git pull
docker compose --env-file .env.production up -d --build
# Watch logs for: "X migrations applied successfully"
docker compose logs -f app | grep -i migrate
```

**PROD (after staging green for ≥24h):**
```bash
ssh prod-vm
cd /opt/budgetpro
git pull
docker compose --env-file .env.production up -d --build
# Watch logs same way
```

### 3.2 Risk classification

| Migration type | Risk | Reviewer required | Rollback strategy |
|---|---|---|---|
| `ADD COLUMN <name> <type> NULL` | LOW | Single dev | Remove column in next migration |
| `ADD COLUMN <name> <type> NOT NULL DEFAULT <v>` | LOW | Single dev | Same as above |
| `ADD INDEX` | LOW | Single dev | `DROP INDEX` |
| `ADD VALUE IF NOT EXISTS <enum>` | LOW | Single dev | Cannot remove enum values without dump-restore |
| `ADD TABLE` | LOW | Single dev | `DROP TABLE` |
| `RENAME COLUMN` | MEDIUM | 2 reviewers | Two-step: add new + backfill + drop old |
| `DROP COLUMN` (ever-populated) | HIGH | SRE + product owner | Dump column to side table first |
| `ALTER COLUMN TYPE` | HIGH | SRE + product owner | Two-step: add new typed column + backfill + swap |
| `DROP TABLE` | CRITICAL | SRE sign-off + manual cutover | Dump table first; can't auto-rollback |

The `prisma migrate dev` output includes a "destructive changes" warning
when it detects the latter categories — never ignore it.

### 3.3 Zero-downtime patterns

For HIGH/CRITICAL migrations, split across **2 deploys**:

**Deploy 1 — additive:** add new column / table / etc. App writes to
both old and new (dual-write). Reads still from old. Backfill via
script. Verify counts match.

**Deploy 2 — flip + cleanup:** app reads from new. Drop old in a
follow-up deploy after a week of no errors.

The codebase doesn't have a CI gate enforcing this — it's a discipline
the reviewer applies. Phase 7.G+ goal: add a destructive-change
detector to `pre-demo-check.sh` that auto-flags HIGH/CRITICAL diffs.

### 3.4 Rollback playbook

**Before-migration rollback (build broke, didn't get to migrate yet):**
```bash
git reset --hard <previous-good-sha>
docker compose --env-file .env.production up -d --build
```

**After-migration rollback (migrate ran but app is broken):**
1. Identify the bad migration: `npx prisma migrate status`
2. Determine if rollback SQL exists. Prisma does NOT auto-generate
   rollbacks — so:
   - Recent additive change: write a manual reverse migration
     (`ALTER TABLE foo DROP COLUMN bar`) + `prisma migrate dev --create-only`
     to register it.
   - Destructive change: restore from backup (§5 of `deploy/README.md`).
3. Apply: `npx prisma migrate deploy`
4. Restart app.

**Prisma's "failed migration" state:**
If `prisma migrate deploy` itself fails mid-flight, the `_prisma_migrations`
table records the failed row. To recover:
```bash
npx prisma migrate resolve --rolled-back <migration-name>
# OR if you've manually fixed the schema:
npx prisma migrate resolve --applied <migration-name>
```

---

## 4. Runtime models

The app has 3 deployment shapes, each with different operational
constraints.

### 4.1 LaunchAgent (local dev — `~/Library/LaunchAgents/com.budgetpro.dev.plist`)

- **What:** Long-running `next dev` process bound to `localhost:3000`,
  managed by macOS launchd.
- **Where:** Developer's local machine.
- **Single-instance lock:** Next.js 16 enforces "one dev server per
  port" via filesystem lock; manual `npm run dev` while the LaunchAgent
  is up will fail.
- **Restart:** `launchctl kickstart -k gui/501/com.budgetpro.dev`.
- **Logs:** `~/Library/Logs/budgetpro.log`.
- **Suitable for:** dev only. NEVER customer-facing.
- **Constraints:** No HTTPS; no rate-limit infrastructure; no IP allowlist;
  no SSL termination.

### 4.2 Docker Compose / single-VM (CURRENT prod target — `deploy/README.md`)

- **What:** `docker compose up` starts 3 containers: `db` (Postgres 16),
  `app` (Next.js 16 standalone), `nginx` (reverse proxy + TLS).
- **Where:** Single Ubuntu 22.04 VM at PASHA Technology data centre.
- **Process model:** Single Node.js process per `app` container.
  Long-lived `pg.Client` connections work fine (used by SSE LISTEN/NOTIFY
  in `/api/events/stream`).
- **Scale ceiling:** ~50 concurrent users on a 4-core / 8GB VM at Phase
  7's compute load. Vertical scale only (no Compose-level horizontal
  scale; would need swarm/k8s).
- **Restart:** `docker compose --env-file .env.production restart app`.
- **Logs:** `docker compose logs -f app`.
- **Suitable for:** production deployment for FO Holding's internal use.

### 4.3 Vercel serverless (FUTURE — multi-tenant SaaS path)

- **What:** Each Next.js route deployed as an independent serverless
  function. Cold-start latency on cold instances; warm-start sub-50ms.
- **Where:** Vercel Edge / regional functions.
- **KNOWN INFRASTRUCTURE GAPS** (must close before any Vercel deploy):
  - **SSE LISTEN/NOTIFY broken**: `/api/events/stream` opens a long-
    lived `pg.Client` LISTEN connection in `src/lib/events/use-event-stream.ts`.
    Vercel functions are stateless + short-lived (max 25s on Hobby,
    300s on Pro) — connection drops on every cold start. Need: Redis
    pub/sub OR dedicated Node service for SSE bridge OR move to Vercel
    Postgres LISTEN-supported tier. **Tracked: CARRYOVER L309 sub-1
    closure.**
  - **No background scheduler**: `POST /api/indicators` runs sync with
    a 500-pair cap; longer recomputes time out. Need: BullMQ + Redis
    OR Vercel Cron. **Tracked: CLAUDE.md "no background scheduler"
    gap.**
  - **No connection pooling**: Prisma's default per-instance pool
    (5 connections) × N concurrent function invocations would exhaust
    Postgres `max_connections=100` immediately at any scale. Need:
    PgBouncer OR Prisma Data Proxy OR Vercel Postgres pooled tier.
- **Suitable for:** future multi-tenant SaaS only AFTER above 3 gaps
  close.
- **Cost-shape:** function invocations are cheap; Postgres at scale is
  the bottleneck.

---

## 5. Pre-prod checklist

Before any production push, run this sequence:

### 5.1 Local pre-flight (dev machine)

```bash
bash scripts/pre-demo-check.sh
npm run test:e2e   # Phase 7.G Turn D — Playwright smoke (login + terminal)
```

What `pre-demo-check.sh` covers (per `scripts/pre-demo-check.sh`):
- TypeScript compiles clean
- All vitest tests pass
- `~/Downloads/DEMO-CO.xlsx` present + correct row count
- Dev server on port 3000 healthy
- Critical API endpoints return 307 (auth redirect)
- Auth-gate doesn't leak data
- `/budgeting?tab=pnl-report` load < 600ms
- AZMADE DB integrity (company / line / IV counts)
- `prisma migrate status` clean

What `npm run test:e2e` covers (per `e2e/smoke/`):
- Login form renders + accepts credentials + redirects to dashboard
- Risk Terminal renders the HeatMap component (real browser, real DB)
- Auth-gate: unauth `/budgeting/terminal` redirects to `/login`
- (Turn D.2/D.3 will add: wizard analyze+apply, recompute SSE event)

First-time on any machine: `npm run test:e2e:install` (downloads
Chromium browser binary, ~150MB).

What is NOT covered (production gates — manual checklist below):
- New env vars vs `.env.production.example` diff
- Migration risk classification (§3.2)
- Secrets rotation cadence
- Backup integrity (last successful run + restoration test)
- Smoke test against staging environment (run `E2E_BASE_URL=https://staging.budget.fo.az npm run test:e2e` to extend)

### 5.2 Production gate checklist (manual, ~15 min)

**1. Code health (re-run on prod-target branch):**
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npx vitest run` 100% pass
- [ ] `npm run build` exit 0
- [ ] `npx prisma validate` exit 0

**2. Schema / migration review:**
- [ ] `git log --oneline <last-prod-tag>..HEAD prisma/migrations/` —
      enumerate every migration since last prod
- [ ] Classify each migration per §3.2 risk table
- [ ] HIGH/CRITICAL → second reviewer + zero-downtime split (§3.3)
- [ ] LOW → single-pass deploy OK

**3. Env var diff:**
- [ ] `git diff <last-prod-tag>..HEAD .env.production.example` —
      no new keys
- [ ] If new keys exist: matrix in §1 of this doc updated +
      `.env.production` on prod VM has the new keys

**4. Secrets:**
- [ ] No new secret leaked in commit messages or in code (`grep -rn
      "API_KEY\|SECRET\|PASSWORD" --include="*.ts" --include="*.tsx"`)
- [ ] `.gitignore` still excludes `.env*` files (except `.example`)
- [ ] Last NEXTAUTH_SECRET rotation > 11 months → schedule rotation

**5. Backup:**
- [ ] Last successful backup ≤ 24h old (`ls -lh /opt/budgetpro/backups/`)
- [ ] Test restore documented + completed within last quarter
      (§5 of `deploy/README.md` for restore command)

**6. Staging soak (skip for HOTFIX only — document the skip):**
- [ ] Deploy to staging
- [ ] Run `pre-demo-check.sh` against staging
- [ ] Real-user smoke test (login + open terminal + 1 import +
      1 recompute) ✓
- [ ] 24h soak with no error spikes in `~/Library/Logs/budgetpro.log`

**7. Production deploy:**
- [ ] Notify users 1h ahead (in-app banner OR email)
- [ ] `git pull && docker compose --env-file .env.production up -d --build`
- [ ] Watch logs for "Ready in XXXms" + zero migration errors
- [ ] Post-deploy: hit 3 critical paths (login, terminal, audit feed) in
      browser
- [ ] Tag the release: `git tag v1.x.y && git push --tags`

**8. Post-deploy monitoring (1h watch):**
- [ ] `docker compose logs -f app` — no error spikes
- [ ] Sample 3-5 real user sessions (if possible)
- [ ] Spot-check IndicatorValue counts (no unexpected drops)

### 5.3 Rollback gate (when to abort)

**Abort + rollback if any of:**
- Login broken (auth callback / NEXTAUTH_URL mismatch)
- Migration partially applied (`prisma migrate status` shows failed)
- > 5 errors in first 5 min of logs that aren't environmental
- 502 / 503 from nginx for > 30s

Rollback per §3.4. Notify users that the deploy was reverted.

---

## 6. Operational gotchas (lessons from Phase 7 development)

### 6.1 Long-running `pg.Client` connections

Used by SSE LISTEN/NOTIFY (`/api/events/stream` → `src/lib/events/use-event-stream.ts`).
On Docker / single-VM these work fine (single Node process, connection
held for app lifetime). On Vercel serverless these would die on every
cold start (see §4.3).

If you see "connection terminated unexpectedly" in logs → check whether
you're running on serverless OR if Postgres restarted.

### 6.2 LLM cost monitoring

`ANTHROPIC_API_KEY` enables AI Data Mapper + Variance Explainer +
Forecast Explainer. Per-call cost varies (~$0.01-0.10 depending on
xlsx size / prompt complexity). At 60-co scale with weekly imports +
daily explainer use, monthly bill is ~$200-500.

**Watch for runaway costs:**
- Anthropic console → Usage tab; set per-month budget alert
- App-side: every LLM call logs token usage in `IndicatorValue.inputs.usage`
  / `MappingProposal.usage`. Aggregate via SQL:

  ```sql
  -- Tokens consumed in last 30 days (variance explainer surface)
  SELECT
    DATE_TRUNC('day', "createdAt") AS day,
    COUNT(*) AS calls,
    SUM((inputs->'usage'->>'inputTokens')::int) AS input_tokens,
    SUM((inputs->'usage'->>'outputTokens')::int) AS output_tokens
  FROM "IndicatorValue"
  WHERE inputs->'usage' IS NOT NULL
    AND "createdAt" >= NOW() - INTERVAL '30 days'
  GROUP BY day
  ORDER BY day;
  ```

### 6.3 Migration application timing

The app entrypoint runs `prisma migrate deploy` on container start.
Long-running migrations BLOCK app boot. For HIGH/CRITICAL changes that
might take > 30s (e.g. adding NOT NULL column + backfill on a
large table), apply manually before deploy:

```bash
docker compose exec app npx prisma migrate deploy
# OR for a single migration:
docker compose exec db psql -U $POSTGRES_USER $POSTGRES_DB \
  -f /tmp/manual-migration.sql
```

Then restart the app once migrations are stable.

### 6.4 Recompute pipeline timeouts

`runRecomputeForCompanies` has no internal timeout — a stuck formula
would block the calling endpoint. The Next.js API route timeout is
the gate, set per-route via `export const maxDuration = 60` (e.g.
`src/app/api/indicators/route.ts:36`, `src/app/api/onboarding/import/analyze/route.ts:27`).
At Phase F scale (60×80 = 4800 pairs) bulk recomputes can exceed this.
Mitigation today: opt-out of inline sparkline; use
`scripts/compute-sparklines.ts` offline. Long-term: BullMQ background
jobs (CARRYOVER 🔄).

### 6.5 Nginx proxy buffering vs SSE

Default nginx `proxy_buffering on` will buffer SSE responses → users
see no events until buffer flushes (~4KB or 30s). The `deploy/nginx/`
config sets `proxy_buffering off` for `/api/events/stream` location.
Verify on first deploy:

```bash
curl -N -H "Cookie: <session>" http://<host>/api/events/stream
# Should stream events as they fire, not after a 30s buffer fill.
```

---

## 7. Disaster recovery scenarios

### 7.1 "Postgres data corruption"

```bash
# 1. Stop app to prevent further writes
docker compose stop app

# 2. Restore from latest backup
gunzip -c /opt/budgetpro/backups/budgetpro-LATEST.sql.gz \
  | docker compose exec -T db psql -U $POSTGRES_USER $POSTGRES_DB

# 3. Restart app
docker compose start app

# 4. Validate via pre-demo-check.sh row counts
bash scripts/pre-demo-check.sh
```

Acceptable data loss: up to 24h (gap between last cron backup and
incident). For tighter RPO, add WAL archiving (out of scope for
single-VM target; needs S3 / on-prem object store).

### 7.2 "VM hardware failure"

Cold-start a new VM:
1. Provision new Ubuntu 22.04 VM (§1 of `deploy/README.md`)
2. Install Docker (§1 of `deploy/README.md`)
3. Restore `.env.production` from secrets vault
4. `git clone` repo + `docker compose up`
5. Restore latest Postgres backup (§7.1)
6. Update DNS (NEXTAUTH_URL still works; nginx will pick up new IP)
7. Notify users of expected downtime (target: < 4h)

### 7.3 "Anthropic API outage"

AI features degrade gracefully:
- AI Data Mapper analyze → 503 with explicit message; user falls back
  to manual column mapping (existing UI supports this)
- Variance Explainer → loading state stalls; user sees the error
  surface; no data corruption
- Forecast Explainer → narrative card shows error; numeric forecast
  still computed via local OLS

No production action needed; incident resolves when Anthropic recovers.

### 7.4 "Suspected data breach"

1. Rotate `NEXTAUTH_SECRET` immediately (§2.3) — invalidates all sessions
2. Rotate `POSTGRES_PASSWORD`
3. Rotate `ANTHROPIC_API_KEY` (revoke old)
4. Audit `AuditEvent` table for unusual activity:

   ```sql
   SELECT "createdAt", action, "actorUserId", "ipAddress", "userAgent"
   FROM "AuditEvent"
   WHERE "createdAt" >= NOW() - INTERVAL '30 days'
     AND action IN ('user_login_failed', 'audit_event_export', 'organization_settings_update')
   ORDER BY "createdAt" DESC;
   ```

5. Check Postgres connection log for unusual IPs:

   ```bash
   docker compose exec db cat /var/lib/postgresql/data/log/postgresql-*.log \
     | grep "connection from" | sort | uniq -c | sort -rn | head -20
   ```

6. Notify org admin + security team. Document incident timeline.

---

## 8. Compliance posture

What this app does + does not do, for security/compliance review:

### 8.1 Data classification

| Data class | Stored where | Encrypted at rest | Encrypted in transit |
|---|---|---|---|
| User credentials (bcrypt hashes) | `User.passwordHash` | Filesystem-level only (no column-level) | TLS 1.3 (nginx) |
| Session JWTs | Browser cookie + `Session` table | Filesystem-level only | TLS 1.3 |
| Financial data (BudgetLine, etc.) | Prisma tables | Filesystem-level only | TLS 1.3 |
| AI prompts/responses (transient) | Anthropic API + ephemeral logs | TLS 1.3 in transit; not persisted by app | TLS 1.3 |
| Audit events | `AuditEvent` table | Filesystem-level only | TLS 1.3 |

**No column-level encryption today.** For PII/PCI compliance, add
`pgcrypto` + per-column AES on sensitive fields (User.email, etc.).
Roadmap; not Phase 7.

### 8.2 Access control

- **App-level RBAC**: `User.role ∈ {admin, manager, editor, viewer}` per Org,
  enforced per-handler via `requireRole` / `requireAuth` / `getOrgId`. The
  **Phase 8 G3 auth-gate audit** (`docs/AUTH_GATE_AUDIT.md`) verified per-method
  that 0 data-serving endpoints are unauthenticated across all 143 API routes.
- **Row-level security (RLS)**: **shipped Phase 5.2.** Two Postgres roles
  (`budgetpro_admin` BYPASSRLS for migrations/admin, `budgetpro_app` restricted
  for request handlers) + RLS policies; org-scoped routes run inside
  `withOrgScope` (16 routes) so tenant isolation is enforced at the DB layer,
  not just the app layer (`where: { organizationId }`). Set `DATABASE_URL_APP`
  + `DATABASE_URL_ADMIN` (§1) to activate it on prod.
- **API auth defence-in-depth (F3)**: a global `/api` middleware is DEFERRED —
  attempted 2026-05-29 via a `getToken` edge middleware but it broke NextAuth's
  `/api/auth/*` (Auth.js v5 catch-all interference); the correct split-config
  approach is documented in `docs/AUTH_GATE_AUDIT.md` (F3) for the deploy. Not a
  hole — every route already self-gates; this is the optional safety net.
- **Audit log**: `AuditEvent` records all state-changing operations
  with actorUserId + IP + userAgent. 365-day retention (daily physical-purge
  cron shipped Phase 1.4 / 7.M).

### 8.3 Backup + retention

- Postgres: daily dump (cron in `deploy/README.md` §5), 30-day retention
- Audit events: 365 days (documented), no auto-prune (manual until
  BullMQ scheduler ships)
- Application logs: rotated by Docker (default 10MB × 5 files per
  container)
- LLM call logs: never persisted by app; Anthropic retains per their
  policy

### 8.4 Incident response runbook

See §7. Time-to-detect / time-to-recover targets:
- TTD critical (login broken, data leak): < 1h via user report or log
  monitor (no formal monitoring shipped — relies on user signal today)
- TTR critical: < 4h (rollback OR full restore)

For SOC2 / ISO27001 readiness: ship Sentry/Datadog (out of scope today),
formalize on-call rotation, codify TTD/TTR via SLOs.

---

## 9. Cross-references

- **Sysadmin one-time setup** → `deploy/README.md`
- **Operational admin (day-to-day)** → `docs/ADMIN_RUNBOOK.md`
- **Developer roadmap + status** → `docs/ROADMAP.md`
- **Open architectural debt** → `docs/CARRYOVER.md`

---

## Versioning

This doc is **v1** (2026-05-03), Phase 7.G Turn B initial deliverable.
Changelog at the bottom of `docs/ROADMAP.md`.

### Open items tracked in CARRYOVER

- SSE LISTEN/NOTIFY infra for serverless prod deploy (§4.3)
- BullMQ + Redis scheduler for background jobs (§6.4)
- Audit event auto-prune cron (§7.3)
- Phase 7.H — self-serve org+admin creation UI (referenced in
  `ADMIN_RUNBOOK.md` §1.1-1.2 SQL-INSERT path; should not be the
  permanent user experience)

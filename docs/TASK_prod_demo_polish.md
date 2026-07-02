# TASK — Polish prod demo (Risk Terminal readiness)

Hand to Codex. Goal: make the prod Risk Terminal demo-ready — fewer blank cells,
no empty/clutter companies, no alarming artifacts.

## Environment
- Prod: Hetzner VM `root@46.225.60.142`, app dir `/opt/budgetpro`, Docker Compose
  (`db` / `app` / `nginx`), 8 GB. DB internal-only; reach it via the compose
  network `budgetpro_internal` or `docker compose exec db`.
- App image is a trimmed Next standalone bundle (no tsx/scripts inside) — run
  admin scripts via a one-off `node:20` container mounting `/opt/budgetpro`.
  `node_modules` likely already present from the earlier seed run (npm ci fast).

## Current prod state (verified 2026-06-30)
- 6 companies: `AZSEKER` (L1 holding), `AZSEKER-CPC`, `AZSEKER-EDEN`,
  `AZSEKER-PROMALT` (have P&L); `AZSEKER-DASTAN`, `AZSEKER-SAF` (empty, 0 P&L).
- 110 indicator definitions seeded. IndicatorValue status: **unknown 138**,
  green 16, amber 7, red 5. The 138 unknowns are feed-driven (no
  `intel_data_points` on prod).
- ESG: EDEN 86 (green), PROMALT 80 (green), **CPC 13.2 (red)**, DASTAN/SAF 100
  (unknown).

---

## Task 1 — PRIMARY: fetch external feeds on prod + recompute
Fills most of the 138 "unknown" cells (rainfall, commodity prices, CPI, FX, …).

**Backup first** (additive, but safe):
```bash
cd /opt/budgetpro && set -a && . ./.env.production && set +a
docker compose --env-file .env.production exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backups/pre-feeds-$(date +%F-%H%M).sql.gz
```

**Run feeds + recompute** (one-off node container on the internal network):
```bash
cd /opt/budgetpro && set -a && . ./.env.production && set +a
DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public"
docker run --rm --network budgetpro_internal -v /opt/budgetpro:/app -w /app \
  -e DATABASE_URL="$DB_URL" node:20 \
  bash -lc "npm ci --include=dev --no-audit --no-fund && npx prisma generate && \
    npx tsx scripts/fetch-phase-7k-feeds.ts && \
    npx tsx scripts/recompute-phase-7k.ts"
```

**Verify** (unknown count should drop, green/amber/red rise):
```bash
docker compose --env-file .env.production exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT status, count(*) FROM indicator_values GROUP BY status ORDER BY count(*) DESC"
```
Expected leftovers (fine): `un-comtrade-az` returns EMPTY (partial-year guard);
`eia-energy` / `usda-nass` are API-key-gated → stay unknown.

## Task 2 — empty companies DASTAN + SAF
Both have 0 `budget_lines` (only unknown indicators, ESG=100). For the demo:
**hide them** from the terminal/company tree, or label "not yet onboarded".
(Importing their data is the alternative if files exist.) Decide with Rashad.

## Task 3 — CPC ESG = 13.2 (red): verify, don't ship blind
CPC shows red ESG 13.2 while peers are 79–86 green. Check `IND_ESG_COMPOSITE`
inputs/resolver for CPC — real low ESG, or an artifact of partial data / the
AZSF-on-holding mapping? Fix or confirm before the client sees a red flagship.

## Task 4 — holding AZSEKER carries AZSF's P&L
AZSF was mapped to the holding (whole group) at import, so `AZSEKER` (L1) has its
own operating P&L (6.24M) — double-counts vs the children rollup (31.7M) — and
only 1 indicator (recompute did level=2 only). Options:
- create a dedicated `AZSEKER-AZSF` company + re-import AZSF there (cleanest), **or**
- accept holding-as-AZSF for the demo;
- and/or extend `recompute-phase-7k.ts` to include level=1 so the holding shows
  indicators.

## Guardrails
- Never build on the prod VM untested. The feed container only writes
  `intel_data_points` + `indicator_values` (additive) — safe, but the backup
  above is cheap insurance.
- Separate, bigger task (not here): the Balance-Sheet apply path —
  see `docs/AI_IMPORT_BS_APPLY_PLAN.md`.

# BudgetPro — Admin Runbook

**Audience:** Product/operations admin managing customer accounts, company data,
indicator catalog, alert tuning, and recompute pipelines. NOT for sysadmins
deploying infrastructure (see `deploy/README.md`) or developers shipping code
(see `CLAUDE.md`).

**Stack snapshot:** Next.js 16 + Prisma + PostgreSQL. Local dev runs on
`localhost:3000` via LaunchAgent. Production deploys via Docker Compose →
Nginx → Next.js standalone → Postgres 16.

**Phase status (as of 2026-05-03):** Phase 7.A–7.F operationally complete;
Phase 7.G (admin docs + E2E + sign-off) in progress. This runbook is one of
the Phase 7.G deliverables.

---

## 0. Quick reference card

The top-10 commands you'll run in a typical week.

| Task | Command / Path |
|------|----------------|
| Restart dev server | `launchctl kickstart -k gui/501/com.budgetpro.dev` |
| Tail dev logs | `tail -f ~/Library/Logs/budgetpro.log` |
| Apply pending migrations | `npx prisma migrate deploy` |
| Re-seed indicator catalog | `npx tsx scripts/seed-indicators.ts` |
| Re-seed industries | `npx tsx scripts/seed-industries.ts` |
| Recompute (after data change, single co) | UI: `POST /api/indicators` from IndicatorDetail "Recompute" button |
| Bulk recompute trigger | Implicit via `/api/onboarding/import/budget` POST or `scripts/import-azmade-budgets.ts` |
| Historical IV backfill | `npx tsx scripts/backfill-historical-ivs.ts --org=<slug> --years=2025 --dry-run` then drop `--dry-run` |
| Sparkline batch refresh | `npx tsx scripts/compute-sparklines.ts --orgSlug=<slug>` |
| Type-check | `npx tsc --noEmit` |
| Run all tests | `npx vitest run` |
| Pre-demo gate | `bash scripts/pre-demo-check.sh` |

UI surfaces (logged in as `admin@budgetpro.com`):

- `/budgeting/onboarding` — Onboarding wizard (AI Data Mapper)
- `/budgeting/terminal` — Risk Terminal (HeatMap, IndicatorDetail, AlertsPanel)
- `/budgeting/board-deck` — Board Deck export view
- `/settings` — Per-org alert threshold editor (admin role)

---

## 1. Customer onboarding (new org)

Onboarding a new customer means: create an Organization row, create the first
admin user, populate companies, populate the Chart of Accounts, then start
importing budgets.

### 1.1 Create the Organization

Today (Phase 7), there is **no self-serve org-creation UI**. Every org is
created via direct DB insert or via a one-off seed script. The expected
field shape:

```sql
INSERT INTO "Organization" (id, slug, name, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'acme-holding',          -- URL-safe slug, used in API paths
  'ACME Holding',           -- display name
  NOW(),
  NOW()
);
```

The `slug` is what most CLI scripts (`backfill-historical-ivs.ts`,
`compute-sparklines.ts`, `import-azmade-budgets.ts`) accept via
`--org=<slug>` / `--orgSlug=<slug>`.

### 1.2 Create the first admin user

```sql
-- 1. Create the User (auth.User table)
INSERT INTO "User" (id, email, name, "passwordHash", role, "organizationId", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'admin@acme.az',
  'ACME Admin',
  '$2b$10$...',  -- bcrypt hash; generate via `node -e "require('bcryptjs').hash('PASSWORD', 10).then(console.log)"`
  'admin',        -- 'admin' | 'manager' | 'viewer'
  '<the org id from 1.1>',
  NOW(),
  NOW()
);
```

After this, the user logs in at `/login` with their email + password.

### 1.3 Industries seed (one-time per environment)

The Industry catalog is a fixed list (industrial / agro_crops / hospitality /
pharma / retail / logistics / construction / real_estate / entertainment /
education / food_processing / beverage / poultry / services). Seed once per
environment:

```bash
npx tsx scripts/seed-industries.ts
```

Idempotent — re-runs don't duplicate.

### 1.4 Indicator catalog (one-time per environment)

The IndicatorDefinition catalog has ~52 indicators across 14 sectors plus 3
phase-3 cross-sector composites. Seed once per environment:

```bash
npx tsx scripts/seed-indicators.ts
```

This script runs three validation gates BEFORE writing:

1. **`validateAllSeedThresholds`** — every indicator's threshold band shape
   (green/amber/red ordering, band-amber must contain green, etc.) must be
   well-formed.
2. **`validateAllSeedRequiredInputs`** — every `requiredInputs` entry that
   uses `fact:` or `rollup:` namespace must parse cleanly.
3. **`validateAllSeedRollupShape`** — rollup-bearing indicators (those with
   `requiredInputs: ['rollup:...']`) MUST have `industries: []` (sector-
   agnostic). Sector-restricted rollups silently fire on every parent-co
   regardless of sector — bug class permanently closed at sub-44.

Idempotent. Re-run after every seed-file edit. Failure messages are explicit
and actionable.

### 1.5 Companies (Holding tree)

Two paths:

**Path A — bulk Excel import (preferred for ≥5 companies):**

```
1. Log in as admin
2. Go to /budgeting/onboarding (use the COMPANIES tab if/when added; today
   the UI focuses on budget import)
3. POST /api/onboarding/import/companies with multipart-form xlsx body
```

The endpoint expects a 2-column xlsx: Level 1 sub-group rows (level=1, no
parent) and Level 2 operational rows (level=2, parentCompanyId points to
sub-group). Per-row error reporting; transactional; 4/min rate-limited.

**Path B — direct DB insert (preferred for 1-3 companies or scripted):**

See `scripts/seed-azmade-companies.ts` for the canonical pattern. Two-pass
insert: level=1 sub-groups first, then level=2 operationals with
`parentCompanyId` set. Each operational company REQUIRES `industry` + `role`
(usually `'operational'`).

### 1.6 Chart of Accounts (per industry or per company)

Each operational company needs a ChartOfAccount row per account they use
(revenue, cogs, expense, asset, liability, equity buckets). Two options:

- **Per-industry template** (recommended): use `getCoaTemplateForIndustry(industry)`
  from `src/lib/onboarding/coa-templates.ts`. Returns a 10-15 account skeleton
  for the industry (industrial / hospitality / agro / etc.). Insert via
  `prisma.chartOfAccount.createMany`.
- **Per-company custom**: hand-curate. Slower; only for atypical entities
  like holding-level cost-centres.

Once accounts exist, BudgetLine + Booking imports can reference them.

---

## 2. Company-level data ingestion (xlsx import)

After companies + CoA exist, ingest budgets + actuals.

### 2.1 Onboarding wizard (preferred — AI-assisted)

```
/budgeting/onboarding → Select company + xlsx file → Analyze with AI →
Review proposal → Apply
```

The wizard's 3-step state machine:

1. **Select** (`POST /api/onboarding/import/analyze`): user uploads xlsx +
   selects target company + optional sheet name + industry hint. Server
   parses xlsx, sends column samples to AI Data Mapper (Anthropic Claude),
   returns a `MappingProposal` with column → role assignments + anomalies.
   Persists `ImportStaging(status='pending', expiresAt: +24h)`.
2. **Review**: user inspects the AI proposal — overall confidence %, per-
   column role + reasoning + confidence band, anomalies (sign inversion,
   magnitude outliers, etc.). User can override any column's role via the
   `<select>`.
3. **Apply** (`POST /api/onboarding/import/staging/[id]/apply`): user
   confirms; server re-uploads the xlsx + applies the proposal (with user
   overrides) → BudgetLine rows inserted → recompute pipeline triggered →
   audit log written.

Common branches:
- **Multiple sheets**: analyze 400s with `availableSheets: ['BS 2026', 'P&L 2026', ...]`. UI surfaces the sheet names as clickable buttons.
- **Stale proposal (24h+)**: apply 410. UI shows "Restart from step 1".
- **Already applied**: apply 409. UI shows the same restart prompt.
- **Recompute partial failure**: apply succeeds with `indicatorsStale: true` flag. UI shows ⚠ warning; admin can re-trigger from terminal.

### 2.2 CLI batch import (preferred for AZMADE-style multi-company drops)

`scripts/import-azmade-budgets.ts` is the reference implementation. Pattern:

1. Define a `JOBS: ImportJob[]` array (file path + sheet name + parser
   choice + year + companyCode + plan label).
2. Per job: `parseSoplSheet()` or `parseSummaryRollupSheet()` → `ParsedBudgetLine[]`.
3. Ensure ChartOfAccount rows for every unique `code` × `accountType` pair.
4. Ensure BudgetPlan exists for `(org, companyCode, year)`.
5. Transactional `delete`-then-`insert` BudgetLine rows.
6. Fire `runRecomputeForCompanies` to refresh affected (company × indicator) pairs.
7. Audit-log via `logImportBudgetCreate` (never-throws).

To onboard a new company family using a similar pattern, copy
`scripts/seed-azmade-actuals.ts` as a template + adapt the `JOBS` array.

### 2.3 Real-time per-company budget API

`POST /api/onboarding/import/budget` is the per-company HTTP path. Same
contract as the wizard's `/apply` call but no AI mapping step — caller
must pre-format the xlsx to match expected columns. Used by automated
sync pipelines (CRON job from accounting system, etc.) when the source
shape is fixed.

---

## 3. Indicator catalog management

The IndicatorDefinition table is the source of truth for what gets
computed and how. Edits go through `src/lib/risk/indicator-seeds.ts` →
`scripts/seed-indicators.ts` for idempotency + validation.

### 3.1 Adding a new indicator

1. Edit `src/lib/risk/indicator-seeds.ts` — append a new entry to
   `crossSectorIndicators` (sector-agnostic) OR the per-industry array.
2. Required fields:
   - `code`: stable identifier (e.g. `IND_NEW_METRIC`)
   - `nameEn` / `nameRu` / `nameAz`: locale-specific labels
   - `category`: `'operational'` (user-facing) or `'internal'` (building block, hidden from HeatMap)
   - `industries`: array of industry codes (empty = sector-agnostic)
   - `unit`: display unit (`'%'`, `'AZN'`, `'pp'`, etc.)
   - `direction`: `'higher_better'` / `'lower_better'` / `'band'`
   - `formula`: expr-eval string (e.g. `'net_income / revenue * 100'`)
   - `thresholds`: `{green, amber, red}` band shape
   - `requiredInputs`: array of resolver namespaces (`'budgetLine'`,
     `'booking'`, `'fact:CODE@PERIOD'`, `'rollup:CODE'`, etc.)
   - `hintTemplateEn`: tooltip text with `{value}` placeholder
   - `sortOrder`: display order within sector
3. Run `npx tsx scripts/seed-indicators.ts`. Three validation gates fire
   before any DB write — fix any errors (typos, malformed thresholds,
   sector-restricted rollup, etc.).
4. Trigger a recompute for the affected companies — see §4.

### 3.2 Modifying thresholds (tuning red/amber/green bands)

Edit the `thresholds` object on the seed entry, re-run seed-indicators.
The script upserts the indicator's threshold JSON. NO retroactive IV
recompute happens automatically — you must trigger §4.

### 3.3 Retiring an indicator

1. Add the code to `RETIRED_CODES` array in `indicator-seeds.ts`.
2. Re-run `npx tsx scripts/seed-indicators.ts` — the script deactivates
   the IndicatorDefinition + purges all associated IndicatorValue rows.
3. Document the retirement reason inline in the comment block alongside
   the original seed entry (preserved for forensics).

Example (from sub-44 era): `IND_FX_INPUT_RISK` was retired because xlsx
import didn't tag `currencyCode` on BudgetLine rows; the formula
returned 0 → green-everywhere → fake signal.

### 3.4 Cross-period composites (`fact()` / `rollup()`)

The formula engine supports two namespace functions for composite
indicators:

- `fact("INDICATOR_CODE", "PERIOD")` — read another indicator's value at
  a specific period (e.g. `fact("IND_NET_MARGIN", "2025")` for YoY delta).
- `rollup("INDICATOR_CODE")` — sum direct children's IVs for the same
  period at the parent-co level.

Both REQUIRE corresponding `requiredInputs` entries:
`'fact:IND_NET_MARGIN@2025'` / `'rollup:IND_REVENUE_TOTAL'`.

**For `fact()` to fire**: the referenced (code, period) IV must exist in
DB. Use `scripts/backfill-historical-ivs.ts` (§5) to populate baselines.

**For `rollup()` to fire on parent-cos**: the recompute trigger detects
rollup-bearing indicators and includes level=1 parent-cos in the recompute
pass. The matrix endpoint surfaces parent-co rollup IVs as drill-downable
cells on the sub-group row. Both wired sub-44 — operationally end-to-end.

---

## 4. Recompute pipeline

The recompute pipeline turns BudgetLine + Booking + OperationalFact data
into IndicatorValue rows that the HeatMap renders.

### 4.1 When does recompute fire automatically?

- **xlsx import**: every `/api/onboarding/import/budget` and
  `/staging/[id]/apply` call calls `runRecomputeForCompanies(...)` for
  the affected (company × year) pairs after the BudgetLine writes.
- **CLI batch importer**: `scripts/import-azmade-budgets.ts` calls the
  same helper after each job's transactional insert.
- **Manual single-IV recompute**: clicking the "Recompute" button on
  IndicatorDetail (Panel 3) POSTs to `/api/indicators` with `companyId +
  indicatorCode + period` — recomputes that single (company × indicator)
  pair AND inline-computes its 12-month sparkline.

### 4.2 Manual full-org recompute

```bash
# Recompute every (operational-co × matching-indicator × current-year)
# triple. Fires through the same trigger helper as xlsx import paths.
# Today: invoked by hitting the recompute trigger via direct script;
# no admin-UI button.
npx tsx -e "
  const { PrismaClient } = require('@prisma/client');
  const { runRecomputeForCompanies } = require('./src/lib/risk/recompute-trigger');
  const prisma = new PrismaClient();
  (async () => {
    const cos = await prisma.company.findMany({
      where: { organizationId: '<orgId>', isActive: true, level: 2 },
      select: { id: true },
    });
    const affected = cos.map(c => ({ companyId: c.id, year: 2026 }));
    const result = await runRecomputeForCompanies(prisma, '<orgId>', affected, {
      start: console.log, done: console.log, pairError: console.error,
    });
    console.log('Result:', result);
    await prisma.\$disconnect();
  })();
"
```

For larger scale (60+ companies), consider extending
`scripts/import-azmade-budgets.ts` pattern instead of inline scripting.

### 4.3 Recompute returns

`{ ok: <green/amber/red counter>, unknown: <count>, failed: <count>,
targets: <total pairs attempted> }`. `failed` non-zero means at least one
indicator's formula threw — check `logger.pairError` output for the
specific pair + error.

### 4.4 Sparkline batch refresh

Sparklines are 12-month trailing-period series persisted on each
IndicatorValue row. They're computed inline ONLY for single-IV
interactive recomputes (cost guard for batch paths). After bulk imports
or holding-wide refreshes:

```bash
npx tsx scripts/compute-sparklines.ts --orgSlug=<slug>
# Optionally narrow:
npx tsx scripts/compute-sparklines.ts --orgSlug=<slug> --indicatorCode=IND_NET_MARGIN
npx tsx scripts/compute-sparklines.ts --dry-run   # compute but don't persist
```

Idempotent. Cost: ~91ms per IV at AZMADE scale (46 IVs ≈ 4s); ~30-60min at
Phase F (60×80=4800 IVs). Wrap in cron / BullMQ job once Redis infra
lands.

---

## 5. Historical IV backfill

For `fact()`-using indicators that reference past periods (e.g.
`IND_NET_MARGIN_VS_2025` formula `fact("IND_NET_MARGIN", "2025")`), the
referenced IV must exist in DB. Live recompute writes only the current
period — historical periods need a one-shot CLI.

```bash
# Dry-run first (no DB writes; prints what would happen)
npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025 --dry-run

# Full multi-year run
npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025,2024

# Narrow by company OR indicator code
npx tsx scripts/backfill-historical-ivs.ts --org=azmade --years=2025 \
  --companies=AAC-MAIN,ZTP-MAIN \
  --codes=IND_NET_MARGIN,IND_GROSS_MARGIN
```

The script:
1. Resolves `--org=<slug>` to orgId.
2. Fetches operational-cos (filtered by `--companies`).
3. Builds `(companyId × year)` cartesian.
4. Delegates to `runRecomputeForCompanies` with `period: String(year)`.
5. Same per-pair error handling as live trigger paths.

Cost: same as a live recompute pass per year. AZMADE scale (~400 pairs)
≈ 30s per year. Phase F scale (~4800 pairs) ≈ 5 min per year sequential.

---

## 6. Alert configuration (per-org thresholds)

Alerts fire automatically as part of every matrix fetch. The rule engine
(`src/lib/risk/alert-rules.ts`) ships 5 default rules:

| Rule | Default trigger |
|------|-----------------|
| `RULE_COMPANY_MOSTLY_RED` | 3+ red indicators on a single company |
| `RULE_CRITICAL_COMPOSITE` | composite score ≤ 40 on a company |
| `RULE_CRITICAL_INDICATOR` | `IND_NET_MARGIN` red for 3+ companies |
| `RULE_SECTOR_AMBER_CLUSTER` | 5+ amber cells across companies in same sector |
| `RULE_SECTOR_RED_SPREAD` | 3+ red indicators across 2+ companies in same sector |

### 6.1 Tuning thresholds via UI

Admin role only:

```
/settings → AlertRulesEditor
```

Renders 5 cards (one per rule). Numeric inputs for thresholds + indicator
picklist for `RULE_CRITICAL_INDICATOR`'s code. Save → `PATCH
/api/organizations/settings` → merges into `Organization.settings.alertThresholds`
JSON column. Audit-logged with full before/after blob.

### 6.2 Per-sector overrides (Phase 7.E C6 v3)

Hospitality might want a 5-red threshold for `RULE_COMPANY_MOSTLY_RED`
while industrial uses 3. The `bySector` field supports per-sector
overrides:

```json
{
  "alertThresholds": {
    "mostlyRed": { "redCountMin": 3 },
    "bySector": {
      "hospitality": { "sectorAmber": { "amberCountMin": 8 } },
      "industrial": { "sectorRedSpread": { "redCountMin": 4, "companyCountMin": 3 } }
    }
  }
}
```

Today there is **no per-sector UI** — admins edit the JSON directly via
DB or via `PATCH /api/organizations/settings` raw call. Engine fully
supports it.

NOTE: `bySector.<industry>` accepts ONLY `sectorAmber` + `sectorRedSpread`
slots. Org-wide rules (`mostlyRed`, `criticalComposite`,
`criticalIndicator`) iterate per-company and have no inherent sector
dimension; the schema rejects them inside `bySector` to prevent silent
misconfiguration.

### 6.3 Defaults

`DEFAULT_ALERT_THRESHOLDS` in `src/lib/risk/alert-thresholds-config.ts`
matches the v1 hardcoded constants byte-for-byte. An org with empty
`settings.alertThresholds` sees zero behavior change vs the legacy
hardcoded engine.

---

## 7. Audit log (Phase 7.F)

Every state-changing operation writes to the `AuditEvent` table:
imports (companies / budgets / staging-applied), recompute triggers,
indicator-override CRUD, alert-threshold updates, etc.

### 7.1 Querying recent events

```sql
-- Last 50 events for an org
SELECT
  "createdAt",
  action,
  "actorUserId",
  "entityType",
  "entityId",
  metadata
FROM "AuditEvent"
WHERE "organizationId" = '<orgId>'
ORDER BY "createdAt" DESC
LIMIT 50;
```

### 7.2 UI feed

`/budgeting/audit` (admin role) renders a paginated cursor-based feed.
Same data, filterable by action type / actor / date range.

### 7.3 Retention

Per-org retention is 365 days (documented). **Auto-prune is not yet
implemented** — see CARRYOVER 🔄 "auto-prune audit events past 365-day
retention". Today: no rows are auto-deleted; the table grows indefinitely.
Manual prune:

```sql
DELETE FROM "AuditEvent"
WHERE "createdAt" < NOW() - INTERVAL '365 days';
```

Run quarterly until BullMQ cron lands (Phase 7.E C6 v3 follow-up).

### 7.4 Export

```sql
COPY (
  SELECT "createdAt", action, "actorUserId", "entityType", "entityId", metadata
  FROM "AuditEvent"
  WHERE "organizationId" = '<orgId>'
    AND "createdAt" >= '2026-01-01'
  ORDER BY "createdAt"
) TO '/tmp/audit_export_<org>_<date>.csv' WITH CSV HEADER;
```

---

## 8. Troubleshooting playbook (top 10)

### 8.1 "HeatMap is empty / shows '—' on every cell"

Most common cause: matrix endpoint queried under wrong period string.

1. Open browser devtools → Network → filter on `/api/indicators/matrix`.
2. Check the `?period=` query param. Should be `YYYY` (annual).
3. Check the response `cells.length`. If 0 but `companies.length > 0` and
   `indicators.length > 0` → no IVs exist for that period.
4. **Fix**: trigger a recompute (§4.2) for the period you expect.

### 8.2 "Composite score badge shows '—' on a sub-group row"

By design. Sub-group rows are navigation aggregates — composite is
deliberately suppressed (synthetic-rollup + real-rollup cells are skipped
by `isAggregateRollup` gate). To see composite on a specific operational
co, click into the sub-group's row to expand.

### 8.3 "IND_HOLDING_REVENUE only shows on parent-co rows"

By design. The seed has `category: "internal"`, which suppresses it from
op-co rows but the matrix endpoint promotes it to visible columns when
rollup-bearing. Parent-co rows render the real rollup IV;
operational-co rows have no cell for this indicator. Expected behavior.

### 8.4 "IND_NET_MARGIN_VS_2025 shows 'unknown' on every company"

The `fact("IND_NET_MARGIN", "2025")` resolver returns null because no
2025 IND_NET_MARGIN IVs exist in DB → formula NaN → status='unknown'.

**Fix**:
```bash
npx tsx scripts/backfill-historical-ivs.ts --org=<slug> --years=2025 --codes=IND_NET_MARGIN
```

Then re-trigger current-period recompute (§4.2).

### 8.5 "Onboarding wizard 'Apply' returns 410 / 409"

- **410 (Gone)**: staging row expired (24h TTL) or was discarded.
- **409 (Conflict)**: staging was already applied.

Either way: UI surfaces "Restart from step 1" — user re-uploads the xlsx
+ re-runs Analyze.

### 8.6 "AI Data Mapper Analyze returns 503 (AI unavailable)"

`ANTHROPIC_API_KEY` is not configured on this deployment.

**Fix**: set `ANTHROPIC_API_KEY=...` in `.env.production` (or `.env.local`
for dev), restart the app server.

### 8.7 "Alert isn't firing for what looks like a clear violation"

1. Check `Organization.settings.alertThresholds` JSON — admin may have
   tuned the threshold above the violation.
2. Check the rule's per-sector override (`bySector.<industry>`) — sector
   tuning may differ from org-wide.
3. Check if the cells are being filtered by the `isAggregateRollup` gate
   — alerts skip sub-group aggregate cells (real + synthetic rollups).
4. Recompute may be stale — trigger §4.2 to refresh.

### 8.8 "Sparkline doesn't render on a cell"

Sparkline column is `sparkline?: (number | null)[]` on IndicatorValue.
`null` or empty array → no sparkline. Most likely cause: the IV pre-
dates the sparkline batch run or was created via bulk recompute (which
intentionally skips inline sparkline computation).

**Fix**: `npx tsx scripts/compute-sparklines.ts --orgSlug=<slug>`.

### 8.9 "Variance Explainer button does nothing"

Check Network tab for `/api/indicators/values/[id]/explain`. Errors are
inline-rendered in the panel. Common: 503 (AI key not set, see §8.6) or
500 (Anthropic SDK error — check `~/Library/Logs/budgetpro.log` for
stack trace).

### 8.10 "Migration didn't apply"

```bash
# Check status
npx prisma migrate status

# If pending migrations exist
npx prisma migrate deploy

# If schema is out of sync (dev only)
npx prisma migrate reset --skip-seed   # ⚠ wipes data
```

In production: NEVER run `migrate reset`. Use `migrate deploy` only.

---

## 9. Database operations

### 9.1 Backup

Production: scheduled via Docker volume snapshot (see `deploy/README.md`).
Manual:

```bash
docker compose exec postgres pg_dump -U budgetpro budgetpro \
  | gzip > backups/budgetpro_$(date +%Y%m%d_%H%M%S).sql.gz
```

### 9.2 Restore

```bash
gunzip < backups/budgetpro_<TIMESTAMP>.sql.gz \
  | docker compose exec -T postgres psql -U budgetpro budgetpro
```

### 9.3 Common queries

```sql
-- Top 10 companies by red-cell count (this period)
SELECT c.code, COUNT(*) AS red_count
FROM "IndicatorValue" iv
JOIN "Company" c ON c.id = iv."companyId"
WHERE iv.status = 'red' AND iv.period = '2026'
GROUP BY c.code
ORDER BY red_count DESC
LIMIT 10;

-- IndicatorDefinition catalog by category
SELECT category, COUNT(*) AS n
FROM "IndicatorDefinition"
WHERE "isActive" = true
GROUP BY category
ORDER BY n DESC;

-- Latest import by org
SELECT "createdAt", action, "entityType", metadata
FROM "AuditEvent"
WHERE "organizationId" = '<orgId>'
  AND action LIKE 'import_%'
ORDER BY "createdAt" DESC
LIMIT 5;
```

---

## 10. Glossary

- **IV / IndicatorValue**: persisted row representing one (org × company × indicator × period) tuple's computed value + status + sparkline.
- **Sub-group / Parent-co (level=1)**: aggregator entity above operational companies in the holding tree. No industry; no operational-threshold scoring; receives rollup() IVs.
- **Op-co / Operational (level=2)**: line-of-business company. Has `industry`; receives full per-sector indicator pack.
- **Admin / Holding role**: cost-centre entities (HQ, MRKZ, etc.) excluded from operational matrix to avoid false-red on OpEx ratios.
- **Rollup-bearing indicator**: has `requiredInputs: ['rollup:CODE']`. Fires on parent-co level. MUST be sector-agnostic (`industries: []`) — guard at seed-load + runtime.
- **fact() resolver**: reads another indicator's value at a different period (cross-period composites).
- **rollup() resolver**: sums children's IVs at the same period (cross-company composites).
- **Synthetic rollup cell** (`kind: 'synthetic-rollup'`): Turn 33.5 average of children's cells; sub-group rendering convenience; not a real IV.
- **Real-rollup cell** (`kind: 'real-rollup'`): persisted IV from `rollup()` formula; drill-downable; sub-44 work.
- **`isAggregateRollup(c)`**: gate predicate — true for either rollup variant. Use this in any new consumer; never check the `kind` field directly.
- **`category: "internal"`**: indicator is a building block (e.g. `IND_REVENUE_TOTAL` for `rollup()`). Hidden from operational matrix; promoted to visible iff rollup-bearing.
- **AlertRule**: 5 default rules + 0..N custom; threshold-tunable per org (and optionally per sector).
- **MappingProposal**: AI Data Mapper output — column-role assignments + anomalies + overall confidence.
- **ImportStaging**: 24h-TTL row holding a `MappingProposal` between Analyze and Apply.

---

## 11. Glossary of common file paths

| What | Where |
|------|-------|
| Indicator catalog (seed) | `src/lib/risk/indicator-seeds.ts` |
| Recompute pipeline | `src/lib/risk/recompute.ts` |
| Recompute trigger (per-co loop) | `src/lib/risk/recompute-trigger.ts` |
| Alert rule engine | `src/lib/risk/alert-rules.ts` |
| Alert threshold config | `src/lib/risk/alert-thresholds-config.ts` |
| Composite score | `src/lib/risk/composite-score.ts` |
| Cell shape contracts | `src/lib/risk/heatmap-matrix.ts` |
| AI Data Mapper | `src/lib/onboarding/ai-mapper/` |
| CoA templates | `src/lib/onboarding/coa-templates.ts` |
| Onboarding wizard UI | `src/features/onboarding/components/ImportWizard.tsx` |
| Risk Terminal panels | `src/features/terminal/components/` |
| Matrix endpoint | `src/app/api/indicators/matrix/route.ts` |
| Audit logging | `src/lib/audit/log.ts` |
| Migrations | `prisma/migrations/` |
| Roadmap / status | `docs/ROADMAP.md` |
| Open debt items | `docs/CARRYOVER.md` |
| Demo script | `docs/DEMO_SCRIPT.md` |
| Deployment runbook | `deploy/README.md` |

---

## 12. Escalation paths

When stuck:

1. **Recompute issue** → check `~/Library/Logs/budgetpro.log` for the
   `[recompute]` lines + per-pair errors. The trigger logs `start` /
   `done` / `pairError(label, err)`.
2. **AI Mapper issue** → check `getAnthropicClient()` returns non-null
   (`ANTHROPIC_API_KEY` set) + check the LLM response in network tab.
3. **Migration issue** → `npx prisma migrate status` shows pending +
   applied. Production: never `reset`, only `deploy`.
4. **Data integrity issue** → use the SQL queries in §9.3 to inspect
   IndicatorValue + AuditEvent before mutating.
5. **Performance issue** → check Postgres `pg_stat_statements` for slow
   queries; the matrix endpoint is the most common hotspot at 60-co
   scale.

For developer-side escalation (ship code), reference `docs/ROADMAP.md`
for the prioritized backlog and `docs/CARRYOVER.md` for in-flight 🔄
items.

---

## Versioning

This runbook is **v1** (2026-05-03), Phase 7.G initial deliverable.
Major edits should bump a version footer here + add a changelog line at
the bottom of `docs/ROADMAP.md`.

### Changelog
- 2026-05-03 — v1 — Initial draft covering Phase 7.A–7.F operational state. Phase 7.G follow-ups: SSE serverless infra, BullMQ scheduler, audit retention auto-prune, Alert table persistence — all flagged in §7.3 + §11.

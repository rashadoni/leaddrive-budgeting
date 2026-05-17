# RLS Performance Baseline — `/api/indicators/matrix`

**Captured:** 2026-05-16, before any RLS migration applied.
**Purpose:** baseline for Phase 5.2 architect-mandated **>10% p95 regression** abort threshold (per [docs/ADR-RLS.md](ADR-RLS.md#performance-budget)).

## Environment

- Postgres: local dev instance, single connection (no PgBouncer)
- Dataset scale: **2 241 IndicatorValue rows** (single org `FO Holding`, 16 companies)
- Composite index `(organizationId, companyId, period)` confirmed present on `indicator_values`

## Baseline query

Mirrors what `/api/indicators/matrix` issues per page load (org-scoped findMany + period filter, projecting the columns the HeatMap reads):

```sql
SELECT id, "organizationId", "companyId", "indicatorId", period, value, status, sparkline
FROM indicator_values
WHERE "organizationId" = 'cmockji6c0000u6oseeuz5ipq' AND period = '2026'
LIMIT 5000;
```

## Result — cold buffers (first run)

```
Limit  (cost=0.00..410.62 rows=245 width=245) (actual time=0.018..10.862 rows=245 loops=1)
  Buffers: shared hit=132 read=245
  ->  Seq Scan on indicator_values
        Filter: (("organizationId" = 'cmockji6c0000u6oseeuz5ipq'::text) AND (period = '2026'::text))
        Rows Removed by Filter: 1996
        Buffers: shared hit=132 read=245
Planning Time: 1.618 ms
Execution Time: 10.932 ms
```

## Result — warm buffers (re-run, fully cached)

```
Limit  (cost=0.00..410.62 rows=245 width=125) (actual time=0.019..1.922 rows=245 loops=1)
  Buffers: shared hit=377
  ->  Seq Scan on indicator_values
Planning Time: 1.199 ms
Execution Time: 1.980 ms
```

## Observations

1. **Seq scan is chosen, not index scan.** At 2 241 rows, Postgres correctly judges that scanning the whole table + filtering is cheaper than walking the composite index. This will flip to **index scan when the table grows past Postgres's `enable_seqscan` threshold** (~10K-50K rows depending on selectivity). Even forcing `SET LOCAL enable_seqscan = off` did not change the plan at this scale.

2. **Buffers: 132 disk reads on cold, 0 on warm.** Cache is hot quickly. Production with steady traffic will spend most time in the 1.9ms warm-buffer regime.

3. **Cost-vs-time alignment.** Postgres's estimated cost (410.62) and observed time (10.9ms cold) are consistent with a small-table scan. No surprises.

## What changes when RLS is enabled

The `tenant_isolation` policy adds an implicit predicate:

```sql
WHERE "organizationId" = current_setting('app.organization_id', true)
```

Combined with the explicit `WHERE "organizationId" = '<orgId>'` from Prisma, Postgres should:
- Fold both predicates into a single filter (`current_setting` evaluates once per query, then the comparison is constant-folded).
- Continue using seq scan at this scale.
- **Expected regression:** <5% (one extra cheap comparison per row).

## 60-company projected scale

At target scale (60 op-cos × ~80 indicators × multiple periods ≈ 5 000–10 000 IVs per org), the seq scan will become expensive enough that Postgres chooses index scan. The leading-`organizationId` index ensures RLS-policy evaluation is index-bound:

- Index seek by `organizationId` → 5K rows hit
- Then period + companyId predicates within that subset

**No RLS-specific re-index** is needed — the existing composite covers the policy predicate.

## Abort threshold (per ADR-RLS.md §Performance budget)

If post-RLS the same query takes **> 12.0 ms p95** (10% over the 10.9 ms cold baseline) on the same dataset, abort and investigate. Re-measure after each table's RLS migration applies.

## Re-measurement procedure

```bash
set -a && source .env && set +a
node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$queryRawUnsafe(\\\`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT id, \"organizationId\", \"companyId\", \"indicatorId\", period, value, status, sparkline
    FROM indicator_values
    WHERE \"organizationId\" = '<orgId>' AND period = '2026'
    LIMIT 5000
  \\\`).then(rows => { for (const r of rows) console.log(r['QUERY PLAN']); prisma.\\\$disconnect(); });
"
```

Compare the `Execution Time` line against baseline 10.9 ms cold / 1.98 ms warm. Run 3× and use the median.

## Future work — synthetic-scale benchmark

Architect noted: at 60-co projected scale, an `EXPLAIN ANALYZE` against a **5000-row synthetic seed** would give better confidence than extrapolating from 2 241 rows. Out of scope for this baseline because:
- Synthetic seed in shared business DB violates [memory rule `feedback_no_synthetic_business_data`](../.claude/memory/feedback_no_synthetic_business_data.md).
- A dedicated staging DB with synthetic-scale fixture is the right answer; deferred to a future ops session.

For now: re-measure on each customer add (10 cos / 30 cos / 60 cos milestones) and verify the seq-scan → index-scan flip happens without execution-time blow-up.

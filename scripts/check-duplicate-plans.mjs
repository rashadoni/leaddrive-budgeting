#!/usr/bin/env node
/**
 * Phase 11.4 pre-flight — READ-ONLY duplicate-plan check.
 *
 * Migration `20260729120000_budget_plan_unique_per_year_kind` deliberately
 * REFUSES to apply while more than one LIVE `BudgetPlan` exists for the same
 * `(organizationId, year, kind)`. Merging two plans' financial rows is an
 * owner decision, not something a migration does silently. This script is the
 * pre-flight: it names the split groups and, for each plan in a group, how
 * many financial rows would have to move.
 *
 * Why the split matters: the risk engine reads
 * `plan: { year, kind: "actual" }` with no `planId`
 * (src/lib/risk/recompute-data-source.ts), so it SUMS every live actual plan
 * for the year — silently doubling every P&L and balance-sheet number. Each
 * import's clean-slate is plan-scoped, so neither plan can ever reach the
 * other's rows to correct it.
 *
 * Strictly SELECT-only: no writes, no DDL, no transaction. Safe on production.
 *
 * Usage
 *   DATABASE_URL=postgresql://... node scripts/check-duplicate-plans.mjs
 *   node scripts/check-duplicate-plans.mjs path/to/.env
 *
 * Exit codes: 0 = clean (migration can be applied) · 1 = duplicates found
 * (migration will refuse) · 2 = could not run.
 *
 * Same grouping as `GET /api/admin/duplicate-plans`; this exists so the check
 * can run BEFORE that endpoint is deployed, which is exactly when it is needed.
 */
import { Client } from "pg"
import { readFileSync } from "node:fs"

function resolveUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = process.argv[2]
  if (!envPath) {
    throw new Error(
      "Set DATABASE_URL, or pass an .env file path as the first argument.",
    )
  }
  const m = readFileSync(envPath, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error(`No DATABASE_URL found in ${envPath}`)
  return m[1]
}

let client
try {
  client = new Client({ connectionString: resolveUrl() })
  await client.connect()
} catch (err) {
  console.error(`Could not connect: ${err instanceof Error ? err.message : err}`)
  process.exit(2)
}

try {
  // Column names are camelCase in this schema and MUST stay quoted —
  // Postgres folds unquoted identifiers to lower case. `year` and `kind` are
  // genuinely lower-case.
  const { rows } = await client.query(`
    SELECT "organizationId", year, kind,
           count(*)                                AS n,
           array_agg(id   ORDER BY "createdAt")    AS ids,
           array_agg(name ORDER BY "createdAt")    AS names
    FROM budget_plans
    WHERE "deletedAt" IS NULL
    GROUP BY 1, 2, 3
    ORDER BY year DESC, kind
  `)

  const dupes = rows.filter((r) => Number(r.n) > 1)

  console.log("\nLive budget_plans grouped by (organizationId, year, kind):")
  if (rows.length === 0) console.log("  (none)")
  for (const r of rows) {
    const dup = Number(r.n) > 1
    console.log(
      `  ${dup ? "DUPLICATE" : "ok       "}  year=${r.year} kind=${r.kind} ` +
        `count=${r.n}  [${r.names.join(" | ")}]`,
    )
  }

  if (dupes.length === 0) {
    console.log(
      "\nCLEAN — migration 20260729120000_budget_plan_unique_per_year_kind can be applied.\n",
    )
    process.exit(0)
  }

  console.log(
    `\n${dupes.length} split group(s). Rows that would need re-pointing:\n`,
  )
  for (const g of dupes) {
    console.log(`  (year=${g.year}, kind=${g.kind})`)
    for (let i = 0; i < g.ids.length; i++) {
      const id = g.ids[i]
      const { rows: c } = await client.query(
        `SELECT
           (SELECT count(*) FROM budget_lines        WHERE "planId"=$1 AND "deletedAt" IS NULL) AS budget_lines,
           (SELECT count(*) FROM balance_sheet_lines WHERE "planId"=$1 AND "deletedAt" IS NULL) AS bs_lines,
           (SELECT count(*) FROM budget_actuals      WHERE "planId"=$1)                         AS actuals,
           (SELECT count(*) FROM sales_budget_lines  WHERE "planId"=$1)                         AS sales_lines`,
        [id],
      )
      const n = c[0]
      // Oldest first — resolveImportPlan() picks plans[0], so that is where
      // every new import already writes and the natural merge target.
      console.log(
        `    ${i === 0 ? "CANONICAL" : "duplicate"}  ${id}  "${g.names[i]}"\n` +
          `        budgetLines=${n.budget_lines} bsLines=${n.bs_lines} ` +
          `actuals=${n.actuals} salesLines=${n.sales_lines}`,
      )
    }
  }
  console.log(
    "\nNext: re-point each duplicate's child rows to the CANONICAL planId, " +
      "soft-delete the duplicate, then apply the migration.\n" +
      "Until then the terminal is summing both plans.\n",
  )
  process.exit(1)
} finally {
  await client.end()
}

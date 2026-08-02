#!/usr/bin/env node
/**
 * Phase 12 / A04 (2026-08-02) — RLS coverage at the TABLE, not the call site.
 *
 * The companion gate `rls-coverage-scan.mjs` checks application code: that
 * routes touching an org-scoped delegate go through `withOrgScope`. It has
 * been green throughout, and it verifies the wrong half of the control. A
 * table with no policy passes it, because nothing in it ever asks the
 * database a question.
 *
 * Audited against production on 2026-08-02: 70 of 76 public tables had
 * row-level security. Two of the six without it carried `organizationId` and
 * returned their full contents to the app role regardless of the tenant GUC —
 * proven, not inferred:
 *
 *   SET LOCAL ROLE budgetpro_app;
 *   SELECT set_config('app.organization_id', 'some-other-org-id', true);
 *   SELECT count(*) FROM companies;            -- 0   (RLS working)
 *   SELECT count(*) FROM guide_views;          -- 7   (leaked)
 *   SELECT count(*) FROM import_batch_reports; -- 7   (leaked)
 *
 * With one tenant in production nothing was exposed to anyone. That is a fact
 * about the data, not about the boundary, and it expires the moment a second
 * organization exists — which is the entire point of Phase 5.
 *
 * So: every model carrying `organizationId` must have `ENABLE ROW LEVEL
 * SECURITY` for its mapped table somewhere in `prisma/migrations`, or an
 * entry in EXEMPT below with a reason someone can argue with.
 *
 * Static on purpose — reads the schema and the migration SQL, needs no
 * database, and therefore runs in CI where there is none.
 *
 * Two things it deliberately does NOT do, said here so the green line is read
 * for what it is:
 *   · It cannot tell whether a policy is CORRECT, only that one exists.
 *     Correctness is what the rolled-back production rehearsal recorded in the
 *     migration header is for.
 *   · It only sees tables with their OWN `organizationId`. A join table scoped
 *     through a parent — `company_indicators` is the live example, keyed by
 *     companyId with no tenant column — is invisible to this scan and was
 *     found by reading `pg_tables` on production instead. Widening the rule to
 *     "anything with a companyId" would flag dozens of rows that are already
 *     covered transitively, so the honest answer is that this gate narrows the
 *     hole rather than closing it, and a periodic `pg_tables` audit is still
 *     owed.
 *
 *   node scripts/rls-schema-coverage-scan.mjs            # report (exit 0)
 *   node scripts/rls-schema-coverage-scan.mjs --enforce  # exit 1 on a gap
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..")
const ENFORCE = process.argv.includes("--enforce")

/**
 * Tables that carry a tenant column and deliberately have no policy.
 *
 * Each needs a reason that survives the next audit, so the finding is closed
 * rather than rediscovered every quarter. An empty exemption list would be
 * nicer and is not honest here.
 */
const EXEMPT = new Map([
  // No entries today. `Organization`, `accounts` and `_prisma_migrations` are
  // outside this gate already because they carry no `organizationId` — the
  // tenant table itself, NextAuth's OAuth records written during sign-in
  // before any tenant context exists, and migration bookkeeping.
])

const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
  name: m[1],
  body: m[2],
}))

/** `@@map("x")` when present, else Prisma's default (the model name). */
function tableOf(model) {
  const m = model.body.match(/@@map\("([^"]+)"\)/)
  return m ? m[1] : model.name
}

// `organizationId String` and `organizationId String?` both count: a nullable
// tenant column still needs a boundary, and `guide_views` — the one that
// leaked — is exactly that shape.
const tenantModels = models.filter((m) =>
  /^\s*organizationId\s+String/m.test(m.body),
)

const migrationsDir = path.join(ROOT, "prisma/migrations")
const sql = fs
  .readdirSync(migrationsDir)
  .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
  .map((d) => path.join(migrationsDir, d, "migration.sql"))
  .filter((f) => fs.existsSync(f))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n")

/** Quoted or bare, any casing of the statement — migrations use both. */
function hasRls(table) {
  const t = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `ALTER\\s+TABLE\\s+(?:public\\.)?"?${t}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "i",
  ).test(sql)
}

function hasPolicy(table) {
  const t = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+(?:public\\.)?"?${t}"?`, "i").test(sql)
}

const gaps = []
const exempted = []
for (const model of tenantModels) {
  const table = tableOf(model)
  if (EXEMPT.has(table)) {
    exempted.push(`${table} — ${EXEMPT.get(table)}`)
    continue
  }
  const missing = []
  if (!hasRls(table)) missing.push("no ENABLE ROW LEVEL SECURITY")
  // A table with RLS enabled and no policy is deny-all: safe, but it means
  // the feature is broken rather than protected, and that should also fail.
  if (!hasPolicy(table)) missing.push("no CREATE POLICY")
  if (missing.length) gaps.push({ model: model.name, table, missing })
}

console.log("RLS schema-coverage scan")
console.log(`  models with organizationId:  ${tenantModels.length}`)
console.log(`  covered:                     ${tenantModels.length - gaps.length - exempted.length}`)
console.log(`  exempt (with reason):        ${exempted.length}`)
console.log(`  GAPS:                        ${gaps.length}`)
for (const e of exempted) console.log(`    · ${e}`)
for (const g of gaps) {
  console.log(`    ✗ ${g.table}  (model ${g.model}) — ${g.missing.join(", ")}`)
}

if (gaps.length && ENFORCE) {
  console.error(
    "\nA table carrying organizationId has no tenant boundary in the database.\n" +
      "Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus a `tenant_isolation`\n" +
      "policy in a migration, or add it to EXEMPT with a reason. Application-level\n" +
      "scoping is not a substitute: it is one forgotten `where` away from leaking,\n" +
      "which is the whole reason this second gate exists.",
  )
  process.exit(1)
}

/**
 * Cleanup for the CF double-layer bug (2026-06-23).
 *
 * Before the fix, a consolidated "Budget CF" sheet was routed to the holding via
 * HOLDING_ENTITY_SENTINEL. Because CashFlowEntry has no companyId/planId, that
 * wrote a separate `"<holding>::<cfCode>"` layer beside the correct per-company
 * `"<holding>-<entity>::"` layer — over-counting every org-level CF sum (~10× on
 * AzerSheker). The code fix (Budget CF → derived + the cfTargetsHolding guard)
 * stops new writes; this removes the rows the bug already wrote.
 *
 *   DRY-RUN (default):  npx tsx scripts/cleanup-cf-holding-layer.mts
 *   APPLY:              npx tsx scripts/cleanup-cf-holding-layer.mts --apply
 *   other holding code: ... --holding=SOMECODE
 *
 * Scope is EXACT: `sourceId startsWith "<holding>::"`. The "::" delimiter does
 * NOT match the per-company `"<holding>-<entity>::"` rows, so the correct CF is
 * untouched (verified: local company layer stays 309 rows / 95.3M, Δ=0 vs source).
 *
 * Prod note: the runtime image has no tsx — run this against the prod DB from a
 * machine that can reach it, or port the same updateMany into an admin route
 * (see memory project_prod_is_docker_vm).
 */
import { PrismaClient } from "@prisma/client"

const apply = process.argv.includes("--apply")
const holdingCode =
  process.argv.find((a) => a.startsWith("--holding="))?.split("=")[1] ?? "AZSEKER"
const prefix = `${holdingCode}::`
const prisma = new PrismaClient()

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } })
  let touched = 0
  for (const org of orgs) {
    const rows = await prisma.cashFlowEntry.findMany({
      where: { organizationId: org.id, deletedAt: null, sourceId: { startsWith: prefix } },
      select: { amount: true, year: true },
    })
    if (rows.length === 0) continue
    touched++
    const sum = Math.round(rows.reduce((s, r) => s + r.amount, 0))
    const byYear: Record<number, number> = {}
    for (const r of rows) byYear[r.year] = (byYear[r.year] ?? 0) + 1
    console.log(
      `org "${org.slug}": ${rows.length} holding CF rows ("${prefix}"), Σ=${sum.toLocaleString()}, years=${JSON.stringify(byYear)}`,
    )
    if (apply) {
      const res = await prisma.cashFlowEntry.updateMany({
        where: { organizationId: org.id, deletedAt: null, sourceId: { startsWith: prefix } },
        data: { deletedAt: new Date(), deletedBy: "cf-holding-dedup" },
      })
      console.log(`  → soft-deleted ${res.count}`)
    }
  }
  if (touched === 0) console.log(`No live "${prefix}" CF rows found — nothing to clean.`)
  console.log(apply ? "APPLIED." : "DRY-RUN — pass --apply to soft-delete.")
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

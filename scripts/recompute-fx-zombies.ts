#!/usr/bin/env tsx
/**
 * Phase 7.M Step 4 follow-up (2026-05-19) — one-shot recompute for
 * cells that the new zombie-guard branches now want to demote to
 * `unknown`. Targets all IV rows where value=0 AND status ∈
 * (green, amber) on user-facing indicators — re-runs them through
 * recomputeIndicator so the guard re-evaluates and the stored
 * status flips when warranted.
 *
 * Safe to run repeatedly — idempotent.
 */
import { PrismaClient } from "@prisma/client"
import { recomputeIndicator, createPrismaDataSource } from "@/lib/risk/recompute"

const prisma = new PrismaClient()

async function main() {
  // All user-facing IVs with value=0/100 AND classified status. value=0
  // catches the standard zombie; value=100 catches cap-saturated
  // composites like IND_ESG_COMPOSITE that hit the upper bound when
  // their underlying inputs are empty. Skip `category=internal`.
  const zombies = await prisma.indicatorValue.findMany({
    where: {
      value: { in: [0, 100] },
      status: { in: ["green", "amber"] },
      indicator: { category: { not: "internal" } },
    },
    select: {
      organizationId: true,
      companyId: true,
      period: true,
      indicatorId: true,
      indicator: true,
    },
  })

  console.log(`[recompute-zombies] recomputing ${zombies.length} cells`)
  let ok = 0
  let fail = 0
  for (const z of zombies) {
    try {
      const ds = createPrismaDataSource(prisma)
      await recomputeIndicator(ds, {
        organizationId: z.organizationId,
        companyId: z.companyId,
        definition: z.indicator as never,
        period: z.period,
      })
      ok += 1
    } catch (e) {
      console.error(
        `[recompute-zombies] FAIL ${z.companyId}@${z.period}:`,
        e instanceof Error ? e.message : String(e),
      )
      fail += 1
    }
  }
  console.log(`[recompute-zombies] done: ok=${ok}, fail=${fail}`)
  return fail > 0 ? 1 : 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (e) => {
    console.error("[recompute-fx] crashed:", e)
    await prisma.$disconnect()
    process.exit(2)
  })

import type { Prisma, PrismaClient } from "@prisma/client"

/**
 * A company that has just received financial data via an import is no longer
 * "awaiting data" — clear any stale `settings.dataPendingBanner` so the terminal
 * (CompanyTree) stops rendering the pre-load "⏳ awaiting data" placeholder over
 * real numbers.
 *
 * Idempotent: only companies in `entityCodes` that actually carry a banner are
 * touched, and only that one key is removed (other settings preserved). Designed
 * to run INSIDE the caller's import transaction so the banner-clear is atomic
 * with the data write.
 *
 * 2026-06-21: surfaced when PROMALT kept its manual "awaiting file from CFO"
 * banner long after its data was imported + reconciled to the source file —
 * nobody cleared it. Auto-clearing on import closes that staleness class.
 * Companies that are genuinely still empty (e.g. HORIZON) never enter
 * `entityCodes` because no rows are written for them, so their banner survives.
 */
export async function clearDataPendingBanners(
  tx: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  entityCodes: string[],
): Promise<number> {
  const codes = entityCodes.filter((c) => c && c.trim() !== "")
  if (codes.length === 0) return 0
  const companies = await tx.company.findMany({
    where: { organizationId, code: { in: codes } },
    select: { id: true, settings: true },
  })
  let cleared = 0
  for (const co of companies) {
    const s = co.settings
    if (s && typeof s === "object" && !Array.isArray(s) && "dataPendingBanner" in s) {
      const next = { ...(s as Record<string, unknown>) }
      delete next.dataPendingBanner
      await tx.company.update({
        where: { id: co.id },
        data: { settings: next as Prisma.InputJsonValue },
      })
      cleared++
    }
  }
  return cleared
}

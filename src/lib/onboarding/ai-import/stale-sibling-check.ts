/**
 * Stale-sibling detection (2026-07-15).
 *
 * The import clean-slate is deliberately scoped to the importing sheets' own
 * company footprint (derive-delete-from-write — the collateral-deletion
 * guard). The flip side: rows an EARLIER import attributed to a company
 * OUTSIDE the footprint stay LIVE in the same plan and silently double-count
 * against the freshly written per-entity rows. Observed on the FO workbook:
 * a June reporting-pack import had stacked the whole consolidated budget
 * (2,057 rows / 58.9M revenue) onto the HOLDING; the fixed per-entity import
 * then wrote the same 58.9M across the 4 subsidiaries — every holding rollup
 * showed exactly 2×.
 *
 * We must never auto-delete another company's rows (that's the corruption
 * class the footprint guard exists to prevent) — but the import report MUST
 * say they exist. This module is pure detection: no writes.
 */
import type { Prisma, PrismaClient } from "@prisma/client"
import type { SheetClassification } from "./sheet-classifier"

export interface StaleSiblingInput {
  organizationId: string
  year: number
  /** All classifications across the imported files (post-routing). */
  classifications: ReadonlyArray<SheetClassification>
}

type Db = Pick<PrismaClient, "company" | "budgetPlan" | "budgetLine">

/**
 * Returns one warning string per (plan kind) whose plan holds live P&L rows
 * on companies OUTSIDE this import's PLF footprint. Empty array when clean.
 * Read-only; callers treat failures as non-fatal.
 */
export async function detectStaleSiblingRows(
  prisma: Db,
  input: StaleSiblingInput,
): Promise<string[]> {
  const plfClassifications = input.classifications.filter(
    (c) => c.dataType === "PLF",
  )
  const affectedCodes = new Set(
    plfClassifications
      .filter((c) => c.role !== "derived_summary")
      .map((c) => c.entityCodeOverride ?? c.entityCode)
      .filter((code): code is string => !!code),
  )
  if (affectedCodes.size === 0) return []
  const affectedKinds = new Set(
    plfClassifications
      .map((c) => c.planKind)
      .filter((k): k is "actual" | "budget" => k === "actual" || k === "budget"),
  )
  if (affectedKinds.size === 0) return []

  const affectedIds = (
    await prisma.company.findMany({
      where: {
        organizationId: input.organizationId,
        code: { in: [...affectedCodes] },
      },
      select: { id: true },
    })
  ).map((c) => c.id)
  if (affectedIds.length === 0) return []

  const warnings: string[] = []
  for (const kind of affectedKinds) {
    const plans = await prisma.budgetPlan.findMany({
      where: {
        organizationId: input.organizationId,
        year: input.year,
        kind,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (plans.length === 0) continue
    const staleRaw = await prisma.budgetLine.groupBy({
      by: ["companyId"],
      where: {
        organizationId: input.organizationId,
        planId: { in: plans.map((p) => p.id) },
        deletedAt: null,
        companyId: { notIn: affectedIds },
      },
      _count: { _all: true },
      // Prisma's groupBy typing needs an orderBy aligned with `by` to
      // resolve its conditional signature; deterministic output is a bonus.
      orderBy: { companyId: "asc" },
    })
    const stale: Array<{ companyId: string | null; _count: { _all: number } }> =
      staleRaw
    const staleWithCompany = stale.filter((s) => s.companyId !== null)
    if (staleWithCompany.length === 0) continue

    const codeById = new Map(
      (
        await prisma.company.findMany({
          where: {
            organizationId: input.organizationId,
            id: { in: staleWithCompany.map((s) => s.companyId as string) },
          },
          select: { id: true, code: true },
        })
      ).map((c) => [c.id, c.code]),
    )
    const detail = staleWithCompany
      .map(
        (s) =>
          `${codeById.get(s.companyId as string) ?? s.companyId} (${s._count._all} rows)`,
      )
      .join(", ")
    warnings.push(
      `STALE_SIBLING_ROWS: the ${input.year} ${kind} plan still holds live P&L rows on companies OUTSIDE this import — ${detail}. ` +
        `If those came from an older import of the same statement (e.g. a consolidated version once written to the holding), they now DOUBLE-COUNT against the rows just imported. ` +
        `Review and archive them via Admin Tools → Reset company import data.`,
    )
  }
  return warnings
}

/** Narrow structural type so tests can stub prisma without the full client. */
export type StaleSiblingDb = Db
export type { Prisma }

/**
 * Phase 11.4 (2026-07-29) — single canonical resolver for the import target
 * `BudgetPlan`.
 *
 * The defect this closes
 * ──────────────────────
 * Four import routes resolved "the plan to write into" four different ways:
 *
 *   • `prod-adapter-context.ts` (AI Auto Import) looked up by **kind** and
 *     created `Azərşəkər <year> Actuals`.
 *   • `staging/[id]/apply`, `staging/[id]/apply-multi` and
 *     `onboarding/import/budget` looked up by **name** — `AI-Imported <year>
 *     Budget` — and created it **without `kind`**, so it took the schema
 *     default `"actual"`.
 *
 * A name lookup never finds a plan created under the other name, so importing
 * the same year through two different tabs produced TWO live plans, both
 * `kind="actual"`. The risk engine reads
 * `plan: { year, kind: "actual" }` with no `planId`
 * (`src/lib/risk/recompute-data-source.ts`), so it sums both — every P&L and
 * balance-sheet number silently doubles. Each import's clean-slate is
 * plan-scoped, so neither can ever reach the other's rows to correct it.
 *
 * `BudgetPlan` carries no unique constraint that would have prevented this
 * (`prisma/schema.prisma` has only `@@index([organizationId])`).
 *
 * The contract
 * ────────────
 * Resolve by **(organizationId, year, kind)** — never by name — and prefer the
 * OLDEST matching plan, which is the data-holding one every reader already
 * converges on. Names remain free-text labels; they are never identity.
 *
 * NOTE for anyone adding a fifth import path: call this. Do not write another
 * `findFirst({ where: { name } })`.
 */
import type { Prisma, PrismaClient } from "@prisma/client"

export type PlanKind = "actual" | "budget"

/** Canonical display name for a freshly created plan. Label only — the
 *  lookup above never matches on it. */
export function canonicalPlanName(year: number, kind: PlanKind): string {
  return `Azərşəkər ${year} ${kind === "budget" ? "Budget" : "Actuals"}`
}

/**
 * Find — or create — the one plan an import for `(organizationId, year, kind)`
 * must write into.
 *
 * @param db     A PrismaClient or a transaction client. Pass the transaction
 *               when the caller already holds one, so the plan row and the
 *               rows that reference it commit or roll back together.
 * @param opts.name  Optional label for a newly created plan. Ignored when a
 *               plan already exists — renaming someone's plan as a side effect
 *               of an import would be a surprise.
 */
export async function resolveImportPlan(
  db: PrismaClient | Prisma.TransactionClient,
  opts: {
    organizationId: string
    year: number
    kind?: PlanKind
    name?: string
    /** Defaults match what the AI Auto Import path has always created. */
    periodType?: string
    status?: string
  },
): Promise<{ id: string; created: boolean }> {
  const kind: PlanKind = opts.kind ?? "actual"

  const existing = await db.budgetPlan.findFirst({
    where: {
      organizationId: opts.organizationId,
      year: opts.year,
      kind,
      deletedAt: null,
    },
    // Oldest wins: it is the plan that already holds data, and the one every
    // reader converges on. Picking the newest would strand the real rows.
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  const created = await db.budgetPlan.create({
    data: {
      organizationId: opts.organizationId,
      year: opts.year,
      kind,
      name: opts.name ?? canonicalPlanName(opts.year, kind),
      periodType: opts.periodType ?? "annual",
      status: opts.status ?? "draft",
    },
    select: { id: true },
  })
  return { id: created.id, created: true }
}

/**
 * Detect the split this module exists to prevent: more than one live plan for
 * the same `(organizationId, year, kind)`.
 *
 * Returned by the admin duplicate-plan check and used as the pre-flight for
 * the partial unique index — the index cannot be created while duplicates
 * exist, so this has to report them first.
 */
export async function findDuplicateImportPlans(
  db: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
): Promise<
  Array<{
    year: number
    kind: string
    plans: Array<{ id: string; name: string; createdAt: Date }>
  }>
> {
  const plans = await db.budgetPlan.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, year: true, kind: true, createdAt: true },
  })
  const byKey = new Map<
    string,
    { year: number; kind: string; plans: Array<{ id: string; name: string; createdAt: Date }> }
  >()
  for (const p of plans) {
    const key = `${p.year}::${p.kind}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = { year: p.year, kind: p.kind, plans: [] }
      byKey.set(key, entry)
    }
    entry.plans.push({ id: p.id, name: p.name, createdAt: p.createdAt })
  }
  return [...byKey.values()].filter((e) => e.plans.length > 1)
}

/**
 * Phase 11.4 (2026-07-29) — duplicate import-plan check.
 *
 * GET /api/admin/duplicate-plans
 *
 * Reports every `(year, kind)` for which this organization has MORE THAN ONE
 * live `BudgetPlan`. That state silently doubles financial numbers: the risk
 * engine reads `plan: { year, kind: "actual" }` with no `planId`
 * (`src/lib/risk/recompute-data-source.ts`), so it sums both plans, while each
 * import's clean-slate is plan-scoped and therefore can never reach the other
 * plan's rows to correct it.
 *
 * It got that way because four import routes resolved their target plan
 * differently — two by `kind`, three by a hardcoded NAME, and those three
 * created the row without `kind`, so it took the schema default "actual".
 * `src/lib/onboarding/resolve-plan.ts` now closes that at the application
 * layer, and migration `20260729120000_budget_plan_unique_per_year_kind`
 * enforces it in the database.
 *
 * That migration deliberately REFUSES to apply while duplicates exist —
 * merging two plans' financial rows is an owner decision, not something a
 * migration should do silently. This endpoint is the pre-flight: it names the
 * groups and which plan `resolve-plan.ts` treats as canonical (the oldest, the
 * one readers already converge on), so the merge can be done deliberately.
 *
 * Read-only. Auth: admin role.
 */
import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { findDuplicateImportPlans } from "@/lib/onboarding/resolve-plan"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    )
  }
  const orgId = session.orgId

  const groups = await withOrgScope(orgId, (tx) =>
    findDuplicateImportPlans(tx, orgId),
  )

  return NextResponse.json({
    ok: true,
    clean: groups.length === 0,
    duplicateGroups: groups.map((g) => ({
      year: g.year,
      kind: g.kind,
      planCount: g.plans.length,
      // Oldest first — `resolveImportPlan` picks plans[0], so that is the
      // plan every new import already writes into and the natural merge
      // target for the rest.
      canonicalPlanId: g.plans[0].id,
      plans: g.plans.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        canonical: p.id === g.plans[0].id,
      })),
    })),
    migrationBlocked: groups.length > 0,
    guidance:
      groups.length > 0
        ? "Re-point each non-canonical plan's child rows (BudgetLine, BalanceSheetLine, BudgetActual, SalesBudgetLine, COGS*, BudgetAssumption) to canonicalPlanId, soft-delete the loser, then apply migration 20260729120000_budget_plan_unique_per_year_kind. Until then the terminal is summing both plans."
        : "No duplicates — migration 20260729120000_budget_plan_unique_per_year_kind can be applied.",
  })
}

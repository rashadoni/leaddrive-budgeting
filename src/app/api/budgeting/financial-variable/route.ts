/**
 * POST /api/budgeting/financial-variable
 *
 * Manual entry of a single FINANCIAL statement figure (e.g. period-end
 * inventory) from the Indicator-Health inline-entry surface. Sibling to
 * `/api/operational-facts` — same contract (manager+, Zod, validate,
 * 2-step confirm, recomputeAfterDataChange, audit) but writes to the
 * financial-statement table the recompute resolver reads, instead of the
 * `OperationalFact` time-series.
 *
 * For `inventory` the target is `BalanceSheetLine` in the shape the live
 * `balanceSheetLine.inventory` resolver expects (Phase 7.O): a current-asset
 * row on the year's kind="actual" plan, month=12 (year-end snapshot),
 * referencing an "Inventory" ChartOfAccount. Writing it makes
 * `FP_INVENTORY_TURNS` compute on the immediate recompute — **no engine change**.
 *
 * See `src/lib/risk/financial-variable-rules.ts` for the registry + resolver
 * contract this route honours.
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
// Stage 3 RLS — `prisma` kept for lockedResponse's 423-audit + the two
// fire-and-forget `void logAuditEvent` calls (must outlive the tx).
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"
import { logAuditEvent } from "@/lib/audit/log"
import { recomputeAfterDataChange } from "@/lib/recompute/recompute-on-change"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"
import { bsIsInventoryLine } from "@/lib/risk/recompute-resolvers-b"
import {
  FINANCIAL_VARIABLE_KEYS,
  getFinancialVariableRule,
  validateFinancialValue,
} from "@/lib/risk/financial-variable-rules"

const log = getLogger("api:financial-variable")

const CreateBodySchema = z.object({
  companyId: z.string().min(1),
  variable: z.enum(FINANCIAL_VARIABLE_KEYS as unknown as [string, ...string[]]),
  year: z.number().int().gte(2000).lte(2100),
  value: z.number().finite(),
  sourceNote: z.string().max(500).optional(),
  forceConfirm: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  let body: z.infer<typeof CreateBodySchema>
  try {
    body = CreateBodySchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid body",
        details: err instanceof z.ZodError ? err.format() : String(err),
      },
      { status: 400 },
    )
  }

  const rule = getFinancialVariableRule(body.variable)
  if (!rule) {
    return NextResponse.json(
      { error: `Unknown financial variable "${body.variable}"` },
      { status: 400 },
    )
  }
  // Defensive: the registry only ships balance-sheet variables today. A future
  // rule on another statement table must extend this handler explicitly rather
  // than silently writing the wrong row.
  if (rule.model !== "balanceSheetLine") {
    return NextResponse.json(
      { error: `Variable "${body.variable}" is not yet writable here` },
      { status: 400 },
    )
  }

  // Stage 3 RLS — company check, lock, dup-guard, plan/account/BS writes in
  // one org-scoped tx. Returns either a NextResponse (early exit) or the
  // written payload; the heavy recomputeAfterDataChange runs AFTER commit.
  const outcome = await withOrgScope(orgId, async (tx): Promise<
    | { response: NextResponse }
    | { row: { id: string; companyId: string | null; year: number; month: number; amount: number }; existing: boolean; companyCode: string | null; planId: string; accountId: string }
  > => {
  // Cross-tenant guard — the company must belong to the caller's org.
  const company = await tx.company.findFirst({
    where: { id: body.companyId, organizationId: orgId },
    select: { id: true, code: true },
  })
  if (!company) {
    return { response: NextResponse.json({ error: "Company not found" }, { status: 404 }) }
  }

  // Period-lock guard — a BalanceSheetLine is a financial-statement row that
  // Phase 4.2 period locks protect. The figure is a year-end (month=12)
  // snapshot, so check all three containing-period granularities (year /
  // quarter / month), mirroring the cash-flow direct-entry route. A locked
  // period → 423, no write. (Without this a manager could silently overwrite
  // inventory on a CFO-locked, audited year.)
  const lock = await findFirstActiveLockInPeriods(
    tx,
    orgId,
    containingPeriodKeys(body.year, 12),
  )
  if (lock) {
    return {
      response: lockedResponse(lock, {
        prisma,
        orgId,
        userId: session.userId,
        route: "POST /api/budgeting/financial-variable",
      }),
    }
  }

  // ── Pure validation → reject (hard bound) ───────────────────────────
  const check = validateFinancialValue(rule, body.value)
  if (!check.ok) {
    return {
      response: NextResponse.json(
        { error: "Validation failed", errors: check.errors },
        { status: 400 },
      ),
    }
  }

  // ── Double-count guard (soft confirm) ───────────────────────────────
  // The recompute resolver SUMS every current-asset row whose account name
  // matches the inventory heuristic, across ALL actual plans. This route
  // edits-in-place only within its OWN canonical account — so if an inventory
  // line already exists for this company/year under a DIFFERENT account (e.g.
  // an imported "Anbar ehtiyatları"), a manual write here would ADD a second
  // summand and silently distort the indicator (turns would halve). The
  // year-picker makes this reachable even when the form opened on a gappy
  // year. Detect it and fold it into the confirm-gate so the user decides
  // with the existing figure in view. (Only meaningful for balance-sheet
  // variables; today every variable is one.)
  const warnings = [...check.warnings]
  if (rule.model === "balanceSheetLine") {
    const currentAssets = await tx.balanceSheetLine.findMany({
      where: {
        organizationId: orgId,
        companyId: body.companyId,
        year: body.year,
        month: 12,
        deletedAt: null,
        lineType: rule.lineType,
        subType: rule.subType,
        plan: { kind: "actual" },
      },
      select: { amount: true, account: { select: { code: true, name: true } } },
    })
    const dupes = currentAssets.filter(
      (r) =>
        r.account.code !== rule.accountCode &&
        r.amount !== 0 &&
        bsIsInventoryLine(r.account.code, r.account.name),
    )
    if (dupes.length > 0) {
      const total = dupes.reduce((s, r) => s + r.amount, 0)
      const names = dupes.map((r) => r.account.name).join(", ")
      warnings.push(
        `Inventory is already recorded for this company in ${body.year} under: ${names} (total ${total} ${rule.unit}). Saving here adds a SEPARATE line — the indicator sums both and would double-count. Edit the existing line instead, or confirm to add anyway.`,
      )
    }
  }

  const requiresConfirm = !body.forceConfirm && warnings.length > 0
  if (requiresConfirm) {
    return { response: NextResponse.json({ requiresConfirm: true, warnings }, { status: 200 }) }
  }

  // ── Find-or-create the year's actual plan ───────────────────────────
  // Plans are org-level (companyId lives on the lines). One kind="actual"
  // plan per org+year holds every company's actual lines; reuse it. Create a
  // minimal one only when the year has no actuals at all.
  let plan = await tx.budgetPlan.findFirst({
    where: { organizationId: orgId, year: body.year, kind: "actual", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (!plan) {
    // Status "draft": recompute reads filter on kind="actual" only (never
    // status), so this is correctness-safe — and honest. Do NOT stamp
    // "approved" on a plan no human approved (that would mislead a
    // provenance reviewer). Audited below so the auto-creation is traceable.
    plan = await tx.budgetPlan.create({
      data: {
        organizationId: orgId,
        name: `${body.year} Actuals`,
        year: body.year,
        kind: "actual",
        periodType: "monthly",
        status: "draft",
      },
      select: { id: true },
    })
    log.info("created actuals plan for manual financial entry", {
      orgId,
      year: body.year,
      planId: plan.id,
    })
    void logAuditEvent(prisma, {
      organizationId: orgId,
      actorUserId: session.userId,
      event: {
        action: "budget_plan_create",
        entityType: "BudgetPlan",
        entityId: plan.id,
        metadata: {
          planName: `${body.year} Actuals`,
          year: body.year,
          scope: "auto:financial-variable-entry",
        },
      },
      context: { route: "/api/budgeting/financial-variable" },
    }).catch(() => {})
  }

  // ── Find-or-create the canonical CoA for this variable ──────────────
  // The resolver matches on account.name (not code), so the name must satisfy
  // the matcher; the code is the stable find-or-create key (org-unique).
  const account = await tx.chartOfAccount.upsert({
    where: { organizationId_code: { organizationId: orgId, code: rule.accountCode } },
    update: {},
    create: {
      organizationId: orgId,
      code: rule.accountCode,
      name: rule.accountName,
      accountType: rule.lineType,
    },
    select: { id: true },
  })

  // ── Upsert the balance-sheet row (year-end snapshot) ────────────────
  // No DB-level unique tuple → findFirst then update/create, mirroring the
  // edit-in-place semantic of /api/operational-facts.
  const existing = await tx.balanceSheetLine.findFirst({
    where: {
      organizationId: orgId,
      companyId: body.companyId,
      planId: plan.id,
      accountId: account.id,
      year: body.year,
      month: 12,
      deletedAt: null,
    },
    select: { id: true, amount: true },
  })

  const row = existing
    ? await tx.balanceSheetLine.update({
        where: { id: existing.id },
        data: {
          amount: body.value,
          notes: body.sourceNote ?? "manual:indicator-health",
        },
        select: { id: true, companyId: true, year: true, month: true, amount: true },
      })
    : await tx.balanceSheetLine.create({
        data: {
          organizationId: orgId,
          planId: plan.id,
          companyId: body.companyId,
          accountId: account.id,
          lineType: rule.lineType,
          subType: rule.subType,
          year: body.year,
          month: 12,
          amount: body.value,
          notes: body.sourceNote ?? "manual:indicator-health",
        },
        select: { id: true, companyId: true, year: true, month: true, amount: true },
      })

  // Audit — fire-and-forget on the global client (must outlive this tx).
  void logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: existing
        ? "financial_variable_update"
        : "financial_variable_create",
      entityType: "BalanceSheetLine",
      entityId: row.id,
      metadata: {
        companyId: body.companyId,
        companyCode: company.code ?? undefined,
        variable: rule.variable,
        year: body.year,
        value: body.value,
        unit: rule.unit,
        planId: plan.id,
        accountId: account.id,
        sourceNote: body.sourceNote,
        ...(existing ? { previousValue: existing.amount } : {}),
      },
    },
    context: { route: "/api/budgeting/financial-variable" },
  }).catch((err) => {
    log.error("audit log failed", {
      err: err instanceof Error ? err.message : String(err),
    })
  })

  return { row, existing: !!existing, companyCode: company.code, planId: plan.id, accountId: account.id }
  })

  if ("response" in outcome) return outcome.response

  // Recompute the company's indicators for the year so the dependent indicator
  // (e.g. FP_INVENTORY_TURNS) reflects the new figure immediately. Runs AFTER
  // the write tx commits — it's heavy indicator work, never inside the tx.
  const recompute = await recomputeAfterDataChange(orgId, body.companyId, body.year)

  return NextResponse.json(
    { row: outcome.row, recompute, unlocks: rule.unlocksIndicators },
    { status: outcome.existing ? 200 : 201 },
  )
}

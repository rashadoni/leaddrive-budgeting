/**
 * Custom drill-down tools the AI Analyst can call mid-conversation.
 *
 * The initial <section_data> blob Claude receives is an annual rollup — when
 * the user asks about a specific month or a single account, Claude needs to
 * pull more granular data. These tools let it do that without us having to
 * pre-compute every possible slice.
 *
 * Tool dispatch is always org-scoped and plan-scoped via the ctx argument;
 * never trust fields from the tool input to cross those boundaries.
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { Prisma } from "@prisma/client"
// Stage 3 RLS — AI drill-down tools for the SSE ai-analytics route.
// Read-only, scoped by explicit organizationId; BYPASSRLS admin client
// (a single withOrgScope tx can't span an LLM tool-loop). See the route's
// rls-scan-ignore note.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"

export type ToolName = "get_monthly_breakdown" | "get_account_drill"

export const TOOL_NAMES: readonly ToolName[] = ["get_monthly_breakdown", "get_account_drill"] as const

export function isCustomTool(name: string | undefined): name is ToolName {
  return !!name && (TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * Tool schemas exposed to Claude alongside the built-in `web_search` tool.
 * Descriptions matter — they are the only thing Claude uses to decide when to
 * call a tool, so be explicit about what data the tool returns and when it is
 * the right choice vs. the section_data it already has.
 */
export const AI_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_monthly_breakdown",
    description:
      "Pull a 12-month breakdown of amounts for the currently analyzed budget plan. " +
      "Use when the user asks about a specific month/quarter, a trend, or any question the " +
      "annual totals in <section_data> cannot answer. " +
      "Default source is BudgetForecastEntry (month-level what-if forecasts). " +
      "If `productCode` is provided, the source switches to COGSCostDetail (month-level COGS per product). " +
      "If the result has an empty months array and a `warning` field, it means monthly data was not generated yet " +
      "for that filter — explain to the user instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        accountCode: {
          type: "string",
          description:
            "Optional Chart of Accounts code or code prefix (e.g. '711', '601-01'). " +
            "Matched as a prefix against the forecast entry category string.",
        },
        lineType: {
          type: "string",
          enum: ["revenue", "cogs", "expense"],
          description: "Filter to one side of the P&L.",
        },
        productCode: {
          type: "string",
          description:
            "If set, switches the data source to COGSCostDetail and returns monthly COGS totals " +
            "for the specified product code as defined in the tenant's product catalog.",
        },
      },
    },
  },
  {
    name: "get_account_drill",
    description:
      "Drill into a single Chart of Accounts entry. Returns the account metadata plus every " +
      "BudgetLine and COGSCostDetail row referencing it (capped at 20 of each, sorted by amount). " +
      "Use this when the user asks about a specific account code, wants to know 'where does this number come from?', " +
      "or suspects an outlier.",
    input_schema: {
      type: "object",
      properties: {
        accountCode: {
          type: "string",
          description: "Chart of Accounts code, e.g. '711-02-01'.",
        },
      },
      required: ["accountCode"],
    },
  },
]

type ToolContext = { orgId: string; planId: string }

/**
 * Run a custom tool call by name. Returns a JSON-serialisable object that
 * will be stringified and passed back to Claude as the tool_result content.
 *
 * Any throw from inside is caught by the caller and surfaced to Claude as
 * `{ error: string, is_error: true }`.
 */
export async function runTool(
  name: ToolName,
  input: unknown,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  if (name === "get_monthly_breakdown") return runGetMonthlyBreakdown(input, ctx)
  if (name === "get_account_drill") return runGetAccountDrill(input, ctx)
  throw new Error(`Unknown custom tool: ${name satisfies never}`)
}

// --- get_monthly_breakdown -------------------------------------------------

interface MonthlyBreakdownInput {
  accountCode?: string
  lineType?: "revenue" | "cogs" | "expense"
  productCode?: string
}

function coerceMonthlyInput(raw: unknown): MonthlyBreakdownInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out: MonthlyBreakdownInput = {}
  if (typeof o.accountCode === "string" && o.accountCode.trim()) out.accountCode = o.accountCode.trim()
  if (o.lineType === "revenue" || o.lineType === "cogs" || o.lineType === "expense") out.lineType = o.lineType
  if (typeof o.productCode === "string" && o.productCode.trim()) out.productCode = o.productCode.trim()
  return out
}

async function runGetMonthlyBreakdown(raw: unknown, ctx: ToolContext) {
  const input = coerceMonthlyInput(raw)
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: ctx.planId, organizationId: ctx.orgId, deletedAt: null },
    select: { id: true, year: true, name: true },
  })
  if (!plan) return { error: "Plan not found or no longer accessible." }

  const emptyMonths = () =>
    Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount: 0, count: 0 }))

  // Product-oriented query → COGSCostDetail
  if (input.productCode) {
    const productLine = await prisma.productLine.findFirst({
      where: { organizationId: ctx.orgId, code: input.productCode, isActive: true },
      select: { id: true, name: true, code: true, unit: true },
    })
    if (!productLine) {
      return {
        source: "cogs_detail",
        year: plan.year,
        filterApplied: input,
        months: emptyMonths(),
        totalAmount: 0,
        warning: `No product found with code "${input.productCode}". Ask the user for the exact product code.`,
      }
    }
    const details = await prisma.cOGSCostDetail.findMany({
      where: {
        organizationId: ctx.orgId,
        planId: ctx.planId,
        productLineId: productLine.id,
        year: plan.year,
      },
      select: { month: true, amount: true },
    })
    const months = emptyMonths()
    for (const d of details) {
      const bucket = months[d.month - 1]
      if (bucket) {
        bucket.amount += d.amount
        bucket.count += 1
      }
    }
    const totalAmount = months.reduce((s, m) => s + m.amount, 0)
    return {
      source: "cogs_detail",
      year: plan.year,
      product: { code: productLine.code, name: productLine.name, unit: productLine.unit },
      filterApplied: input,
      months: months.map((m) => ({ ...m, amount: Math.round(m.amount) })),
      totalAmount: Math.round(totalAmount),
      ...(details.length === 0 && {
        warning: `No COGS cost detail rows found for product "${productLine.code}" in ${plan.year}.`,
      }),
    }
  }

  // Default path → BudgetForecastEntry
  const where: {
    organizationId: string
    planId: string
    year: number
    lineType?: string
    category?: { startsWith: string }
  } = {
    organizationId: ctx.orgId,
    planId: ctx.planId,
    year: plan.year,
  }
  if (input.lineType) where.lineType = input.lineType
  if (input.accountCode) where.category = { startsWith: input.accountCode }

  const entries = await prisma.budgetForecastEntry.findMany({
    where,
    select: { month: true, forecastAmount: true },
  })
  const months = emptyMonths()
  for (const e of entries) {
    const bucket = months[e.month - 1]
    if (bucket) {
      bucket.amount += e.forecastAmount
      bucket.count += 1
    }
  }
  const totalAmount = months.reduce((s, m) => s + m.amount, 0)
  return {
    source: "forecast",
    year: plan.year,
    filterApplied: input,
    months: months.map((m) => ({ ...m, amount: Math.round(m.amount) })),
    totalAmount: Math.round(totalAmount),
    ...(entries.length === 0 && {
      warning:
        "No monthly forecast entries matched this filter. The plan may only have annual totals " +
        "in BudgetLine. Tell the user that monthly-level data is not populated for this slice.",
    }),
  }
}

// --- get_account_drill -----------------------------------------------------

async function runGetAccountDrill(raw: unknown, ctx: ToolContext) {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const accountCode = typeof input.accountCode === "string" ? input.accountCode.trim() : ""
  if (!accountCode) return { error: "accountCode is required" }

  const account = await prisma.chartOfAccount.findFirst({
    where: { organizationId: ctx.orgId, code: accountCode },
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      accountType: true,
      category: true,
      parentCode: true,
    },
  })

  // BudgetLines referencing this account: match by accountId FK or department code fallback.
  const budgetLineWhere: Prisma.BudgetLineWhereInput = account
    ? { accountId: account.id }
    : { department: accountCode }

  const budgetLines = await prisma.budgetLine.findMany({
    where: {
      organizationId: ctx.orgId,
      planId: ctx.planId,
      // Soft-delete: re-import archives prior rows under the same planId →
      // without this the agent sums archived + live (inflated planned/forecast
      // totals + line count). Every other BudgetLine read filters this.
      deletedAt: null,
      ...budgetLineWhere,
    },
    take: 20,
    select: {
      id: true,
      department: true,
      lineType: true,
      plannedAmount: true,
      forecastAmount: true,
      notes: true,
      account: { select: { code: true, name: true } },
    },
    orderBy: { plannedAmount: "desc" },
  })

  const cogsCostDetails = await prisma.cOGSCostDetail.findMany({
    where: {
      organizationId: ctx.orgId,
      planId: ctx.planId,
      accountCode,
    },
    take: 20,
    select: {
      label: true,
      month: true,
      amount: true,
      quantity: true,
      unitPrice: true,
      unit: true,
      productLine: { select: { name: true, code: true } },
    },
    orderBy: { amount: "desc" },
  })

  type BudgetLineRow = (typeof budgetLines)[number]
  type CogsRow = (typeof cogsCostDetails)[number]

  const plannedTotal = budgetLines.reduce((s: number, l: BudgetLineRow) => s + l.plannedAmount, 0)
  const forecastTotal = budgetLines.reduce((s: number, l: BudgetLineRow) => s + (l.forecastAmount ?? 0), 0)
  const cogsTotal = cogsCostDetails.reduce((s: number, d: CogsRow) => s + d.amount, 0)

  return {
    account,
    budgetLines: budgetLines.map((l: BudgetLineRow) => ({
      category: (l as any).account?.code ?? "",
      department: l.department,
      lineType: l.lineType,
      plannedAmount: Math.round(l.plannedAmount),
      forecastAmount: l.forecastAmount != null ? Math.round(l.forecastAmount) : null,
      notes: l.notes,
    })),
    cogsCostDetails: cogsCostDetails.map((d: CogsRow) => ({
      label: d.label,
      month: d.month,
      amount: Math.round(d.amount),
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      unit: d.unit,
      product: d.productLine ? { code: d.productLine.code, name: d.productLine.name } : null,
    })),
    totals: {
      plannedAmount: Math.round(plannedTotal),
      forecastAmount: Math.round(forecastTotal),
      cogsAmount: Math.round(cogsTotal),
      budgetLineCount: budgetLines.length,
      cogsDetailCount: cogsCostDetails.length,
    },
    ...(account == null && {
      warning:
        `No Chart of Accounts entry found for code "${accountCode}". ` +
        `Showing any BudgetLine / COGSCostDetail rows that still reference this code as a legacy string.`,
    }),
  }
}

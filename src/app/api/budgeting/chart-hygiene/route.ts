import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { getSession, hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { logAuditEvent } from "@/lib/audit/log"
import {
  planDeactivation,
  hintFor,
  foldUsage,
  isDead,
  type HygieneKind,
  type HygieneCandidate,
  type Usage,
} from "@/lib/budgeting/chart-hygiene"

/**
 * GET / POST /api/budgeting/chart-hygiene
 *
 * The dictionaries accumulate entries nobody uses: the client's chart holds
 * 292 P&L accounts of which most carry no row in any plan, and 60 product
 * lines in the same state. They cost nothing in arithmetic and a great deal
 * in every dropdown, every mapping screen and every import review.
 *
 * ## What "dead" means here, precisely
 *
 * An account is dead when it appears in NONE of the four tables that
 * reference it — budget lines, balance-sheet lines, cash-flow entries and
 * COGS lines. Checking only the P&L would be the obvious mistake: an account
 * can be empty there and carry the balance sheet.
 *
 * Only LIVE rows count. Soft-deleted ones do not, and that distinction is the
 * whole feature: measured on production, treating archived rows as usage
 * leaves 0 dead accounts of 315, while the live test leaves 93 — every one of
 * them an account whose only rows belong to a superseded import. Those rows
 * are themselves purged after thirty days.
 *
 * Because a `data_restore` could bring such rows back, the archived count is
 * not hidden: each row states how many archived rows it has, so a reader can
 * tell "never used" from "used, then re-imported away" before deciding.
 *
 * Both halves of the test are load-bearing, and production says so. Checking
 * only budget lines would have offered all 23 balance-sheet accounts — Cash,
 * Inventories, Share capital — as dead, because they hold no P&L row. Counting
 * archived rows as usage would have offered nothing at all.
 *
 * ## The staleness window
 *
 * The list the user reads is a proposal, not the decision. POST re-reads the
 * counts inside its own transaction and refuses anything that has since
 * gained a row. This shrinks the window from "however long the screen sat
 * open" to the milliseconds between the count and the update — it does not
 * close it, since the transaction is read-committed and takes no lock on the
 * fact tables. Locking the fact tables to retire a dictionary row would be a
 * worse trade: the write is a reversible flag, and the refusal path is
 * recorded in the audit trail either way.
 */

type UsageMap = Map<string, Usage>

/**
 * Every table whose rows make a chart account live. Missing one is not a
 * degraded answer but a wrong one — omitting balance-sheet lines marks the
 * entire balance-sheet chart dead.
 */
async function accountUsage(
  tx: Prisma.TransactionClient,
  orgId: string,
  ids?: string[],
): Promise<UsageMap> {
  const base = ids ? { organizationId: orgId, accountId: { in: ids } } : { organizationId: orgId }
  const [budget, balance, cash, cogs, budgetGone, balanceGone, cashGone] = await Promise.all([
    tx.budgetLine.groupBy({ by: ["accountId"], _count: { _all: true }, where: { ...base, deletedAt: null } }),
    tx.balanceSheetLine.groupBy({ by: ["accountId"], _count: { _all: true }, where: { ...base, deletedAt: null } }),
    tx.cashFlowEntry.groupBy({ by: ["accountId"], _count: { _all: true }, where: { ...base, deletedAt: null } }),
    // No soft-delete column on this table: every row is live.
    tx.cOGSBudgetLine.groupBy({ by: ["accountId"], _count: { _all: true }, where: base }),
    tx.budgetLine.groupBy({ by: ["accountId"], _count: { _all: true }, where: { ...base, deletedAt: { not: null } } }),
    tx.balanceSheetLine.groupBy({ by: ["accountId"], _count: { _all: true }, where: { ...base, deletedAt: { not: null } } }),
    tx.cashFlowEntry.groupBy({ by: ["accountId"], _count: { _all: true }, where: { ...base, deletedAt: { not: null } } }),
  ])
  const rows = (g: Array<{ accountId: string; _count: { _all: number } }>) =>
    g.map((x) => ({ id: x.accountId, rows: x._count._all }))
  return foldUsage(
    [rows(budget), rows(balance), rows(cash), rows(cogs)],
    [rows(budgetGone), rows(balanceGone), rows(cashGone)],
  )
}

/**
 * Every table whose rows make a product line live, cost models included.
 * None of the three carries a soft-delete column, so `archived` stays zero.
 */
async function productUsage(
  tx: Prisma.TransactionClient,
  orgId: string,
  ids?: string[],
): Promise<UsageMap> {
  const where = ids
    ? { organizationId: orgId, productLineId: { in: ids } }
    : { organizationId: orgId }
  const [sales, cogs, components] = await Promise.all([
    tx.salesBudgetLine.groupBy({ by: ["productLineId"], _count: { _all: true }, where }),
    tx.cOGSBudgetLine.groupBy({ by: ["productLineId"], _count: { _all: true }, where }),
    // A configured cost model is not a transaction, but retiring the product
    // would orphan someone's work. Counts as usage.
    tx.costComponent.groupBy({ by: ["productLineId"], _count: { _all: true }, where }),
  ])
  const rows = (g: Array<{ productLineId: string; _count: { _all: number } }>) =>
    g.map((x) => ({ id: x.productLineId, rows: x._count._all }))
  return foldUsage([rows(sales), rows(cogs), rows(components)], [])
}

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasRole(session.role, "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const orgId = session.orgId

  return withOrgScope(orgId, async (tx) => {
    const [accounts, products] = await Promise.all([
      tx.chartOfAccount.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
      tx.productLine.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
    ])
    const [accountUsed, productUsed] = await Promise.all([
      accountUsage(tx, orgId),
      productUsage(tx, orgId),
    ])

    const build = (
      rows: Array<{ id: string; code: string; name: string }>,
      used: UsageMap,
      kind: HygieneKind,
    ) => {
      const live = rows.filter((r) => !isDead(used.get(r.id)))
      const dead = rows
        .filter((r) => isDead(used.get(r.id)))
        .map((r) => ({
          ...r,
          // Context for the reader, not an input to the decision.
          archived: used.get(r.id)?.archived ?? 0,
          hint: hintFor({ ...r, kind } satisfies HygieneCandidate, live),
        }))
      return { dead, activeTotal: rows.length, liveTotal: live.length }
    }

    return NextResponse.json({
      success: true,
      accounts: build(accounts, accountUsed, "account"),
      products: build(products, productUsed, "product"),
    })
  })
}

interface DeactivateBody {
  kind?: unknown
  ids?: unknown
}

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Retiring a shared dictionary entry changes what every other user sees.
  if (!hasRole(session.role, "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const orgId = session.orgId

  let body: DeactivateBody
  try {
    body = (await req.json()) as DeactivateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const kind = body.kind === "product" ? "product" : body.kind === "account" ? "account" : null
  if (!kind) return NextResponse.json({ error: "kind must be account or product" }, { status: 400 })
  if (!Array.isArray(body.ids) || body.ids.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 })
  }
  const ids = [...new Set(body.ids as string[])]
  if (ids.length === 0) {
    return NextResponse.json({ success: true, approved: [], refused: [] })
  }

  const result = await withOrgScope(orgId, async (tx) => {
    // Eligibility and freshness are both read here, inside the write's own
    // transaction — never taken from what the screen believed.
    const rows =
      kind === "account"
        ? await tx.chartOfAccount.findMany({
            where: { id: { in: ids }, organizationId: orgId, isActive: true },
            select: { id: true, code: true, name: true },
          })
        : await tx.productLine.findMany({
            where: { id: { in: ids }, organizationId: orgId, isActive: true },
            select: { id: true, code: true, name: true },
          })

    const usage =
      kind === "account" ? await accountUsage(tx, orgId, ids) : await productUsage(tx, orgId, ids)
    // Only live rows can veto. An archived row is history, and the row it
    // archived is scheduled for purge.
    const freshCounts = new Map([...usage].map(([id, u]) => [id, u.live]))

    const plan = planDeactivation({
      ids,
      freshCounts,
      eligible: new Set(rows.map((r) => r.id)),
    })

    if (plan.approved.length > 0) {
      const data = { isActive: false }
      const where = { id: { in: plan.approved }, organizationId: orgId }
      if (kind === "account") await tx.chartOfAccount.updateMany({ where, data })
      else await tx.productLine.updateMany({ where, data })
    }

    const byId = new Map(rows.map((r) => [r.id, r]))
    const label = (id: string) => byId.get(id) ?? { id, code: id, name: "" }
    return {
      approved: plan.approved.map(label),
      refused: plan.refused.map((r) => ({ ...label(r.id), reason: r.reason, rows: r.rows })),
    }
  })

  // Emitted after the transaction commits, on the global client: the
  // trail must not be able to roll the retirement back.
  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "chart_entry_deactivate",
      entityType: "ChartOfAccount",
      entityId: orgId,
      metadata: {
        kind,
        approved: result.approved.map((r) => ({ code: r.code, name: r.name })),
        refused: result.refused.map((r) => ({ code: r.code, reason: r.reason, rows: r.rows })),
      },
    },
    context: { route: "/api/budgeting/chart-hygiene" },
  }).catch(() => {})

  return NextResponse.json({ success: true, ...result })
}

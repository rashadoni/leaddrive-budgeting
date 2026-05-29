import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import type { Prisma, BudgetLine } from "@prisma/client"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resolvePatternForDept } from "@/lib/budgeting/cost-model-map"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { resolveOrCreateAccountId, createCoACache } from "@/lib/onboarding/upsert-chart-of-account"

const matrixSeedSchema = z.object({
  planId: z.string().min(1).max(100),
  includeRevenue: z.boolean().optional(),
  includeExpenses: z.boolean().optional(),
}).strict()

// ─── Operating Expense groups (OpEx) ────────────────────────────────────────
type ExpenseItem = {
  label: string
  amount: number
  department?: string
  costModelKey?: string
  isAutoActual?: boolean
}

type ExpenseGroup = {
  label: string
  sortOrder: number
  notes: string
  items: ExpenseItem[]
}

const EXPENSE_GROUPS: ExpenseGroup[] = [
  {
    label: "Admin Overhead", sortOrder: 100, notes: "group:admin",
    items: [
      { label: "Ofis icarəsi", amount: 30000 },
      { label: "İşçi sığortası (1 nəfər/ay)", amount: 5480 },
      { label: "Mobil rabitə (1 nəfər/ay)", amount: 4110 },
      { label: "LMS Platforma (illik, ƏDV xaric)", amount: 4916.67 },
      { label: "Treninqlər (illik)", amount: 20833.33 },
      { label: "Da Vinci Lisenziyaları (illik, ƏDV xaric)", amount: 373.67 },
      { label: "Maşın amortizasiyası (150k÷60 ay)", amount: 2500 },
      { label: "Maşın cari xərcləri", amount: 1200 },
      { label: "Laptop xərci", amount: 8500 },
      { label: "İnternet xərci", amount: 439 },
      { label: "Team building", amount: 10000 },
      { label: "BackOffice (17 ppl.)", amount: 109302.18 },
    ],
  },
  {
    label: "Technical Infrastructure", sortOrder: 200, notes: "group:tech_infra",
    items: [
      { label: "Bulud serverləri (ƏDV xaric)", amount: 23600 },
      { label: "Cortex/Crowdstrike (illik, ƏDV xaric)", amount: 49166.67 },
      { label: "MS Lisenziya (aylıq, ƏDV xaric)", amount: 8024 },
      { label: "Service Desk (illik, ƏDV xaric)", amount: 4916.67 },
      { label: "Firewall Palo Alto (illik, ƏDV xaric)", amount: 7473.33 },
      { label: "PAM Lisenziya (illik, ƏDV xaric)", amount: 3933.33 },
      { label: "Firewall amortizasiyası (130k÷84 ay)", amount: 1547.62 },
    ],
  },
  {
    label: "Direct Labor Costs", sortOrder: 300, notes: "group:labor",
    items: [
      { label: "IT dept", amount: 80880.28, department: "IT", costModelKey: "deptCosts.IT", isAutoActual: true },
      { label: "InfoSec dept", amount: 59087.16, department: "InfoSec", costModelKey: "deptCosts.InfoSec", isAutoActual: true },
      { label: "ERP dept", amount: 26045.46, department: "ERP", costModelKey: "deptCosts.ERP", isAutoActual: true },
      { label: "GRC dept", amount: 26798.24, department: "GRC", costModelKey: "deptCosts.GRC", isAutoActual: true },
      { label: "PM dept", amount: 23155.70, department: "PM", costModelKey: "deptCosts.PM", isAutoActual: true },
      { label: "HelpDesk dept", amount: 132922.16, department: "HelpDesk", costModelKey: "deptCosts.HelpDesk", isAutoActual: true },
    ],
  },
  {
    label: "Risk & Misc", sortOrder: 400, notes: "group:risk",
    items: [
      { label: "Miscellaneous Expenses (1%)", amount: 4362.85, costModelKey: "misc", isAutoActual: true },
      { label: "Risk Reserve (5%)", amount: 22032.37, costModelKey: "riskCost", isAutoActual: true },
    ],
  },
]

/**
 * POST /api/budgeting/matrix-seed
 *
 * Auto-generate BudgetLines for a plan using the matrix template:
 * costTypes × departments (Cartesian product) + OpEx expense groups.
 *
 * Body: { planId: string, includeRevenue?: boolean, includeExpenses?: boolean }
 *
 * For each non-shared costType → creates a line per active department.
 * For each shared costType → creates one line (no department).
 * If includeRevenue → creates revenue lines per department with hasRevenue=true.
 * If includeExpenses → creates operating expense lines (Admin, Tech Infra, Labor, Risk).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = matrixSeedSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId, includeRevenue = true, includeExpenses = true } = data

  const plan = await prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Phase 7.G Turn LXIX architect Round-1 ⚠️ closure — period-lock guard.
  // matrix-seed creates dozens of budgetLine rows across the cartesian
  // product of costTypes × departments + ~30 OpEx rows in one $transaction.
  const lock = await getActivePeriodLock(prisma, orgId, derivePeriodKey(plan))
  if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/matrix-seed" })

  const [costTypes, departments] = await Promise.all([
    prisma.budgetCostType.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.budgetDepartment.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { sortOrder: "asc" } }),
  ])

  if (costTypes.length === 0) {
    // CXLIII: error includes both English fallback (for non-i18n callers)
    // AND errorKey for UI to translate via next-intl. UI consumer:
    // `alert(t(json.errorKey, json.error))`.
    return NextResponse.json({
      error: "No cost types configured. Run seed or add via Settings.",
      errorKey: "matrixNoCostTypes",
    }, { status: 400 })
  }
  if (departments.length === 0) {
    return NextResponse.json({
      error: "No departments configured. Run seed or add via Settings.",
      errorKey: "matrixNoDepartments",
    }, { status: 400 })
  }

  // Build COGS + Revenue line specs (pure — no DB yet). Each spec carries
  // the ChartOfAccount resolution hints (code/name/accountType); the FK is
  // resolved-or-created inside the $transaction below so it's atomic with
  // the line insert. Phase 2.1 dropped BudgetLine.category and made
  // accountId NOT NULL — these specs omit `category` (so tsc rejects it if
  // re-added) and defer `accountId` to resolveOrCreateAccountId.
  type MatrixLineSpec = {
    coaCode: string
    coaName: string
    coaAccountType: string
    data: Omit<Prisma.BudgetLineUncheckedCreateInput, "accountId">
  }
  const lineSpecs: MatrixLineSpec[] = []
  let sortOrder = 0

  // COGS lines: costType × department matrix. The synthetic CoA code is
  // keyed on the cost type (MTX-COGS-<key>) — the department dimension is
  // already carried by departmentId, so every dept cell of one cost type
  // shares a single account (cache hit after the first cell).
  for (const ct of costTypes) {
    if (ct.isShared) {
      const costModelKey = ct.costModelPattern?.includes("{dept}")
        ? null
        : ct.costModelPattern || null
      sortOrder++
      lineSpecs.push({
        coaCode: `MTX-COGS-${ct.key}`,
        coaName: ct.label,
        coaAccountType: "cogs",
        data: {
          organizationId: orgId,
          planId,
          lineType: "cogs",
          plannedAmount: 0,
          costModelKey,
          isAutoPlanned: !!costModelKey,
          isAutoActual: false,
          costTypeId: ct.id,
          departmentId: null,
          department: null,
          sortOrder,
        },
      })
    } else {
      for (const dept of departments) {
        if (!dept.serviceKey) continue
        const costModelKey = ct.costModelPattern
          ? resolvePatternForDept(ct.costModelPattern, dept.serviceKey)
          : null
        sortOrder++
        lineSpecs.push({
          coaCode: `MTX-COGS-${ct.key}`,
          coaName: ct.label,
          coaAccountType: "cogs",
          data: {
            organizationId: orgId,
            planId,
            lineType: "cogs",
            plannedAmount: 0,
            costModelKey,
            isAutoPlanned: !!costModelKey,
            isAutoActual: false,
            costTypeId: ct.id,
            departmentId: dept.id,
            department: dept.label,
            sortOrder,
          },
        })
      }
    }
  }

  // Revenue lines: one per revenue-bearing department. CoA code keyed on
  // the department (MTX-REV-<key>).
  if (includeRevenue) {
    for (const dept of departments) {
      if (!dept.hasRevenue || !dept.serviceKey) continue
      sortOrder++
      lineSpecs.push({
        coaCode: `MTX-REV-${dept.key}`,
        coaName: dept.label,
        coaAccountType: "revenue",
        data: {
          organizationId: orgId,
          planId,
          lineType: "revenue",
          plannedAmount: 0,
          costModelKey: `serviceRevenues.${dept.serviceKey}`,
          isAutoPlanned: true,
          isAutoActual: false,
          costTypeId: null,
          departmentId: dept.id,
          department: dept.label,
          sortOrder,
        },
      })
    }
  }

  // Create COGS + Revenue lines, then expense groups with parent-child.
  // resolveOrCreateAccountId upserts the ChartOfAccount (role='unknown' for
  // later admin reclassification) inside the same tx — atomic with the line
  // insert. A shared coaCache makes it one upsert per distinct code.
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const coaCache = createCoACache()

    // 1. COGS + Revenue lines (flat). Sequential so the shared cache
    //    de-dups upserts deterministically (parallel cache misses would
    //    upsert the same code N times — atomic but wasteful).
    const flatLines: BudgetLine[] = []
    for (const spec of lineSpecs) {
      const accountId = await resolveOrCreateAccountId(tx, coaCache, {
        organizationId: orgId,
        code: spec.coaCode,
        defaultName: spec.coaName,
        defaultAccountType: spec.coaAccountType,
      })
      flatLines.push(await tx.budgetLine.create({ data: { ...spec.data, accountId } }))
    }

    // 2. Operating Expense groups (parent → children). Each distinct OpEx
    //    item gets its own account (MTX-EXP-<group>[-<n>]); the index is
    //    stable for this fixed template.
    const expenseLines: BudgetLine[] = []
    if (includeExpenses) {
      for (const group of EXPENSE_GROUPS) {
        const groupSlug = group.notes.replace(/^group:/, "")
        const parentAccountId = await resolveOrCreateAccountId(tx, coaCache, {
          organizationId: orgId,
          code: `MTX-EXP-${groupSlug}`,
          defaultName: group.label,
          defaultAccountType: "expense",
        })
        const parent = await tx.budgetLine.create({
          data: {
            organizationId: orgId, planId,
            lineType: "expense",
            plannedAmount: 0, sortOrder: group.sortOrder,
            notes: group.notes, isAutoActual: false,
            accountId: parentAccountId,
          },
        })
        expenseLines.push(parent)

        for (let i = 0; i < group.items.length; i++) {
          const item = group.items[i]
          const childAccountId = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: orgId,
            code: `MTX-EXP-${groupSlug}-${i + 1}`,
            defaultName: item.label,
            defaultAccountType: "expense",
          })
          const child = await tx.budgetLine.create({
            data: {
              organizationId: orgId, planId,
              lineType: "expense",
              plannedAmount: Math.round(item.amount * 100) / 100,
              parentId: parent.id, sortOrder: i + 1,
              department: item.department || null,
              costModelKey: item.costModelKey || null,
              isAutoActual: item.isAutoActual || false,
              accountId: childAccountId,
            },
          })
          expenseLines.push(child)
        }
      }
    }

    return [...flatLines, ...expenseLines]
  })

  return NextResponse.json({
    success: true,
    data: { count: created.length, lines: created },
  }, { status: 201 })
}

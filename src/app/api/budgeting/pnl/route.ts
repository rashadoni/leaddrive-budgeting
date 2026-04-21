import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// P&L structure sections
const PNL_SECTIONS = [
  { key: "revenue", label: "Net satış gəlirləri", codes: ["601", "602", "603"] },
  { key: "cogs", label: "Maya dəyəri", codes: ["701"] },
  { key: "gross_profit", label: "Məcmu gəlir", computed: true },
  { key: "other_income", label: "Digər gəlirlər", codes: ["611"] },
  { key: "sales_expenses", label: "Satış, marketinq və distribusiya xərcləri", codes: ["711"] },
  { key: "admin_expenses", label: "İnzibati xərclər", codes: ["721"] },
  { key: "ebitda", label: "FVƏA mənfəəti (EBITDA)", computed: true },
  { key: "depreciation", label: "Amortizasiya", codes: ["731"] },
  { key: "ebit", label: "Əməliyyat mənfəəti (EBIT)", computed: true },
  { key: "finance_costs", label: "Maliyyə xərcləri", codes: ["741", "751", "801"] },
  { key: "ebt", label: "Vergidən əvvəl mənfəət (EBT)", computed: true },
  { key: "extraordinary", label: "Fövqəladə xərclər", codes: ["761"] },
  { key: "tax", label: "Vergi xərcləri", codes: ["771"] },
  { key: "net_profit", label: "Xalis mənfəət", computed: true },
]

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  const year = parseInt(searchParams.get("year") || "2026")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Get all budget lines + sales + COGS data
  const [budgetLines, salesLines, cogsLines] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { organizationId: orgId, planId },
    }),
    prisma.salesBudgetLine.findMany({
      where: { organizationId: orgId, planId, year },
      include: { productLine: true },
    }),
    prisma.cOGSBudgetLine.findMany({
      where: { organizationId: orgId, planId, year },
      include: { productLine: true },
    }),
  ])

  // Monthly totals will be computed from budget_lines after filtering parents
  const monthlyRevenue: Record<number, number> = {}
  const monthlyCogs: Record<number, number> = {}
  for (let m = 1; m <= 12; m++) {
    monthlyRevenue[m] = 0
    monthlyCogs[m] = 0
  }

  // Build P&L rows grouped by account code + department name
  // This ensures products sharing the same SAP code (e.g. 601-01-02) appear as separate rows
  const accountMap = new Map<string, { code: string; name: string; type: string; sortOrder: number; monthlyAmounts: Record<number, number> }>()

  budgetLines.forEach((bl) => {
    // After import refactor: category=name, department=code
    // Fallback to old order (category=code, department=name) for legacy rows
    const maybeCode = bl.department || ""
    const maybeName = bl.category || ""
    const looksLikeCode = (s: string) => /^\d{3}/.test(s)
    const code = looksLikeCode(maybeCode) ? maybeCode : (looksLikeCode(maybeName) ? maybeName : maybeCode || "other")
    const name = code === maybeCode ? (maybeName || code) : (maybeCode || code)
    const mapKey = `${code}::${name}` // unique key per code+name

    if (!accountMap.has(mapKey)) {
      let accountType = "expense"
      if (code.startsWith("601") || code.startsWith("611")) accountType = "revenue"
      else if (code.startsWith("602") || code.startsWith("603")) accountType = "revenue"
      else if (code.startsWith("701")) accountType = "cogs"

      accountMap.set(mapKey, {
        code,
        name,
        type: accountType,
        sortOrder: bl.sortOrder,
        monthlyAmounts: {},
      })
    }

    const monthFromSort = bl.sortOrder % 100
    const month = monthFromSort >= 0 && monthFromSort < 12 ? monthFromSort + 1 : 0
    if (month >= 1 && month <= 12) {
      const acct = accountMap.get(mapKey)!
      acct.monthlyAmounts[month] = (acct.monthlyAmounts[month] || 0) + bl.plannedAmount
    }
  })

  // Filter out parent summary accounts to avoid double-counting
  // A parent code is one that has child codes (e.g. 601-01 has child 601-01-02)
  const allCodes = new Set(Array.from(accountMap.values()).map((a) => a.code))
  const isParentCode = (code: string) => {
    for (const c of allCodes) {
      if (c !== code && c.startsWith(code + "-")) return true
    }
    return false
  }

  // Convert to rows sorted by sortOrder (exclude parents)
  const leafAccounts = Array.from(accountMap.values()).filter((acct) => !isParentCode(acct.code))

  // Compute monthlyRevenue and monthlyCogs from leaf-level budget_lines
  // 602 (returns) and 603 (discounts) are contra-revenue — subtract from net revenue
  // COGS stored as positive in DB, but P&L view expects negative (GP = Revenue + COGS)
  leafAccounts.forEach((acct) => {
    for (let m = 1; m <= 12; m++) {
      const val = acct.monthlyAmounts[m] || 0
      if (acct.type === "revenue") {
        const isContraRevenue = acct.code.startsWith("602") || acct.code.startsWith("603")
        monthlyRevenue[m] += isContraRevenue ? -val : val
      } else if (acct.type === "cogs") {
        monthlyCogs[m] -= val // negative for P&L subtraction
      }
    }
  })

  const pnlRows = leafAccounts
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((acct) => {
      const monthly: Record<number, number> = {}
      let total = 0
      for (let m = 1; m <= 12; m++) {
        monthly[m] = acct.monthlyAmounts[m] || 0
        total += monthly[m]
      }

      const parts = acct.code.split("-")
      const parentCode = parts.length >= 2 ? parts.slice(0, -1).join("-") : null

      return {
        accountCode: acct.code,
        accountName: acct.name,
        accountType: acct.type,
        parentCode,
        monthly,
        total,
      }
    })

  return NextResponse.json({
    sections: PNL_SECTIONS,
    rows: pnlRows,
    monthlyRevenue,
    monthlyCogs,
    year,
  })
}

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function run() {
  const PLAN_ID = "cmp17ayy7000du6ockilfw0c4"
  const ORG_ID  = "cmockji6c0000u6oseeuz5ipq"
  const COMPANY_IDS = [
    "cmp17ayxy0005u6ocmd2pdn2g",
    "cmp17ayy3000bu6ocwwjrpkg9",
    "cmp17ayxt0003u6ocqtzmzwh0",
    "cmp17ayy20009u6oc5278nre0",
    "cmp17ayy00007u6ocnxmzi2f5",
    "cmp_azseker_malt_seed_session9",
    "cmpcynrfw0001u65mggbxf92x",
  ]

  const lines = await prisma.budgetLine.findMany({
    where: { organizationId: ORG_ID, planId: PLAN_ID, companyId: { in: COMPANY_IDS } },
    include: { account: { select: { code: true, name: true, accountType: true } } },
  })

  console.log("Total lines fetched:", lines.length)

  const SAP_CODE_PREFIX = /^\d{3}/
  const looksLikeCode = (s: string) => SAP_CODE_PREFIX.test(s)

  const accountMap = new Map<string, { code: string; type: string; total: number }>()

  for (const bl of lines) {
    let code: string, name: string
    if (bl.account) {
      code = bl.account.code
      name = bl.account.name
    } else {
      const maybeCode = bl.department || ""
      const maybeName = bl.category || ""
      code = looksLikeCode(maybeCode) ? maybeCode : (looksLikeCode(maybeName) ? maybeName : maybeCode || "other")
      name = code === maybeCode ? (maybeName || code) : (maybeCode || code)
    }

    const mapKey = (code === "other")
      ? `other::${bl.lineType}::${bl.category || bl.department || "unknown"}`
      : `${code}::${name}`

    if (!accountMap.has(mapKey)) {
      let accountType = bl.account?.accountType ?? "expense"
      if (!bl.account) {
        if (bl.lineType === "revenue") accountType = "revenue"
        else if (bl.lineType === "cogs") accountType = "cogs"
      }
      accountMap.set(mapKey, { code, type: accountType, total: 0 })
    }
    accountMap.get(mapKey)!.total += bl.plannedAmount
  }

  let revenueTotal = 0, cogsTotal = 0, expenseTotal = 0
  for (const acct of accountMap.values()) {
    if (acct.type === "revenue") revenueTotal += acct.total
    else if (acct.type === "cogs") cogsTotal += acct.total
    else expenseTotal += acct.total
  }

  console.log("Revenue:     ", (revenueTotal/1e6).toFixed(2), "M")
  console.log("COGS:        ", (cogsTotal/1e6).toFixed(2), "M")
  console.log("Expense:     ", (expenseTotal/1e6).toFixed(2), "M")
  console.log("Gross Profit:", ((revenueTotal - cogsTotal)/1e6).toFixed(2), "M")
  console.log("EBITDA:      ", ((revenueTotal - cogsTotal - expenseTotal)/1e6).toFixed(2), "M")
  console.log("Map entries: ", accountMap.size)

  // Lines with account vs without
  const withAcct = lines.filter((l: any) => l.account).length
  const withoutAcct = lines.filter((l: any) => !l.account).length
  console.log("Lines WITH account:", withAcct, " WITHOUT:", withoutAcct)
}

run().catch(console.error).finally(() => prisma.$disconnect())

// Extra: revenue from lines WITH account vs WITHOUT
async function extra() {
  const prisma2 = new PrismaClient()
  const lines = await prisma2.budgetLine.findMany({
    where: { planId: "cmp17ayy7000du6ockilfw0c4", companyId: { in: [
      "cmp17ayxy0005u6ocmd2pdn2g","cmp17ayy3000bu6ocwwjrpkg9","cmp17ayxt0003u6ocqtzmzwh0",
      "cmp17ayy20009u6oc5278nre0","cmp17ayy00007u6ocnxmzi2f5","cmp_azseker_malt_seed_session9","cmpcynrfw0001u65mggbxf92x"
    ]}},
    include: { account: { select: { code: true, accountType: true } } },
  })
  const revenueWithAcct = lines.filter((l: any) => l.account && l.account.accountType === "revenue").reduce((s: number, l: any) => s + l.plannedAmount, 0)
  const revenueWithoutAcct = lines.filter((l: any) => !l.account && l.lineType === "revenue").reduce((s: number, l: any) => s + l.plannedAmount, 0)
  console.log("Revenue (has account):", (revenueWithAcct/1e6).toFixed(2), "M")
  console.log("Revenue (no account): ", (revenueWithoutAcct/1e6).toFixed(2), "M")
  await prisma2.$disconnect()
}
extra().catch(console.error)

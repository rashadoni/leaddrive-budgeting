// @vitest-environment node
/**
 * The ledger is the only thing standing between the operator and a number
 * they cannot interpret. These tests pin the three properties the old panel
 * got wrong.
 */
import { describe, it, expect } from "vitest"
import { buildLedger, CATEGORIES, describeCategory, restorePlan } from "./categories"
import { IMPORT_RESET_CATEGORIES } from "@/lib/server/import-reset-categories"

describe("buildLedger", () => {
  it("groups by fate, in the fixed order, and drops empty groups", () => {
    const ledger = buildLedger({
      budgetLine: 100,
      budgetActualManual: 12,
      operationalFact: 40,
      indicatorValue: 7,
    })
    expect(ledger.groups.map((g) => g.fate)).toEqual([
      "recoverable",
      "permanent",
      "reimport",
      "recomputed",
    ])
  })

  it("never drops a key it has not been taught — it renders it as Other data", () => {
    // This is the structural fix for the class of bug that hid
    // `salesBudgetLine` and `indicatorValue` for a whole phase: the response
    // carried them, the component's hardcoded array did not.
    const ledger = buildLedger({ someTableNobodyMapped: 55 })
    const reimport = ledger.groups.find((g) => g.fate === "reimport")
    expect(reimport?.lines).toEqual([
      { key: "unknown", labelKey: "unknown", count: 55, unit: "rows" },
    ])
    expect(ledger.rows).toBe(55)
  })

  it("counts records in items and never folds them into the row total", () => {
    const ledger = buildLedger({
      budgetLine: 100,
      recordsCompliance: 3,
      complianceWriteBacks: 2,
    })
    expect(ledger.rows).toBe(100)
    expect(ledger.items).toBe(5)
    expect(ledger.itemsPermanent).toBe(2)
  })

  it("splits rows into recoverable and permanent", () => {
    const ledger = buildLedger({
      budgetLine: 1000,
      counterparty: 147,
      budgetActualManual: 12,
      orphanBudgetLine: 125,
      operationalFact: 500,
    })
    expect(ledger.rowsRecoverable).toBe(1147)
    expect(ledger.rowsPermanent).toBe(137)
    // The re-import group is neither — it is not "recoverable from here".
    expect(ledger.rows).toBe(1784)
  })

  it("counts zero-valued categories as collapsed, not as lines", () => {
    const ledger = buildLedger({ budgetLine: 10, cashFlowEntry: 0, counterparty: 0 })
    expect(ledger.emptyCount).toBe(2)
    expect(ledger.groups.flatMap((g) => g.lines)).toHaveLength(1)
  })

  it("is empty for an empty breakdown", () => {
    const ledger = buildLedger({})
    expect(ledger).toMatchObject({ rows: 0, items: 0, groups: [] })
  })
})

describe("the category table", () => {
  it("covers every key the preview can return for a selectable category", () => {
    // `records` fans out into the three grouped keys + the write-back count;
    // `budgetActual` into its imported and manual halves.
    const previewKeys = [
      ...IMPORT_RESET_CATEGORIES.filter((c) => c !== "records" && c !== "budgetActual"),
      "budgetActualImported",
      "budgetActualManual",
      "recordsCompliance",
      "recordsAssets",
      "recordsDescription",
      "complianceWriteBacks",
      "salesForecast",
      "orphanBudgetLine",
    ]
    for (const key of previewKeys) {
      expect(CATEGORIES[key], `${key} has no label, fate or unit`).toBeDefined()
    }
  })

  it("falls through to the unknown descriptor rather than throwing", () => {
    expect(describeCategory("nope")).toMatchObject({ labelKey: "unknown", fate: "reimport" })
  })
})

describe("the ledger's fate totals", () => {
  it("splits the rows four ways, and the four ways sum to the total", () => {
    // Only `rowsRecoverable` and `rowsPermanent` existed, so the headline had
    // no number for the largest bucket on this database and described it as
    // the smallest one instead.
    const ledger = buildLedger({
      budgetLine: 800,
      counterparty: 100,
      budgetActualManual: 50,
      operationalFact: 630,
      indicatorValue: 120,
    })
    expect(ledger.rowsRecoverable).toBe(900)
    expect(ledger.rowsPermanent).toBe(50)
    expect(ledger.rowsReimport).toBe(630)
    expect(ledger.rowsRecomputed).toBe(120)
    expect(
      ledger.rowsRecoverable +
        ledger.rowsPermanent +
        ledger.rowsReimport +
        ledger.rowsRecomputed,
    ).toBe(ledger.rows)
  })

  it("puts an unmapped table into a fate total, not only into the grand total", () => {
    const ledger = buildLedger({ budgetLine: 10, brandNewTable: 7 })
    expect(ledger.rows).toBe(17)
    expect(ledger.rowsReimport).toBe(7)
    expect(
      ledger.rowsRecoverable +
        ledger.rowsPermanent +
        ledger.rowsReimport +
        ledger.rowsRecomputed,
    ).toBe(ledger.rows)
  })

  it("keeps records out of every ROW total", () => {
    const ledger = buildLedger({ recordsCompliance: 3, complianceWriteBacks: 12 })
    expect(ledger.rows).toBe(0)
    expect(ledger.rowsReimport).toBe(0)
    expect(ledger.items).toBe(15)
    expect(ledger.itemsPermanent).toBe(12)
  })

  it("accounts for the server's rowsAffected as rows PLUS items", () => {
    // `previewCompanyImportReset` returns `rowsAffected` as the plain sum of
    // every breakdown bucket (archive.ts), and that number is what the commit
    // sends as `expectRows`. `{rows}` is deliberately smaller when records are
    // in scope — the difference is exactly `items`, which the headline names
    // in its own clause rather than pretending the two totals are one.
    const breakdown = {
      budgetLine: 600,
      budgetActualManual: 7,
      operationalFact: 620,
      indicatorValue: 50,
      recordsCompliance: 3,
      complianceWriteBacks: 12,
      recordsAssets: 2,
    }
    const serverRowsAffected = Object.values(breakdown).reduce((s, n) => s + n, 0)
    const ledger = buildLedger(breakdown)
    expect(ledger.rows).toBe(1277)
    expect(ledger.items).toBe(17)
    expect(ledger.rows + ledger.items).toBe(serverRowsAffected)
  })
})

describe("restorePlan", () => {
  it("promises only the kinds the deletion actually archived", () => {
    // A "only the operational figures" delete used to promise P&L lines,
    // balance-sheet rows, cash flow and counterparties, fire four calls and
    // report "0 rows brought back".
    const plan = restorePlan({ operationalFact: 900, indicatorValue: 50 })
    expect(plan.known).toBe(true)
    expect(plan.kinds).toEqual([])
    expect(plan.returns).toEqual([])
    // The FATE travels with each line. A single caption under the list was
    // wrong for `indicatorValue`, which no file returns and which is in every
    // per-company breakdown — so 100 % of restore panels carried the false
    // "upload the file again" promise.
    expect(plan.doesNotReturn).toEqual([
      { labelKey: "operationalFact", fate: "reimport" },
      { labelKey: "indicatorValue", fate: "recomputed" },
    ])
  })

  it("names each archived table once, and only the ones with rows", () => {
    const plan = restorePlan({
      budgetLine: 400,
      counterparty: 12,
      cashFlowEntry: 0,
      operationalFact: 30,
    })
    expect(plan.kinds).toEqual(["BudgetLine", "Counterparty"])
    expect(plan.returns).toEqual(["budgetLine", "counterparty"])
    expect(plan.doesNotReturn).toEqual([{ labelKey: "operationalFact", fate: "reimport" }])
  })

  it("falls back to all four kinds for an event that recorded no breakdown", () => {
    const empties: Array<Record<string, number> | undefined> = [undefined, {}, { budgetLine: 0 }]
    for (const breakdown of empties) {
      const plan = restorePlan(breakdown)
      expect(plan.known).toBe(false)
      expect(plan.kinds).toEqual([
        "BudgetLine",
        "BalanceSheetLine",
        "CashFlowEntry",
        "Counterparty",
      ])
    }
  })

  it("gives every soft-archived category a restore kind, and no other one", () => {
    // The restore endpoint's entityKind list and the `recoverable` fate are
    // the same set — if they ever diverge, one of them is lying.
    for (const [key, descriptor] of Object.entries(CATEGORIES)) {
      expect(
        Boolean(descriptor.restoreKind),
        `${key} is ${descriptor.fate} but restoreKind is ${descriptor.restoreKind}`,
      ).toBe(descriptor.fate === "recoverable")
    }
  })
})

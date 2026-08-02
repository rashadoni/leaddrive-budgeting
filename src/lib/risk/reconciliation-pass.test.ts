import { describe, it, expect } from "vitest"
import {
  reconcileImportedIndicators,
  describeMismatch,
  type ReconciliationDb,
} from "./reconciliation-pass"

const NOW = new Date("2026-08-02T10:00:00Z")

type Row = {
  id: string
  companyId: string
  indicatorId: string
  period: string
  value: number
}

/** Records every update so a test can assert what was written, not just returned. */
function fakeDb(
  defs: Array<{ id: string; code: string }>,
  rows: Row[],
): ReconciliationDb & { updates: Array<{ id: string; data: Record<string, unknown> }> } {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = []
  return {
    updates,
    indicatorDefinition: {
      findMany: async ({ where }) =>
        defs.filter((d) => where.code.in.includes(d.code)),
    },
    indicatorValue: {
      findMany: async ({ where }) =>
        rows.filter(
          (r) =>
            where.companyId.in.includes(r.companyId) &&
            where.indicatorId.in.includes(r.indicatorId) &&
            r.period === where.period,
        ),
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data: data as Record<string, unknown> })
        return null
      },
    },
  }
}

const DEFS = [
  { id: "d-rev", code: "IND_REVENUE_TOTAL" },
  { id: "d-gm", code: "IND_GROSS_MARGIN" },
]

/** AZSEKER-EDEN, `PLF Budget 2026`, as the sheet computes it. */
const EDEN = {
  "PLF.01": 31_986_950.0,
  "PLF.03": 11_382_237.98,
}

describe("reconcileImportedIndicators", () => {
  it("stamps a match and moves lastReconciledAt forward", async () => {
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 31_986_950.0 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.matched).toBe(1)
    expect(s.mismatched).toBe(0)
    expect(db.updates[0].data).toMatchObject({
      reconStatus: "matched",
      reconExpected: 31_986_950.0,
      lastReconciledAt: NOW,
      reconCheckedAt: NOW,
      reconciledBy: "import",
    })
  })

  it("CLEARS lastReconciledAt on a mismatch", async () => {
    // The case that decides whether the gate is honest: a value that passed in
    // June and fails today. Leaving June's stamp keeps it decision-grade while
    // every surface says it is wrong — the gate would be the last to know.
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 39_000_000 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.mismatched).toBe(1)
    expect(db.updates[0].data.reconStatus).toBe("mismatched")
    expect(db.updates[0].data.lastReconciledAt).toBeNull()
    // The expected figure is stored even on failure — the screen has to be
    // able to say what the source actually said, not just that it differed.
    expect(db.updates[0].data.reconExpected).toBe(31_986_950.0)
    expect(s.mismatches[0].delta).toBeCloseTo(7_013_050, 2)
  })

  it("writes no verdict when the statement cannot form the figure", async () => {
    // Zero revenue: the margin has no counterpart to be checked against.
    // Stamping "matched" here would certify an empty company.
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-gm", period: "2026", value: 0 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: { "PLF.01": 0, "PLF.03": 0 } }],
      actor: "import",
      now: NOW,
    })
    expect(db.updates).toHaveLength(0)
    expect(s.checked).toBe(0)
    expect(s.matched).toBe(0)
  })

  it("counts what it did NOT check, so a clean run cannot read as all-clear", async () => {
    // Two companies × two reconcilable indicators = four possible checks; one
    // value exists. Reporting only "0 mismatches" would let a run that
    // compared almost nothing look like a run that verified everything.
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 31_986_950.0 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [
        { companyId: "c1", statedSubtotals: EDEN },
        { companyId: "c2", statedSubtotals: EDEN },
      ],
      actor: "import",
      now: NOW,
    })
    expect(s.checked).toBe(1)
    expect(s.notChecked).toBe(3)
  })

  it("only ever looks at the year period", async () => {
    // These subtotals are the sheet's FY column. Checking an April margin
    // against a full-year total would manufacture a mismatch on every month
    // of every company.
    const db = fakeDb(DEFS, [
      { id: "iv-apr", companyId: "c1", indicatorId: "d-rev", period: "2026-04", value: 1 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(db.updates).toHaveLength(0)
    expect(s.mismatched).toBe(0)
  })

  it("sums two statements for the same company rather than picking one", async () => {
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 300 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [
        { companyId: "c1", statedSubtotals: { "PLF.01": 100 } },
        { companyId: "c1", statedSubtotals: { "PLF.01": 200 } },
      ],
      actor: "import",
      now: NOW,
    })
    expect(s.matched).toBe(1)
  })

  it("sums blindly — which is why the CALLER must not mix plan kinds", async () => {
    // Found end-to-end against production on 2026-08-02. `actual-budget-v1.xlsx`
    // holds both `PLF Actual 2026` and `PLF Budget 2026`, a year=2026 run
    // imports both, and this function cannot tell them apart: it is handed
    // subtotals and adds them. EDEN's real actual revenue (266,379) plus its
    // budget (31,986,950) becomes an "expected" figure matching neither, and
    // every correct value on the grid gets ringed as wrong.
    //
    // The fix belongs at the collection site, not here — `planKindCoversFamily`
    // in the orchestrator, the same gate lineage already applies, because only
    // the actuals plan is visible to `listBudgetLines` and therefore only its
    // statement describes anything an indicator computed. This test exists so
    // the blindness is a documented property rather than a surprise, and so a
    // future reader who removes that gate sees what it was holding back.
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 266_379.02 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [
        { companyId: "c1", statedSubtotals: { "PLF.01": 266_379.02 } }, // actual
        { companyId: "c1", statedSubtotals: { "PLF.01": 31_986_950 } }, // budget
      ],
      actor: "import",
      now: NOW,
    })
    expect(s.mismatched).toBe(1)
    expect(s.mismatches[0].expected).toBeCloseTo(32_253_329.02, 2)
    // Against the actuals statement alone — what the caller must supply — the
    // very same stored value is correct.
    const ok = await reconcileImportedIndicators(
      fakeDb(DEFS, [
        { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 266_379.02 },
      ]),
      {
        organizationId: "org",
        year: 2026,
        sources: [{ companyId: "c1", statedSubtotals: { "PLF.01": 266_379.02 } }],
        actor: "import",
        now: NOW,
      },
    )
    expect(ok.matched).toBe(1)
  })

  it("does nothing at all when no statement was supplied", async () => {
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 1 },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: {} }],
      actor: "import",
      now: NOW,
    })
    expect(db.updates).toHaveLength(0)
    expect(s).toMatchObject({ checked: 0, matched: 0, mismatched: 0, notChecked: 0 })
  })
})

describe("describeMismatch", () => {
  it("states both numbers without deciding which is wrong", () => {
    const line = describeMismatch(
      {
        companyId: "c1",
        indicatorCode: "IND_REVENUE_TOTAL",
        period: "2026",
        actual: 72_333_200,
        expected: 58_880_102.23,
        delta: 13_453_097.77,
      },
      () => "AZSEKER-EDEN",
    )
    expect(line).toContain("72333200.00")
    expect(line).toContain("58880102.23")
    expect(line).toContain("13453097.77")
  })
})

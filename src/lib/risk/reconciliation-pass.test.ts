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
  /** 2026-08-04 — an unscored row still stores a value; the pass must skip it. */
  status?: string | null
  reconStatus?: string | null
  reconAcceptedDelta?: number | null
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

  it("does not certify a cell that was never measured", async () => {
    // 2026-08-04 audit. An unscored row still stores a value, almost always 0.
    // When the statement figure was also 0 the pair landed inside tolerance,
    // was written `matched`, and stamped `lastReconciledAt` — the field the
    // decision-grade gate reads as "checked against its source". The platform
    // was issuing itself a certificate for a number it had never computed.
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 0, status: "unknown" },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.matched).toBe(0)
    expect(s.mismatched).toBe(0)
    // It stays counted as what it is: not checked.
    expect(s.checked).toBe(0)
    expect(db.updates).toHaveLength(0)
  })

  it("still reconciles a scored row whose measured value is zero", async () => {
    // The other half of the contract: a real, measured 0 is a real figure and
    // must still be checked against the statement.
    const db = fakeDb(DEFS, [
      { id: "iv1", companyId: "c1", indicatorId: "d-rev", period: "2026", value: 31_986_950.0, status: "green" },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.matched).toBe(1)
    expect(db.updates[0].data).toMatchObject({ reconStatus: "matched", lastReconciledAt: NOW })
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

  it("keeps an accepted difference accepted while it is the SAME difference (13.7)", async () => {
    // AZSF 2025 is the live case: that block does not cross-foot in either
    // direction, so no correction to our data can ever clear its marker.
    // Without acceptance the only way to silence it is to falsify a row.
    const db = fakeDb(DEFS, [
      {
        id: "iv1",
        companyId: "c1",
        indicatorId: "d-rev",
        period: "2026",
        value: 32_000_000,
        reconStatus: "accepted",
        reconAcceptedDelta: 32_000_000 - 31_986_950,
      },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.stillAccepted).toBe(1)
    expect(s.mismatched).toBe(0)
    // Reported separately from `matched`, never folded into it: an accepted
    // difference is a decision ABOUT a disagreement, not the absence of one.
    expect(s.matched).toBe(0)
    // And left alone — the signature already says what this row is.
    expect(db.updates).toHaveLength(0)
  })

  it("drops the acceptance the moment the number moves", async () => {
    // The property that makes this a signature rather than a mute button. A
    // moved figure is a DIFFERENT disagreement, which nobody has looked at,
    // and it must not inherit yesterday's approval.
    const db = fakeDb(DEFS, [
      {
        id: "iv1",
        companyId: "c1",
        indicatorId: "d-rev",
        period: "2026",
        value: 39_000_000,
        reconStatus: "accepted",
        reconAcceptedDelta: 32_000_000 - 31_986_950,
      },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.stillAccepted).toBe(0)
    expect(s.mismatched).toBe(1)
    expect(db.updates[0].data.reconStatus).toBe("mismatched")
    expect(db.updates[0].data.lastReconciledAt).toBeNull()
  })

  it("ignores an acceptance with no recorded gap rather than trusting it", async () => {
    // A row marked accepted but carrying no delta cannot be re-verified, so it
    // is not an acceptance — it is a mark of unknown provenance, and the safe
    // reading is the one that shows the disagreement.
    const db = fakeDb(DEFS, [
      {
        id: "iv1",
        companyId: "c1",
        indicatorId: "d-rev",
        period: "2026",
        value: 39_000_000,
        reconStatus: "accepted",
        reconAcceptedDelta: null,
      },
    ])
    const s = await reconcileImportedIndicators(db, {
      organizationId: "org",
      year: 2026,
      sources: [{ companyId: "c1", statedSubtotals: EDEN }],
      actor: "import",
      now: NOW,
    })
    expect(s.mismatched).toBe(1)
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

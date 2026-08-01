// @vitest-environment happy-dom
/**
 * The block the operator reads before pressing a red button.
 *
 * Translations are mocked to their keys, so these assert on structure and on
 * the numbers, not on copy that will keep being edited.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key
    const varStr = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join(",")
    return `${key}(${varStr})`
  },
}))

import { BlastRadius } from "./BlastRadius"

afterEach(cleanup)

const props = {
  companyCount: 3,
  /** One named year — the only scope that leaves a restorable audit event. */
  years: [2026],
  checkedAt: null,
  stale: false,
  onRecheck: () => {},
}

/** Multi-year and all-years deletes are NOT restorable from this page. */
const wideProps = { ...props, years: [] as number[] }

/** Every `name=123` pair the mocked translator printed into the headline. */
function headlineNumbers(): Record<string, number> {
  const text = screen.getByTestId("radius-headline").textContent ?? ""
  const out: Record<string, number> = {}
  for (const [, k, v] of text.matchAll(/([a-z]+)=(\d+)/gi)) out[k] = Number(v)
  return out
}

describe("BlastRadius", () => {
  it("splits the headline into recoverable and permanent when something is permanent", () => {
    render(
      <BlastRadius
        {...props}
        breakdown={{ budgetLine: 1147, budgetActualManual: 137 }}
      />,
    )
    const headline = screen.getByTestId("radius-headline").textContent ?? ""
    expect(headline).toContain("rows=1284")
    expect(headline).toContain("recoverable=1147")
    expect(headline).toContain("permanent=137")
  })

  it("REPLACES a clause rather than printing zero", () => {
    // "0 gone for good" is the sentence that teaches an operator to stop
    // reading the sentence.
    render(<BlastRadius {...props} breakdown={{ budgetLine: 1147 }} />)
    const headline = screen.getByTestId("radius-headline").textContent ?? ""
    expect(headline).toContain("radius.headlineLead(rows=1147)")
    expect(headline).not.toContain("permanent=0")
    expect(headline).not.toContain("reimport=0")
    expect(screen.queryByTestId("radius-group-permanent")).toBeNull()
  })

  it("NEVER says a hard-deleted row can be brought back from this page", () => {
    // The production case. `rowsPermanent` is 0 on this database and
    // `operationalFact` is not — the old headline read the first number,
    // ignored the second, and printed "all of them can be brought back" over
    // 1,550 rows that only a workbook returns.
    render(
      <BlastRadius
        {...props}
        breakdown={{
          operationalFact: 900,
          budgetActualImported: 400,
          salesBudgetLine: 200,
          indicatorValue: 50,
        }}
      />,
    )
    const n = headlineNumbers()
    expect(n.rows).toBe(1550)
    expect(n.reimport).toBe(1500)
    expect(n.recomputed).toBe(50)
    expect(n.recoverable).toBeUndefined()
    expect(n.permanent).toBeUndefined()
  })

  it("accounts for every row it names — the clauses sum to the total", () => {
    render(
      <BlastRadius
        {...props}
        breakdown={{
          budgetLine: 800,
          budgetActualManual: 50,
          operationalFact: 630,
          indicatorValue: 120,
          // A table nobody has mapped yet is hard-deleted like its fate group,
          // so it must land in a clause and not only in the total.
          brandNewTable: 7,
        }}
      />,
    )
    const n = headlineNumbers()
    expect(n.rows).toBe(1607)
    expect(n.recoverable + n.reimport + n.permanent + n.recomputed).toBe(n.rows)
  })

  it("renders the fate groups in order, permanent second", () => {
    render(
      <BlastRadius
        {...props}
        breakdown={{
          budgetLine: 10,
          budgetActualManual: 2,
          operationalFact: 5,
          indicatorValue: 3,
        }}
      />,
    )
    const order = ["recoverable", "permanent", "reimport", "recomputed"].map(
      (f) => screen.getByTestId(`radius-group-${f}`),
    )
    // DOM order matches the intended reading order.
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it("renders a key it has never been taught instead of hiding it", () => {
    render(<BlastRadius {...props} breakdown={{ brandNewTable: 42 }} />)
    expect(screen.getByText("category.unknown")).toBeTruthy()
    expect(screen.getByText("unit.rows(count=42)")).toBeTruthy()
  })

  it("counts records in items, and keeps them out of the row headline", () => {
    render(
      <BlastRadius {...props} breakdown={{ budgetLine: 100, recordsCompliance: 3 }} />,
    )
    expect(screen.getByTestId("radius-lead").textContent).toContain("rows=100")
    expect(screen.getByText("unit.items(count=3)")).toBeTruthy()
  })

  it("NAMES the records in the headline, in their own unit", () => {
    // Keeping records out of `{rows}` is right — different unit. Keeping them
    // out of the SENTENCE meant a delete of 17 records summarised them as 0.
    render(
      <BlastRadius
        {...props}
        breakdown={{ budgetLine: 100, recordsCompliance: 3, complianceWriteBacks: 12 }}
      />,
    )
    const headline = screen.getByTestId("radius-headline").textContent ?? ""
    expect(headline).toContain("radius.headlineLead(rows=100)")
    expect(headline).toContain("radius.headlineRecordsClause(records=15)")
    expect(headline).toContain("radius.headlineRecordsPermanentClause(permanent=12)")
    // …and the records never leak into the row total.
    expect(headline).not.toContain("rows=115")
  })

  it("does not print «0 rows will be deleted» over records it is about to destroy", () => {
    // The reviewer's case C: a company holding only compliance records. The
    // largest line on the screen used to read "0 sətir silinəcək." directly
    // above twelve write-backs no file and no engineer brings back.
    render(
      <BlastRadius
        {...props}
        breakdown={{ recordsCompliance: 3, complianceWriteBacks: 12 }}
      />,
    )
    const lead = screen.getByTestId("radius-lead").textContent ?? ""
    expect(lead).toBe("radius.headlineRecordsOnlyLead(records=15)")
    expect(lead).not.toContain("rows=0")
    // The lead already names the 15, so the "plus N records" clause would
    // repeat it — but the permanent 12 still gets said out loud.
    const clauses = screen.getByTestId("radius-clauses").textContent ?? ""
    expect(clauses).not.toContain("headlineRecordsClause")
    expect(clauses).toContain("radius.headlineRecordsPermanentClause(permanent=12)")
  })

  it("only promises this page can bring rows back when this delete leaves a way", () => {
    // One named year → `archive.ts` records `metadata.year` → the row appears
    // in the restore list. This is the ONLY scope where the promise is true.
    render(<BlastRadius {...props} breakdown={{ budgetLine: 800 }} />)
    const headline = screen.getByTestId("radius-headline").textContent ?? ""
    expect(headline).toContain("radius.headlineRecoverableClause(recoverable=800)")
    expect(headline).not.toContain("headlineArchivedClause")
    expect(screen.getByTestId("radius-group-recoverable")).toBeTruthy()
    expect(screen.queryByTestId("radius-archived-caveat")).toBeNull()
  })

  it("says only technical support can bring back an all-years delete", () => {
    // Tasks B and D are all-years by construction, so this is 100 % of them.
    render(<BlastRadius {...wideProps} breakdown={{ budgetLine: 800 }} />)
    const headline = screen.getByTestId("radius-headline").textContent ?? ""
    expect(headline).toContain("radius.headlineArchivedClause(archived=800)")
    expect(headline).not.toContain("headlineRecoverableClause")
    expect(screen.getByTestId("radius-group-archived")).toBeTruthy()
    expect(screen.queryByTestId("radius-group-recoverable")).toBeNull()
    expect(screen.getByTestId("radius-archived-caveat").textContent).toBe(
      "radius.caveat.archivedSupport",
    )
  })

  it("says the same about a multi-year delete — the audit event records no year", () => {
    render(
      <BlastRadius {...props} years={[2025, 2026]} breakdown={{ budgetLine: 800 }} />,
    )
    const headline = screen.getByTestId("radius-headline").textContent ?? ""
    expect(headline).toContain("radius.headlineArchivedClause(archived=800)")
    expect(headline).not.toContain("headlineRecoverableClause")
  })

  it("keeps the bold lead to one sentence and the clauses on their own lines", () => {
    // A lead ending in a full stop with lowercase clauses joined by " · "
    // rendered as one 200-character bold run whose only permanent clause was
    // third in a middot list.
    render(
      <BlastRadius
        {...props}
        breakdown={{ budgetLine: 10, budgetActualManual: 2, operationalFact: 5 }}
      />,
    )
    expect(screen.getByTestId("radius-lead").textContent).toBe(
      "radius.headlineLead(rows=17)",
    )
    expect(screen.getByTestId("radius-lead").textContent).not.toContain("·")
    expect(screen.getByTestId("radius-clauses").children.length).toBe(3)
  })

  it("shows a caveat only on the line that earned it", () => {
    render(<BlastRadius {...props} breakdown={{ salesForecast: 24, budgetLine: 1 }} />)
    expect(screen.getByText("radius.caveat.salesForecast")).toBeTruthy()
    expect(screen.queryByText("radius.caveat.counterparty")).toBeNull()
  })

  it("collapses the empty categories instead of listing a wall of zeros", () => {
    render(
      <BlastRadius
        {...props}
        breakdown={{ budgetLine: 10, cashFlowEntry: 0, counterparty: 0, salesForecast: 0 }}
      />,
    )
    expect(screen.getByText(/radius.zeroCollapse\(count=3\)/)).toBeTruthy()
    expect(screen.queryByText("category.cashFlowEntry")).toBeNull()
  })

  it("says nothing will be deleted when nothing will be", () => {
    render(<BlastRadius {...props} breakdown={{ budgetLine: 0 }} />)
    expect(screen.getByTestId("blast-radius").textContent).toContain("zero.emptySelection")
  })

  it("warns when the numbers have gone stale", () => {
    render(<BlastRadius {...props} stale breakdown={{ budgetLine: 10 }} />)
    expect(screen.getByText("check.stale")).toBeTruthy()
  })
})

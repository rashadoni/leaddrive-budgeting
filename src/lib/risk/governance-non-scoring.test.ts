/**
 * 11.71 — legal/compliance is informational and must not move a financial score.
 *
 * This is a PRODUCT DECISION, not a bug fix. The owner's directive:
 *
 *   «судебные думаю они были лишние для финансовой платформы»
 *   «они как-то должны быть отдельными и не взаимодействовать с финансовой
 *    частью»
 *
 * Court cases and audit findings are real facts about a company and stay fully
 * visible — heat-map columns, status colours, drill-down, Compliance Hub,
 * exports, the red-count alert. What goes away is their weight in the composite
 * risk score, where they were being averaged in next to gross margin and debt
 * coverage.
 *
 * The four affected definitions are the entire `governance` category:
 * LEGAL_CASES_TOTAL, LEGAL_CASES_ACTIVE, AUDIT_MAJOR_OPEN, AUDIT_CLOSED_PCT.
 * The exact code list is pinned separately in `indicator-seeds.test.ts` so a
 * rename or an unreviewed fifth seed fails a test rather than silently changing
 * every score on the terminal.
 *
 * Every test below fails if the rule is removed from `countsTowardComposite`,
 * or if the `scoring` flag stops being enforced inside `computeCompositeScore`.
 */
import { describe, it, expect } from "vitest"
import {
  countsTowardComposite,
  indicatorProvenance,
  isNonScoringCategory,
  markNonScoringCells,
  excludeNonScoringCells,
  nonScoringIndicatorIds,
} from "./indicator-provenance"
import {
  computeCompositeScore,
  computeCompositeByCompany,
} from "./composite-score"
import type { HeatMapCell } from "./heatmap-matrix"
import {
  evaluateAlertRules,
  RULE_COMPANY_CRITICAL_COMPOSITE,
  RULE_COMPANY_MOSTLY_RED,
  type AlertContext,
} from "./alert-rules"
import { DEFAULT_ALERT_THRESHOLDS } from "./alert-thresholds-config"

// The four production `governance` definitions, shaped as the matrix API and
// every server producer project them. Note `requiredInputs` is client data
// (`operationalFact:*`) — the 11.66 provenance rule can NEVER see these, which
// is precisely why a second, orthogonal predicate was needed.
const GOVERNANCE_INDICATORS = [
  {
    id: "g1",
    code: "LEGAL_CASES_TOTAL",
    category: "governance",
    requiredInputs: ["operationalFact:LEGAL_CASES_TOTAL"],
  },
  {
    id: "g2",
    code: "LEGAL_CASES_ACTIVE",
    category: "governance",
    requiredInputs: ["operationalFact:LEGAL_CASES_ACTIVE"],
  },
  {
    id: "g3",
    code: "AUDIT_MAJOR_OPEN",
    category: "governance",
    requiredInputs: ["operationalFact:AUDIT_MAJOR_OPEN"],
  },
  {
    id: "g4",
    code: "AUDIT_CLOSED_PCT",
    category: "governance",
    requiredInputs: ["operationalFact:AUDIT_CLOSED_PCT"],
  },
]

const FINANCIAL_INDICATORS = [
  {
    id: "f1",
    code: "GROSS_MARGIN",
    category: "operational",
    requiredInputs: ["budgetLine.revenue", "budgetLine.cogs"],
  },
  {
    id: "f2",
    code: "DEBT_COVERAGE",
    category: "operational",
    requiredInputs: ["budgetLine.ebitda"],
  },
]

/** A constant — the 11.66 exclusion. Kept in the fixtures so the two rules are
 *  always exercised together and neither can quietly swallow the other. */
const CONSTANT_INDICATOR = {
  id: "k1",
  code: "IND_GOV_CLIMATE_SCORE",
  category: "esg",
  requiredInputs: [] as string[],
}

const ALL_INDICATORS = [
  ...FINANCIAL_INDICATORS,
  ...GOVERNANCE_INDICATORS,
  CONSTANT_INDICATOR,
]

function cell(
  companyId: string,
  indicatorId: string,
  status: HeatMapCell["status"],
): HeatMapCell {
  return { companyId, indicatorId, value: 1, status }
}

describe("the rule — governance is informational, not financial", () => {
  it("drops the four governance indicators from the composite", () => {
    for (const ind of GOVERNANCE_INDICATORS) {
      expect(countsTowardComposite(ind)).toBe(false)
    }
  })

  it("cannot be expressed as provenance — all four ARE client data", () => {
    // If someone ever "simplifies" this back into `indicatorProvenance`, this
    // is the fact that breaks it: the four read operational facts the client
    // supplied, so the provenance taxonomy correctly calls them client-data and
    // would keep every one of them in the score.
    for (const ind of GOVERNANCE_INDICATORS) {
      expect(indicatorProvenance(ind)).toBe("client-data")
    }
  })

  it("leaves financial indicators and external feeds scoring", () => {
    for (const ind of FINANCIAL_INDICATORS) {
      expect(countsTowardComposite(ind)).toBe(true)
    }
    // A sugar price is a real measurement of real risk — 11.66's rule stands.
    expect(
      countsTowardComposite({
        category: "commodity",
        requiredInputs: ["commodityPrice:sugar_no11"],
      }),
    ).toBe(true)
  })

  it("still drops constants (11.66 rule survives the 11.71 addition)", () => {
    expect(countsTowardComposite(CONSTANT_INDICATOR)).toBe(false)
  })

  it("defaults to SCORING when the category was not projected", () => {
    // The module's hard rule: unknown/absent data takes the option that changes
    // nothing. A call site that forgets to thread `category` must under-exclude
    // (a slightly diluted score) rather than blank scores it never meant to.
    expect(isNonScoringCategory(undefined)).toBe(false)
    expect(isNonScoringCategory(null)).toBe(false)
    expect(countsTowardComposite({ requiredInputs: ["budgetLine"] })).toBe(true)
    expect(countsTowardComposite({})).toBe(true)
  })

  it("is not case- or whitespace-fuzzy — only the exact category matches", () => {
    expect(isNonScoringCategory("governance")).toBe(true)
    expect(isNonScoringCategory("Governance")).toBe(false)
    expect(isNonScoringCategory("governance_extra")).toBe(false)
  })
})

describe("composite arithmetic — the chokepoint enforces it", () => {
  it("a company whose only non-financial cells are governance scores as if they did not exist", () => {
    // AZSEKER-EDEN shape: two healthy financial indicators, and a court
    // register that lit every governance cell red. Before 11.71 the red legal
    // cells halved a perfectly solvent company's score.
    const cells = markNonScoringCells(
      [
        cell("eden", "f1", "green"),
        cell("eden", "f2", "green"),
        cell("eden", "g1", "red"),
        cell("eden", "g2", "red"),
        cell("eden", "g3", "red"),
        cell("eden", "g4", "red"),
      ],
      ALL_INDICATORS,
    )
    const out = computeCompositeScore(cells)
    // Two greens only. Without the rule this is round(200/6) = 33 — a red band.
    expect(out.score).toBe(100)
    expect(out.band).toBe("green")
    expect(out.contributingCount).toBe(2)
    // Coverage: the four leave the denominator too — see the dedicated
    // describe() below for why that is the deliberate choice.
    expect(out.totalCount).toBe(2)
  })

  it("a company with a MIX keeps every financial cell, including the bad ones", () => {
    // The rule must not become "drop the inconvenient cells": a red margin is
    // still a red margin. Only the legal ones leave.
    const cells = markNonScoringCells(
      [
        cell("cpc", "f1", "green"), // margin healthy
        cell("cpc", "f2", "red"), // debt coverage broken
        cell("cpc", "g2", "red"), // active court cases
        cell("cpc", "k1", "amber"), // the constant
      ],
      ALL_INDICATORS,
    )
    const out = computeCompositeScore(cells)
    expect(out.score).toBe(50) // (100 + 0) / 2
    expect(out.band).toBe("amber")
    expect(out.contributingCount).toBe(2)
    expect(out.totalCount).toBe(2)
  })

  it("a company with NOTHING but governance cells has no financial score at all", () => {
    // Honest answer for a sub-co where the only data ever imported is a court
    // register: "no score", not a score manufactured out of legal facts.
    const cells = markNonScoringCells(
      [cell("shell", "g1", "green"), cell("shell", "g2", "green")],
      ALL_INDICATORS,
    )
    const out = computeCompositeScore(cells)
    expect(out.score).toBeNull()
    expect(out.band).toBe("unknown")
    expect(out.contributingCount).toBe(0)
    expect(out.totalCount).toBe(0)
  })

  it("governance status colour is irrelevant — green legal cells lift nothing", () => {
    // Symmetry check. If only the reds were dropped this would pass at 100 for
    // the wrong reason; a company with clean courts must not be rewarded on the
    // financial axis either.
    const base = [cell("x", "f1", "red")]
    const withGreenLegal = markNonScoringCells(
      [...base, cell("x", "g1", "green"), cell("x", "g4", "green")],
      ALL_INDICATORS,
    )
    expect(computeCompositeScore(withGreenLegal).score).toBe(
      computeCompositeScore(base).score,
    )
    expect(computeCompositeScore(withGreenLegal).score).toBe(0)
  })

  it("weights do not smuggle governance back in", () => {
    // A weighted cell still has to pass the gate first — the skip happens
    // before `weight` is read.
    const cells: HeatMapCell[] = [
      { ...cell("w", "f1", "green"), weight: 1 },
      { ...cell("w", "g2", "red"), weight: 5, scoring: false },
    ]
    expect(computeCompositeScore(cells).score).toBe(100)
  })

  it("applies per company, not per matrix", () => {
    const cells = markNonScoringCells(
      [
        cell("a", "f1", "green"),
        cell("a", "g2", "red"),
        cell("b", "f1", "red"),
        cell("b", "g2", "green"),
      ],
      ALL_INDICATORS,
    )
    const byCo = computeCompositeByCompany(cells)
    expect(byCo.get("a")?.score).toBe(100)
    expect(byCo.get("b")?.score).toBe(0)
  })

  it("an unstamped cell still scores (back-compat default changes nothing)", () => {
    // Every pre-11.71 fixture and every builder not yet taught the flag must
    // behave exactly as before. This is the guard that four HeatMap fixtures
    // paid for in 11.66.
    const cells = [cell("legacy", "f1", "green"), cell("legacy", "g2", "red")]
    expect(computeCompositeScore(cells).score).toBe(50)
    expect(computeCompositeScore(cells).totalCount).toBe(2)
  })
})

describe("coverage counts — the denominator decision", () => {
  /**
   * DECISION: `totalCount` SHRINKS when a governance cell is dropped, exactly as
   * it already does for constants.
   *
   * The reasoning differs even though the arithmetic matches, and the
   * difference is worth stating because the 11.66 comment does not cover it. A
   * constant leaves the denominator because it never COULD have scored.
   * `LEGAL_CASES_ACTIVE` is perfectly capable of measuring something — it leaves
   * because the fraction the UI renders ("5 / 104") reads as «of the indicators
   * that feed this score, how many have data». Keeping the four in the
   * denominator would describe a population of 104 that the numerator was never
   * averaged against.
   *
   * The cost is acknowledged: the four vanish from the terminal's coverage
   * metric. They stay counted where the question really IS coverage — the
   * Compliance Hub, the indicator backlog, the freshness dashboard, and the
   * matrix's own green/amber/red tallies, none of which read `totalCount`.
   *
   * The alternative — a second, differently-filtered cell list threaded into
   * `computeCompositeScore` — is how four surfaces start disagreeing again.
   */
  it("shrinks the denominator, matching what the constants rule already does", () => {
    const cells = markNonScoringCells(
      [
        cell("c", "f1", "green"),
        cell("c", "f2", "amber"),
        cell("c", "g1", "red"),
        cell("c", "g2", "red"),
        cell("c", "g3", "red"),
        cell("c", "g4", "red"),
        cell("c", "k1", "amber"),
      ],
      ALL_INDICATORS,
    )
    const out = computeCompositeScore(cells)
    expect(out.contributingCount).toBe(2)
    expect(out.totalCount).toBe(2) // 7 cells − 4 governance − 1 constant
  })

  it("marking and pre-filtering produce an identical score/coverage triple", () => {
    // The two mechanisms coexist (`excludeNonScoringCells` is still exported).
    // If they ever diverge, the terminal and the board deck print different
    // denominators for one company — the exact defect 11.66 set out to close.
    const raw = [
      cell("d", "f1", "green"),
      cell("d", "f2", "red"),
      cell("d", "g2", "amber"),
      cell("d", "k1", "amber"),
    ]
    const marked = computeCompositeScore(
      markNonScoringCells(raw, ALL_INDICATORS),
    )
    const filtered = computeCompositeScore(
      excludeNonScoringCells(raw, ALL_INDICATORS),
    )
    expect(marked).toEqual(filtered)
    expect(marked.totalCount).toBe(2)
  })
})

describe("the four stay visible and queryable — only the score changes", () => {
  it("marking keeps every cell in the list, unlike filtering", () => {
    // This is the constraint the directive did NOT ask for: nothing is hidden.
    // The heat map renders `data.cells`; if the gate removed cells, four
    // columns would go blank across the whole grid.
    const raw = [
      cell("e", "f1", "green"),
      cell("e", "g1", "red"),
      cell("e", "g2", "red"),
    ]
    const marked = markNonScoringCells(raw, ALL_INDICATORS)
    expect(marked).toHaveLength(3)
    expect(marked.map((c) => c.indicatorId).sort()).toEqual(["f1", "g1", "g2"])
    // …and their status is untouched, so the red legal cell still renders red.
    expect(marked.find((c) => c.indicatorId === "g2")?.status).toBe("red")
  })

  it("does not touch the indicator catalogue — the columns survive", () => {
    // The gate returns ids, never a filtered definition list. Column rendering,
    // the indicator search, IndicatorDetail and the exports all read the
    // catalogue, and all four must remain in it.
    const ids = nonScoringIndicatorIds(ALL_INDICATORS)
    expect(ALL_INDICATORS).toHaveLength(7)
    expect([...ids].sort()).toEqual(["g1", "g2", "g3", "g4", "k1"])
  })

  it("governance reds still count toward the red-count alert", () => {
    // «не взаимодействовать с финансовой частью» is about the SCORE. A company
    // with 5 open major audit findings is still a company the board should
    // hear about, and `company-mostly-red` counts cells, not points.
    const cells = markNonScoringCells(
      [
        cell("f", "f1", "red"),
        cell("f", "g1", "red"),
        cell("f", "g2", "red"),
        cell("f", "g3", "red"),
      ],
      ALL_INDICATORS,
    )
    const ctx: AlertContext = {
      companies: [{ id: "f", code: "AZS-F", name: "F" }],
      indicators: ALL_INDICATORS.map((i) => ({ id: i.id, code: i.code })),
      cells,
    }
    const matches = evaluateAlertRules(
      [RULE_COMPANY_MOSTLY_RED],
      ctx,
      DEFAULT_ALERT_THRESHOLDS,
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.messageParams?.redCount).toBe(4)
  })
})

describe("every surface agrees — the alert engine reads the same flag", () => {
  it("company-critical-composite scores and reports coverage on the gated set", () => {
    // The alert engine never sees an IndicatorDefinition (`AlertIndicator` is
    // `{id, code}`), which is exactly why the rule rides on the cell. The
    // message string below is persisted verbatim into `AlertEvent`, so a
    // divergence here would freeze a wrong number into the alerts history page.
    const cells = markNonScoringCells(
      [
        cell("g", "f1", "green"),
        cell("g", "g1", "red"),
        cell("g", "g2", "red"),
        cell("g", "g3", "red"),
        cell("g", "g4", "red"),
      ],
      ALL_INDICATORS,
    )
    const ctx: AlertContext = {
      companies: [{ id: "g", code: "AZS-G", name: "G" }],
      indicators: ALL_INDICATORS.map((i) => ({ id: i.id, code: i.code })),
      cells,
    }
    // Unfiltered this company scores 20/100 and would fire. Gated it is 100.
    const matches = evaluateAlertRules(
      [RULE_COMPANY_CRITICAL_COMPOSITE],
      ctx,
      DEFAULT_ALERT_THRESHOLDS,
    )
    expect(matches).toEqual([])
  })

  it("the alert message's coverage fraction matches the badge's", () => {
    const cells = markNonScoringCells(
      [
        cell("h", "f1", "red"),
        cell("h", "f2", "red"),
        cell("h", "g2", "green"),
      ],
      ALL_INDICATORS,
    )
    const ctx: AlertContext = {
      companies: [{ id: "h", code: "AZS-H", name: "H" }],
      indicators: ALL_INDICATORS.map((i) => ({ id: i.id, code: i.code })),
      cells,
    }
    const matches = evaluateAlertRules(
      [RULE_COMPANY_CRITICAL_COMPOSITE],
      ctx,
      DEFAULT_ALERT_THRESHOLDS,
    )
    expect(matches).toHaveLength(1)
    // Same triple the HeatMap row header renders for this company.
    const badge = computeCompositeScore(cells)
    expect(matches[0]?.message).toBe(
      `AZS-H composite score ${badge.score}/100 (${badge.contributingCount}/${badge.totalCount} indicators)`,
    )
    expect(matches[0]?.message).toContain("(2/2 indicators)")
  })
})

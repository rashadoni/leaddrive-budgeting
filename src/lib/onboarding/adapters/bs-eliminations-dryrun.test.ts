// @vitest-environment node
/**
 * Dry-run: the intragroup-eliminations block, against the REAL client workbook.
 *
 * The fixture tests fix the rules; this one fixes the numbers, and the numbers
 * are what make the rules trustworthy. Three of them were written down
 * independently before this parser existed — two by hand in the Defect 3
 * investigation on 2026-08-01, one by the client — and the parser has to
 * reproduce all three from the file:
 *
 *   un-eliminated assets 2026-05      373,152,064     (the sum on screen)
 *   eliminated at 2026-05            −123,200,854.11  (Defect 3's "counted twice")
 *   consolidated assets 2026-05       249,951,210     (Defect 3's "official")
 *
 * plus the one the file supplies on its own: `BS.01.01.05` Equity Investments
 * reads 119,952,167.62 across AZSF and EDEN, the eliminations remove
 * 118,444,167.62, and the consolidated line lands on exactly 1,508,000.00.
 *
 * The workbook is client data and is not in the repository, so this skips when
 * it is absent. Point `PLF_DRYRUN_WORKBOOK` at a copy to run it:
 *
 *   PLF_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run bs-eliminations-dryrun
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { applyBuColumnSplit, splitByBuColumn } from "../ai-import/bu-column-split"
import { buildEntityAliasMap } from "../ai-import/entity-inference"
import { parseEliminationBlock } from "./bs-eliminations"
import { parseWorkbookBsSheet } from "./azseker-workbook-bs"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)

const SHEET = "BS Actual 2026"
/** Half a qəpik — the tolerance the reconciliation layer already uses. */
const TOL = 0.005

const ALIAS_MAP = buildEntityAliasMap(
  ["AZSEKER", "AZSEKER-EDEN", "AZSEKER-CPC", "AZSEKER-PROMALT", "AZSEKER-AZSF"],
  { AZSF: "AZSEKER-AZSF", PROMALT: "AZSEKER-PROMALT" },
)

function load() {
  const wb = XLSX.readFile(WORKBOOK)
  const split = splitByBuColumn(wb, SHEET, XLSX, ALIAS_MAP)
  return { wb, split }
}

/** Σ of one three-segment code across every entity block, for one month. */
function entityTotalForCode(
  wb: XLSX.WorkBook,
  split: ReturnType<typeof splitByBuColumn>,
  code: string,
  period: string,
): number {
  let total = 0
  for (const block of split.blocks) {
    if (!block.entityCode) continue
    const probe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(probe, block.worksheet, "B")
    const parsed = parseWorkbookBsSheet(probe, "B", XLSX, { preferYear: 2026 })
    for (const line of parsed.lines) {
      if (line.code === code) total += line.monthlyAmounts[period] ?? 0
    }
  }
  return total
}

/** Σ of one lineType across every entity block, for one month. */
function entityTotalForType(
  wb: XLSX.WorkBook,
  split: ReturnType<typeof splitByBuColumn>,
  lineType: "asset" | "liability" | "equity",
  period: string,
): number {
  let total = 0
  for (const block of split.blocks) {
    if (!block.entityCode) continue
    const probe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(probe, block.worksheet, "B")
    const parsed = parseWorkbookBsSheet(probe, "B", XLSX, { preferYear: 2026 })
    for (const line of parsed.lines) {
      if (line.lineType === lineType) total += line.monthlyAmounts[period] ?? 0
    }
  }
  return total
}

function eliminations() {
  const { wb, split } = load()
  const eje = split.blocks.find((b) => b.buValue === "EJE")
  expect(eje, "the sheet must still carry an EJE block").toBeTruthy()
  const probe = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(probe, eje!.worksheet, "EJE")
  return { wb, split, parsed: parseEliminationBlock(probe, "EJE", XLSX, { preferYear: 2026 }) }
}

describe.skipIf(!AVAILABLE)("BS eliminations — the real block", () => {
  it("is still a skipped block in the splitter (nothing else claims it)", () => {
    const { split } = load()
    const eje = split.blocks.find((b) => b.buValue === "EJE")
    expect(eje?.entityCode).toBeNull()
    expect(eje?.skipReason).toBe("elimination")
  })

  it("parses, and balances to zero in every month of the year", () => {
    // Not a tolerance being generous: measured, the residual is 0.000000 in
    // all five months. If a future file drifts, the block is refused rather
    // than half-imported.
    const { parsed } = eliminations()
    expect(parsed.blocked).toBeNull()
    for (const [period, t] of Object.entries(parsed.totalsByMonth)) {
      expect(Math.abs(t.residual), `${period} residual ${t.residual}`).toBeLessThan(TOL)
    }
    expect(Object.keys(parsed.totalsByMonth)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ])
  })

  it("reproduces the 123,200,854 that Defect 3 found counted twice", () => {
    const { parsed } = eliminations()
    expect(parsed.totalsByMonth["2026-05"].assets).toBeCloseTo(-123_200_854.11, 2)
  })

  it("turns the un-eliminated sum into the client's consolidated total", () => {
    // 373,152,064 on screen − 123,200,854 intercompany = 249,951,210, the
    // figure Defect 3 called "the official" one.
    const { wb, split, parsed } = eliminations()
    const entities = entityTotalForType(wb, split, "asset", "2026-05")
    expect(entities).toBeCloseTo(373_152_064, 0)
    expect(entities + parsed.totalsByMonth["2026-05"].assets).toBeCloseTo(249_951_210, 0)
  })

  it("nets Equity Investments to a round 1,508,000", () => {
    // The strongest single piece of evidence that the fold to three segments
    // is the right level: two nine-figure numbers from different blocks of the
    // file cancel to a round number nobody could have arranged.
    const { wb, split, parsed } = eliminations()
    const entities = entityTotalForCode(wb, split, "BS.01.01.05", "2026-01")
    const elim = parsed.lines.find((l) => l.code === "BS.01.01.05")
    expect(entities).toBeCloseTo(119_952_167.62, 2)
    expect(elim?.monthlyAmounts["2026-01"]).toBeCloseTo(-118_444_167.62, 2)
    expect(entities + elim!.monthlyAmounts["2026-01"]).toBeCloseTo(1_508_000, 2)
  })

  it("consolidates January to a balance sheet that balances", () => {
    const { wb, split, parsed } = eliminations()
    const t = parsed.totalsByMonth["2026-01"]
    const assets = entityTotalForType(wb, split, "asset", "2026-01") + t.assets
    const liabilities = entityTotalForType(wb, split, "liability", "2026-01") + t.liabilities
    const equity = entityTotalForType(wb, split, "equity", "2026-01") + t.equity
    expect(assets).toBeCloseTo(245_013_084.45, 2)
    // Trial-balance convention: liabilities and equity are stored negative, so
    // a consolidated statement sums to zero.
    expect(Math.abs(assets + liabilities + equity)).toBeLessThan(2)
  })

  it("posts every folded code onto a line the entity blocks already use", () => {
    // A fold onto a code no entity posts would net against nothing, which is
    // the failure mode that would look correct in the totals and wrong on
    // every line of the statement.
    const { wb, split, parsed } = eliminations()
    const entityCodes = new Set<string>()
    for (const block of split.blocks) {
      if (!block.entityCode) continue
      const probe = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(probe, block.worksheet, "B")
      for (const l of parseWorkbookBsSheet(probe, "B", XLSX, { preferYear: 2026 }).lines) {
        entityCodes.add(l.code)
      }
    }
    const orphans = parsed.lines
      .map((l) => l.code)
      // The uncoded deferred asset is deliberately its own line — see the
      // module header. Everything else must land somewhere real.
      .filter((c) => c !== "BS.01.01.99" && !entityCodes.has(c))
    expect(orphans).toEqual([])
  })
})

/**
 * Part 2 — the routing. The parser reading the block correctly is worth
 * nothing until `applyBuColumnSplit` actually hands it to a writer, and the
 * failure mode if it hands it to the wrong one is the whole group's −119M
 * intercompany reversal landing on a single company.
 */
describe.skipIf(!AVAILABLE)("BS eliminations — routing on the real workbook", () => {
  function routed() {
    const wb = XLSX.readFile(WORKBOOK)
    const out = applyBuColumnSplit(wb, XLSX, {
      sheetName: SHEET,
      dataType: "BS",
      planKind: "actual",
      aliasMap: ALIAS_MAP,
    })
    return { wb, out }
  }

  it("gives the EJE block its own sheet, typed BS_ELIMINATIONS and entity-less", () => {
    const { out } = routed()
    const elim = out.sheetMapEntries.filter((e) => e.dataType === "BS_ELIMINATIONS")
    expect(elim).toHaveLength(1)
    expect(elim[0].match).toBe(`${SHEET} [ELIMINATIONS]`)
    expect(elim[0].planKind).toBe("actual")
    // The load-bearing assertion. An entityCode here — even a plausible one —
    // is the whole group's reversal on one company.
    expect(elim[0].entityCode).toBeUndefined()
  })

  it("still routes all four entities, unchanged", () => {
    const { out } = routed()
    const entities = out.sheetMapEntries
      .filter((e) => e.dataType === "BS")
      .map((e) => e.entityCode)
      .sort()
    expect(entities).toEqual([
      "AZSEKER-AZSF",
      "AZSEKER-CPC",
      "AZSEKER-EDEN",
      "AZSEKER-PROMALT",
    ])
  })

  it("reports the block as a write, once, not as a skip", () => {
    // It was listed as "skipped (not imported)" for as long as it existed.
    // Reporting it twice — a write in one pass and a drop in another — would
    // be its own kind of wrong.
    const { out } = routed()
    const eje = out.mapping.filter((m) => m.buValue === "EJE")
    expect(eje).toHaveLength(1)
    expect(eje[0].action).toBe("write")
    expect(eje[0].entityCode).toBeNull()
    expect(out.warnings.join("\n")).toMatch(/belonging to no company/)
    expect(out.warnings.join("\n")).not.toMatch(/looks like elimination.*skipped/)
  })

  it("the materialised sheet parses back to the same numbers", () => {
    // End to end: split → the sheet the writer will actually be handed →
    // parser. Guards against the virtual worksheet losing the month header or
    // the block's first row in the slicing.
    const { wb, out } = routed()
    const name = `${SHEET} [ELIMINATIONS]`
    expect(out.applied).toBe(true)
    expect(wb.SheetNames).toContain(name)
    const parsed = parseEliminationBlock(wb, name, XLSX, { preferYear: 2026 })
    expect(parsed.blocked).toBeNull()
    expect(parsed.totalsByMonth["2026-05"].assets).toBeCloseTo(-123_200_854.11, 2)
    expect(Math.abs(parsed.totalsByMonth["2026-01"].residual)).toBeLessThan(TOL)
  })

  it("a P&L sheet's EJE block is still skipped, not imported", () => {
    // 11.83 settled the ADJUSTMENT half of the P&L question and deliberately
    // left the elimination half alone. This must not have quietly changed it.
    const wb = XLSX.readFile(WORKBOOK)
    const out = applyBuColumnSplit(wb, XLSX, {
      sheetName: "PLF Actual 2026",
      dataType: "PLF",
      planKind: "actual",
      aliasMap: ALIAS_MAP,
    })
    expect(
      out.sheetMapEntries.some((e) => e.dataType === "BS_ELIMINATIONS"),
      "a PLF sheet must never produce a balance-sheet eliminations sheet",
    ).toBe(false)
    for (const m of out.mapping.filter((x) => x.reason === "elimination")) {
      expect(m.action).toBe("skip")
    }
  })
})

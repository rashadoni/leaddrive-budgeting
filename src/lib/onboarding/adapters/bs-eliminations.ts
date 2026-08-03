/**
 * Phase 14.8 (2026-08-03) — the intragroup eliminations the client ships and
 * the product throws away.
 *
 * ## What is missing today
 *
 * `BS Actual 2026` is five stacked blocks, self-labelled by the `BU` column:
 * AZSF, EDEN, CPC, ProMalt — and `EJE`, the client's own INTRAGROUP
 * ELIMINATIONS. The BU splitter imports the four entities and drops EJE with a
 * warning that says, correctly, that an elimination belongs to no single
 * entity. What follows from dropping it is that the product has no
 * consolidated balance sheet at all: every group figure it can show is the
 * four entities added together, and the tab, the AI panel and the export all
 * say so because none of them can do better.
 *
 * Measured on the file, January 2026:
 *
 *     four entities, assets            364,080,013.37
 *     eliminations, assets            −119,066,928.92
 *     ──────────────────────────────────────────────
 *     consolidated assets              245,013,084.45
 *
 * and at 2026-05 the elimination is −123,200,854.11 against an un-eliminated
 * 373,152,064 — i.e. exactly the "123,200,854 counted twice" and the
 * "consolidated 249,951,210" that `balance-sheet/route.ts` names in its Defect
 * 3 comment. Two numbers written down by hand on 2026-08-01, reproduced here
 * to the qəpik from the file itself, by a different route.
 *
 * ## Why the existing BS parser cannot read this block
 *
 * Three reasons, and the first one is the expensive one:
 *
 *  1. **The elimination block is coded one level deeper than the statement.**
 *     Entity blocks post at three segments (`BS.01.01.05` "Equity
 *     Investments"); eliminations post at four (`BS.01.01.05.03` "Investments
 *     in Joint Ventures (ProMalt Investment)"). `LEAF_BS_RE` accepts three
 *     only, so the named parser would silently keep the five three-segment
 *     equity reversals (+104,921,229.13) and drop every four-segment asset and
 *     liability line (−118,444,167.62 and +14,145,699.79). That is not a
 *     partial import, it is an unbalanced one: it would move group equity by
 *     105M with no matching asset movement and leave A ≠ L + E by 119M, at
 *     which point `normalizeBalanceSheetMonth` refuses to publish liabilities
 *     and equity at all. The group view would be strictly WORSE than the
 *     honest un-eliminated sum it replaced.
 *
 *  2. **One line has no code at all.** Row 967 is `---` /
 *     "Deferred Asset on Business Combination", +13,525,826.73, the entry that
 *     offsets removing the QTA investment. Drop it and the block misses
 *     balance by exactly that amount.
 *
 *  3. **Nothing checks that the block balances.** For an entity block that
 *     check is redundant — the client's own sheet balances. For an
 *     elimination it is the only guard there is, because a half-read
 *     elimination looks exactly like a complete one.
 *
 * ## The rules this encodes
 *
 * **Post four-segment codes to their three-segment parent.** All eleven
 * distinct truncations were checked against the entity chart on this file and
 * every one already exists there, so the elimination lands on the same line
 * the entities do and nets on screen: `BS.01.01.05` reads 119,952,167.62
 * across AZSF and EDEN, the eliminations remove 118,444,167.62, and Equity
 * Investments consolidates to **1,508,000.00** — a round number, which is the
 * kind of evidence you cannot arrange by accident.
 *
 * **The uncoded line is classified from its label, and only from a table.**
 * Its side cannot be derived: the block balances whether that 13,525,826.73 is
 * a positive asset or a positive liability, because it is a single unpaired
 * entry. Arithmetic is silent, so the word "Asset" in the client's own label is
 * the evidence, and the mapping is written down here rather than inferred.
 * Anything else uncoded and non-zero BLOCKS rather than being guessed at.
 *
 * **Its own line, not somebody else's.** The label names the top-level class
 * (an asset) and not the sub-line, so it is posted to a dedicated
 * `BS.01.01.99` rather than merged into whichever non-current asset looks
 * closest. Merging would misstate a real line by 13.5M to avoid showing an
 * unfamiliar one.
 *
 * **Balance or nothing.** If any month's A + L + E misses zero by more than a
 * manat, the whole block is refused with the residual named. Partial
 * eliminations are the one outcome worse than none.
 *
 * Pure: no DB, no LLM, no workbook mutation.
 */
import type * as XLSX from "xlsx"
import { numericCellValue } from "../numeric-cell"
import {
  classifyBsLineType,
  findBsLayout,
  type BsLineType,
  type BsSubType,
} from "./azseker-workbook-bs"

/**
 * A BU label that names an INTRAGROUP ELIMINATION specifically.
 *
 * Strictly narrower than `isEliminationLikeEntityValue`, and the difference is
 * the whole point. That predicate answers "is this not a company?", so it
 * matches `CONSOLIDATED` and `CONSOL` too — and a CONSOLIDATED block is the
 * group's TOTALS, the arithmetic opposite of an elimination. Importing one as
 * eliminations would add a second full balance sheet to the sum instead of
 * subtracting the intercompany balances.
 *
 * The balance gate below cannot catch that: a consolidated balance sheet
 * balances to zero exactly as an elimination block does, so `A + L + E = 0`
 * says yes to both. This list is the only guard there is, which is why it is a
 * closed enumeration rather than a loosening of the existing regex.
 *
 * `AJE` and the rest of the adjustment subset are absent by construction — the
 * splitter classifies those as `adjustment` and folds them into the entity
 * their parent BU column names (11.83), which is a different answer to a
 * different question.
 */
const INTRAGROUP_ELIMINATION_BU_RE =
  /^(EJE|ELIM|ELIMINATION|ELIMINATIONS|ELIMINASIYA|INTERCOMPANY|INTRAGROUP|INTRA-GROUP|IC ELIM|IC ELIMINATION)$/i

/**
 * True only for a BU label that names an intragroup-elimination block.
 *
 * Matched WHOLE, not as a substring: a company legitimately called
 * "Intergroup Trading LLC" must stay a company.
 */
export function isIntragroupEliminationBuValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  return INTRAGROUP_ELIMINATION_BU_RE.test(String(value).trim().replace(/\s+/g, " "))
}

/**
 * Three or four numeric segments. A fourth segment is detail BELOW the level
 * the statement is imported at and is posted to its three-segment parent.
 */
const BS_CODE_RE = /^BS\.(\d{2})\.(\d{2})\.(\d{1,2})(?:\.(\d{1,2}))?$/

/**
 * Rows the client leaves uncoded, keyed by lower-cased label.
 *
 * Deliberately a closed table and not a matcher. An elimination line carries
 * six or seven figures; the cost of quietly filing one under the wrong class
 * is a group balance sheet that is wrong and balanced, which nothing
 * downstream can detect. A new uncoded label blocks the import and gets read
 * by a person.
 */
const UNCODED_ELIMINATION_LABELS: Record<
  string,
  { code: string; name: string; lineType: BsLineType; subType: BsSubType }
> = {
  "deferred asset on business combination": {
    // Not merged into an existing non-current asset: the label states the
    // class, not the line. See the header note.
    code: "BS.01.01.99",
    name: "Deferred Asset on Business Combination (consolidation)",
    lineType: "asset",
    subType: "non_current",
  },
}

/**
 * How far a month's A + L + E may miss zero before the block is refused.
 *
 * One manat, against a block whose absolute magnitude is ~250M — i.e. 4e-9 of
 * it. Measured on `BS Actual 2026`, every month's residual is 0.000000
 * exactly, so this is headroom for float accumulation over ~20 rows and
 * nothing else. It is deliberately NOT a percentage: a proportional tolerance
 * on a nine-figure block would swallow a six-figure omission.
 */
export const ELIMINATION_BALANCE_TOLERANCE_AZN = 1

export interface ParsedEliminationLine {
  /** Three-segment chart code the amount is posted to. */
  code: string
  /** Display name for the chart account. */
  name: string
  lineType: BsLineType
  subType: BsSubType
  /** Sparse `{ "2026-01": -9228024.5, … }`. */
  monthlyAmounts: Record<string, number>
  /**
   * Every code as written in the file that folded into `code`, and the labels
   * beside them — so a reviewer can see that "Equity Investments" moved
   * because of five named intercompany holdings, not one anonymous figure.
   */
  sources: Array<{ sourceCode: string | null; label: string }>
}

export interface EliminationParseResult {
  sheetName: string
  year: number | null
  lines: ParsedEliminationLine[]
  /** `{ "2026-01": { assets, liabilities, equity, residual } }`. */
  totalsByMonth: Record<
    string,
    { assets: number; liabilities: number; equity: number; residual: number }
  >
  warnings: string[]
  /**
   * Non-null when the block must NOT be written. An elimination that is read
   * in part unbalances a group that was at least honestly un-eliminated
   * before, so refusing is the conservative direction here.
   */
  blocked: string | null
}

const empty = (sheetName: string, blocked: string | null, warnings: string[] = []): EliminationParseResult => ({
  sheetName,
  year: null,
  lines: [],
  totalsByMonth: {},
  warnings,
  blocked,
})

/**
 * Parse an intragroup-eliminations block into chart-coded lines.
 *
 * `sheetName` is expected to be the virtual per-block worksheet the BU
 * splitter materialises (preamble + the EJE rows), so the month header is
 * present and the caller does not have to re-derive the block boundaries.
 */
export function parseEliminationBlock(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number },
): EliminationParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return empty(sheetName, `Sheet "${sheetName}" not found in workbook`)
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  const layout = findBsLayout(aoa, opts.preferYear)
  if (!layout) {
    // Not a block failure — a sheet with no columns for this year is a
    // legitimate skip, the same contract the entity parser follows.
    return empty(sheetName, null, [
      `Eliminations: no ${opts.preferYear} monthly date columns on "${sheetName}" — nothing to import`,
    ])
  }
  const monthKeys = Object.keys(layout.monthColsForYear).sort()

  const warnings: string[] = []
  const byCode = new Map<string, ParsedEliminationLine>()
  const totals: EliminationParseResult["totalsByMonth"] = {}
  for (const key of monthKeys) {
    totals[key] = { assets: 0, liabilities: 0, equity: 0, residual: 0 }
  }
  /**
   * Months an accepted line actually posts to.
   *
   * The header declares all twelve columns of the year whether or not the
   * balance sheet has reached them — `BS Actual 2026` carries Jan–Dec headers
   * over five months of data. Reporting `2026-09: { assets: 0 }` would hand a
   * consumer a zero where the truth is "no balance sheet exists for that
   * month", which is the same 0-versus-absent confusion that made the AI panel
   * announce an empty balance sheet next to a 364M table.
   */
  const monthsWithData = new Set<string>()

  const unmapped: Array<{ row: number; raw: string; label: string; magnitude: number }> = []

  for (let r = layout.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const rawCode = typeof row[0] === "string" ? row[0].trim() : ""
    const label = typeof row[1] === "string" ? row[1].trim() : ""

    const amounts: Record<string, number> = {}
    let magnitude = 0
    for (const key of monthKeys) {
      const v = numericCellValue(row[layout.monthColsForYear[key]])
      if (v === null || !Number.isFinite(v) || v === 0) continue
      amounts[key] = v
      magnitude += Math.abs(v)
    }

    const m = BS_CODE_RE.exec(rawCode)
    let target: { code: string; name: string; lineType: BsLineType; subType: BsSubType } | null =
      null

    if (m) {
      // Fourth segment is detail below the imported level — fold to the parent.
      const code = `BS.${m[1]}.${m[2]}.${m[3]}`
      const { lineType, subType } = classifyBsLineType(code)
      if (lineType) target = { code, name: label || code, lineType, subType }
    } else if (label) {
      const known = UNCODED_ELIMINATION_LABELS[label.toLowerCase()]
      if (known) target = known
    }

    if (!target) {
      // A subtotal row (`BS.01`, `BS.02`) or an empty spacer carries no new
      // information — the block's own subtotals are recomputed here. Only an
      // unrecognised row that actually MOVES money is a problem.
      if (magnitude > 0 && !/^BS\.\d{2}$/.test(rawCode)) {
        unmapped.push({ row: r + 1, raw: rawCode, label, magnitude })
      }
      continue
    }

    if (magnitude === 0) continue

    const existing = byCode.get(target.code)
    const line: ParsedEliminationLine = existing ?? {
      code: target.code,
      name: target.name,
      lineType: target.lineType,
      subType: target.subType,
      monthlyAmounts: {},
      sources: [],
    }
    for (const [key, v] of Object.entries(amounts)) {
      line.monthlyAmounts[key] = (line.monthlyAmounts[key] ?? 0) + v
      const bucket = totals[key]
      if (!bucket) continue
      monthsWithData.add(key)
      if (line.lineType === "asset") bucket.assets += v
      else if (line.lineType === "liability") bucket.liabilities += v
      else bucket.equity += v
    }
    line.sources.push({ sourceCode: m ? rawCode : null, label })
    byCode.set(target.code, line)
  }

  for (const key of monthKeys) {
    if (!monthsWithData.has(key)) {
      delete totals[key]
      continue
    }
    const t = totals[key]
    t.residual = t.assets + t.liabilities + t.equity
  }
  const dataMonths = monthKeys.filter((k) => monthsWithData.has(k))

  if (unmapped.length > 0) {
    const worst = [...unmapped].sort((a, b) => b.magnitude - a.magnitude)[0]
    return empty(
      sheetName,
      `eliminations block on "${sheetName}" has ${unmapped.length} line(s) that carry money and no usable chart code — ` +
        `the largest is row ${worst.row} "${worst.label || worst.raw}" ` +
        `(${worst.magnitude.toLocaleString("en-US", { maximumFractionDigits: 0 })} by absolute value). ` +
        `Importing part of an elimination unbalances the group; refusing until it is coded or added to the uncoded-label table.`,
      warnings,
    )
  }

  const lines = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
  if (lines.length === 0) {
    return empty(sheetName, null, [
      `Eliminations: block on "${sheetName}" has no ${opts.preferYear} amounts — nothing to import`,
    ])
  }

  const offenders = dataMonths.filter(
    (k) => Math.abs(totals[k].residual) > ELIMINATION_BALANCE_TOLERANCE_AZN,
  )
  if (offenders.length > 0) {
    const worst = offenders
      .map((k) => ({ k, r: totals[k].residual }))
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0]
    return empty(
      sheetName,
      `eliminations block on "${sheetName}" does not balance: ${offenders.length} month(s) miss A + L + E = 0, ` +
        `worst ${worst.k} by ${worst.r.toFixed(2)}. An elimination read in part is worse than none — ` +
        `it unbalances a group total that was at least honestly un-eliminated. Not imported.`,
      warnings,
    )
  }

  const uncoded = lines.filter((l) => l.sources.some((s) => s.sourceCode === null))
  for (const l of uncoded) {
    warnings.push(
      `Eliminations: "${l.sources.find((s) => s.sourceCode === null)?.label}" carries no chart code in the ` +
        `workbook and was classified as ${l.lineType} from its label, on its own line ${l.code}. ` +
        `The block balances either way — the label is the only evidence for the side.`,
    )
  }

  return {
    sheetName,
    year: layout.year,
    lines,
    totalsByMonth: totals,
    warnings,
    blocked: null,
  }
}

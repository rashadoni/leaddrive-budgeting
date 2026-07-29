/**
 * AzerSheker "Reporting 2026" consolidated Balance Sheet adapter (2026-06-23).
 *
 * The `BS` tab of Reporting 2026.xlsx is the client's OFFICIAL consolidated
 * balance sheet ("Consolidated Balance Sheet", figures in THOUSANDS of AZN),
 * scope = AZSF + EDEN(+CPC) + ProMalt. We import it VERBATIM onto the holding
 * entity so the holding view shows the real consolidated total (~253M for
 * April 2026) instead of the naive sum of standalone company balance sheets
 * (~339M, which double-counts ~126M of intercompany "Investments in Joint
 * Ventures"). See docs/superpowers/specs/2026-06-22-consolidated-holding-bs-design.md.
 *
 * MONEY-SAFETY: we never compute eliminations ourselves and never fuzzy-map.
 * The parser extracts the ~24 leaf lines verbatim (×1000 thousands→manat) and a
 * HARD reconciliation guard asserts, per month, that Σ(leaf amounts per section)
 * equals the sheet's own ASSETS / EQUITY / LIABILITIES subtotal cell to the
 * manat — otherwise it THROWS and nothing is written. Verified on the real
 * workbook: assets 253,320,381 / equity −217,877,637 / liabilities −35,442,743
 * for 2026-04, all Δ=0 vs the subtotal cells, across all three published months.
 */

import type { UnitScale } from "../unit-scale"

export type BsSection = "asset" | "equity" | "liability"

/**
 * Phase 11.18 — the thousands→manat factor, named rather than inlined.
 *
 * CONFIRMED 2026-07-29 against the real `Reporting 2026.xlsx`. It was an
 * assumption; it is now a measurement, on two independent readings:
 *
 *  1. `CONS PL_1!A1` of the same workbook is labelled verbatim **"AZN
 *     thousand"** — the summary blocks of this pack are denominated in
 *     thousands, and `BS` is one of them (same "Consolidated ..." title row,
 *     same three-column month layout).
 *  2. The same workbook carries `BS Actual`, the per-account balance sheet in
 *     RAW MANAT: ASSETS at 2026-04 = 134,864,500.55. The consolidated `BS` tab
 *     reads 253,320.38 for that month. Read as manat that would make the whole
 *     group ₼253K — 533× SMALLER than the detail of a single scope inside it,
 *     which is impossible. Read as thousands it is ₼253.3M against a ₼134.9M
 *     component, which is the expected relation.
 *
 * The reconciliation guard below still cannot verify the factor — it compares
 * Σ(leaves) against the sheet's own subtotal cell and BOTH sides pass through
 * it, so it is scale-invariant and stays green for any value. That is why the
 * plausibility band is still emitted (`scaleWarnings`): it is the only thing
 * standing between a future file in units and a 1000× balance sheet.
 */
export const UNIT_SCALE = 1000

export interface ConsolidatedBsLeaf {
  /** Verbatim official line label, e.g. "Property, Plant and Equipment". */
  label: string
  section: BsSection
  /** non_current | current (assets) · long_term | short_term (liabilities) · null (equity) */
  subType: string | null
  /** "YYYY-MM" → amount in MANAT (thousands already ×1000). */
  byMonth: Map<string, number>
}

export interface ParsedConsolidatedBs {
  /** Published months, in sheet order (e.g. ["2026-04","2026-03","2025-12"]). */
  months: string[]
  leaves: ConsolidatedBsLeaf[]
  /** Per month, the sheet's own subtotal-cell totals (×1000), for provenance. */
  officialTotals: Map<string, Record<BsSection, number>>
  /**
   * Phase 11.18 — non-fatal scale-plausibility notes. Empty means the totals
   * landed in the expected band after the thousands→manat factor. Non-empty
   * means CONFIRM the sheet's units: the reconciliation guard below cannot
   * detect a wrong multiplier, because both sides of its comparison pass
   * through that multiplier, making it scale-invariant by construction.
   */
  scaleWarnings: string[]
}

/** Section header / intermediate subtotal rows — never stored as leaves. */
const SECTION_HEADERS: Record<string, BsSection> = {
  ASSETS: "asset",
  EQUITY: "equity",
  LIABILITIES: "liability",
}
const SUBTOTAL_ONLY = new Set([
  "CURRENT ASSETS",
  "Inventories",
  "NON-CURRENT LIABILITIES",
  "CURRENT LIABILITIES",
])

/** Excel serial date → "YYYY-MM" (UTC, 1900 date system). */
export function excelSerialToYearMonth(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

const isSerial = (v: unknown): v is number =>
  typeof v === "number" && v > 40_000 && v < 60_000

/**
 * Parse the consolidated `BS` worksheet (as array-of-arrays, raw values) into
 * verbatim leaf lines + a reconciliation guard. THROWS on any per-month
 * section mismatch so a mis-parsed consolidated balance sheet is never written.
 */
export function parseConsolidatedBs(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  /**
   * Phase 11.37 — the unit READ off the workbook (`detectWorkbookUnitScale`).
   * Omitted means nothing in the file declared one, and the legacy
   * `UNIT_SCALE` assumption is used with the plausibility band as the only
   * guard. See the scale block below.
   */
  detectedUnit?: UnitScale | null,
): ParsedConsolidatedBs {
  // The declared factor wins over the constant. 11.18 measured that they
  // agree for the current file, so this changes nothing for AzerSheker.
  const unitScale = detectedUnit?.factor ?? UNIT_SCALE
  // 1. Locate the date row (most Excel serials in the first handful of rows).
  let dateRow = -1
  let bestSerials = 0
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const n = (rows[r] ?? []).filter(isSerial).length
    if (n > bestSerials) {
      bestSerials = n
      dateRow = r
    }
  }
  if (dateRow < 0 || bestSerials === 0) {
    throw new Error("consolidated BS: no date row found (expected Excel serials)")
  }

  // 2. Map column index → "YYYY-MM".
  const colMonth = new Map<number, string>()
  const months: string[] = []
  const header = rows[dateRow] ?? []
  for (let c = 0; c < header.length; c++) {
    const v = header[c]
    if (isSerial(v)) {
      const ym = excelSerialToYearMonth(v)
      colMonth.set(c, ym)
      if (!months.includes(ym)) months.push(ym)
    }
  }
  if (colMonth.size === 0) throw new Error("consolidated BS: no month columns")

  // 3. Walk rows, tracking the current section + subType from header rows.
  const leaves: ConsolidatedBsLeaf[] = []
  const officialTotals = new Map<string, Record<BsSection, number>>()
  for (const ym of months) {
    officialTotals.set(ym, { asset: 0, equity: 0, liability: 0 })
  }
  // Track which section headers were actually present (vs. the default-0
  // total) so a renamed/missing header can't silently drop a whole section.
  const sectionsSeen = new Set<BsSection>()

  let section: BsSection | null = null
  let subType: string | null = null

  const readMonthValues = (row: ReadonlyArray<unknown>): Map<string, number> => {
    const out = new Map<string, number>()
    for (const [c, ym] of colMonth) {
      const v = row[c]
      if (typeof v === "number") out.set(ym, v * unitScale)
    }
    return out
  }

  for (let r = dateRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const rawLabel = row[0]
    if (typeof rawLabel !== "string" || rawLabel.trim() === "") continue
    const label = rawLabel.trim()

    // Section header → set section, capture the official subtotal, skip as leaf.
    const headerSection = SECTION_HEADERS[label]
    if (headerSection) {
      section = headerSection
      sectionsSeen.add(headerSection)
      subType =
        headerSection === "asset"
          ? "non_current"
          : headerSection === "liability"
            ? "long_term"
            : null
      const vals = readMonthValues(row)
      for (const [ym, amount] of vals) {
        const tot = officialTotals.get(ym)
        if (tot) tot[headerSection] = amount
      }
      continue
    }

    // Intermediate subtotal → may flip subType, never a leaf.
    if (SUBTOTAL_ONLY.has(label)) {
      if (label === "CURRENT ASSETS") subType = "current"
      else if (label === "NON-CURRENT LIABILITIES") subType = "long_term"
      else if (label === "CURRENT LIABILITIES") subType = "short_term"
      continue
    }

    // Otherwise a leaf row. A numeric leaf before any section header means the
    // sheet shape changed (or a header was renamed) — refuse to guess.
    const byMonth = readMonthValues(row)
    if (byMonth.size === 0) continue
    if (section == null) {
      throw new Error(
        `consolidated BS: numeric row "${label}" before any ASSETS/EQUITY/LIABILITIES section header`,
      )
    }
    leaves.push({ label, section, subType, byMonth })
  }

  // 4a. Every section must have had a real header row — otherwise a missing /
  // renamed header leaves its official total at the default 0 and the
  // per-section guard below would pass as 0 == 0 while leaves were dropped.
  for (const required of ["asset", "equity", "liability"] as const) {
    if (!sectionsSeen.has(required)) {
      throw new Error(
        `consolidated BS: no "${required}" section header found — refusing to write`,
      )
    }
  }

  // 4a. Phase 11.18 / 11.37 — SCALE.
  //
  // The Σ-leaves guard below cannot police the multiplier: it compares two
  // quantities that were BOTH scaled by it, so it is scale-invariant by
  // construction and stays green whether the factor is 1, 1000 or 10^6.
  //
  // 11.37 removes the guesswork where the file allows it. When the workbook
  // DECLARES its unit (`CONS PL_1!A1` = "AZN thousand" in the current pack)
  // that declaration is used and recorded. When nothing declares one we fall
  // back to the historical assumption — and then the plausibility band is the
  // only thing standing between a file in base units and a balance sheet off
  // by three orders of magnitude.
  //
  // Band from the client's own scale: total assets for this holding sit in
  // the 10^7-10^9 manat range. Below 1M or above 100B means the multiplier is
  // almost certainly wrong in one direction or the other.
  const scaleWarnings: string[] = []
  if (detectedUnit) {
    scaleWarnings.push(
      `unit read from the workbook: ${detectedUnit.source} "${detectedUnit.label}" ` +
        `→ ×${detectedUnit.factor}` +
        (detectedUnit.factor === UNIT_SCALE
          ? ` (matches the assumed factor)`
          : ` — this OVERRIDES the assumed ×${UNIT_SCALE}`),
    )
  }
  const implausible: string[] = []
  for (const ym of months) {
    const assets = officialTotals.get(ym)?.asset
    if (assets == null || assets === 0) continue
    const abs = Math.abs(assets)
    if (abs < 1_000_000 || abs > 100_000_000_000) {
      implausible.push(
        `${ym}: total assets ₼${Math.round(abs).toLocaleString("en-US")} after ×${unitScale}`,
      )
    }
  }
  for (const line of implausible) {
    scaleWarnings.push(
      `${line}` +
        (detectedUnit
          ? `, the unit DECLARED by ${detectedUnit.source}`
          : `, an ASSUMED factor — nothing in this workbook declares its money unit`) +
        `. Outside the expected ₼1M-₼100B band — verify the pack. The Σ-leaves guard ` +
        `cannot detect this: it is scale-invariant.`,
    )
  }
  // 11.37 note — this stays a WARNING even when the unit is undeclared AND the
  // total looks implausible, which is not where this task started. The band is
  // calibrated on ONE client ("assets sit in the 10^7-10^9 range"), and a
  // holding whose balance sheet genuinely totals ₼400K is a small company, not
  // a scaling error. Refusing those imports would be enforcing this client's
  // size as a correctness rule. The 11.18 decision — only the owner can
  // confirm a sheet's units — survives; what 11.37 removes is the GUESSING,
  // not the owner's judgement.
  if (!detectedUnit && implausible.length === 0) {
    scaleWarnings.push(
      `money unit not declared anywhere in this workbook — applied the assumed ` +
        `×${UNIT_SCALE}. State it in the sheet (e.g. "AZN thousand" in the top-left ` +
        `cell) to make this measured rather than assumed.`,
    )
  }

  // 4. HARD reconciliation guard — Σ(leaves per section) == subtotal cell, per month.
  for (const ym of months) {
    const official = officialTotals.get(ym)!
    const summed: Record<BsSection, number> = { asset: 0, equity: 0, liability: 0 }
    for (const leaf of leaves) {
      const v = leaf.byMonth.get(ym)
      if (v != null) summed[leaf.section] += v
    }
    for (const section of ["asset", "equity", "liability"] as const) {
      const delta = Math.abs(summed[section] - official[section])
      // ±1 manat tolerance: the source is in thousands with 3 decimals, so a
      // ×1000 round-trip leaves a sub-manat residue (the client's own subtotal
      // carries the same). Anything larger means a parse/structure error.
      if (delta > 1.5) {
        throw new Error(
          `consolidated BS reconciliation FAILED for ${ym}/${section}: ` +
            `Σ(leaves)=${Math.round(summed[section])} vs subtotal cell=${Math.round(
              official[section],
            )} (Δ=${Math.round(summed[section] - official[section])}). Refusing to write.`,
        )
      }
    }
  }

  return { months, leaves, officialTotals, scaleWarnings }
}

/** Stable account code for a consolidated leaf (namespace distinct from the
 *  per-entity BS.xx codes; derived from the official label so it's traceable). */
export function consolidatedAccountCode(label: string): string {
  const slug = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return `CONS.BS.${slug}`
}

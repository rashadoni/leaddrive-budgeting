/**
 * Phase 7.M Step 7 (2026-05-19) — AzerSheker workbook sales adapter.
 *
 * Three sales sheets live in the workbook with three different shapes:
 *
 *   • "Farming Budget sales plan" — product × month tonnage. Simple
 *     wide table: col 0 = product name, cols 1-12 = monthly dates,
 *     col 13 = annual.
 *   • "Production Budget sales plan" — product × month tonnage with
 *     extra metadata (PLF category / production-step / location).
 *     Wider shape, deferred to v2.
 *   • "Satış ProMalt" — customer × month with both volume + revenue
 *     paired columns. Deferred to v2.
 *
 * v1 ships **Farming only** — it is the most reusable shape (matches
 * any "product × month" tonnage table any future client might send)
 * and exercises the Sales storage convention without the extra
 * metadata-axis complexity of Production / ProMalt.
 *
 * Section semantics (Farming sheet)
 * ─────────────────────────────────
 * The Farming Budget sales plan is split into FOUR sub-sections,
 * each introduced by a sentinel row in column A:
 *
 *   "Satış plan, Ton"     — product × month VOLUME (tonnes)
 *   "Satış plan, AZN"     — product × month REVENUE (AZN)
 *   "Satış plan, Qiymət"  — product × month PRICE (AZN per tonne)
 *   "Maya dəyəri, AZN"    — product × month COST (AZN)
 *
 * Each section repeats the same 7 product names. A naive parser
 * (Phase 7.M Step 7 v1.0, fixed below) treated all 28 rows as a
 * single metric `farm_sales_<product>_ton` and conflated their
 * values. The fix below tracks the current section and emits
 * distinct metrics per section / product:
 *
 *   farm_sales_<slug>_ton             ← Volume
 *   farm_sales_<slug>_revenue_azn     ← Revenue
 *   farm_sales_<slug>_price_azn_per_ton ← Price
 *   farm_sales_<slug>_cost_azn        ← Cost
 *
 * Output convention
 * ─────────────────
 * Each parsed cell becomes an `OperationalFact` with:
 *   • metric  = `farm_sales_<product_slug>_<section_suffix>`
 *   • date    = last day of the month (snapshot semantic, aligned
 *               with existing KPI date convention)
 *   • value   = raw cell value, no rounding
 *   • unit    = section-appropriate ("ton" / "AZN" / "AZN/ton")
 *
 * Entity attribution: Farming Sales is **EDEN-scoped** by Phase 7.K
 * inventory (EDEN owns the agro_crops industry; FARM was folded
 * into EDEN in the workbook). Caller passes `entityCode` so future
 * holdings can re-target without code change.
 *
 * Reconciliation key: `${companyId}::${metric}::${date}`. Matches
 * the existing `runKpiBatch` reconcile shape — no new wrapper.
 */
import type * as XLSX from "xlsx"
import {
  buildReconKey,
  type ReconciliationKey,
} from "../reconciliation"

export interface ParsedFarmingSalesFact {
  /** ISO `YYYY-MM-DD` — last day of the month. */
  date: string
  metric: string
  productName: string
  /** Tonnes, verbatim from cell. */
  value: number
  unit: string
  sourceCell: string
}

export interface FarmingSalesParseWarning {
  row: number
  reason: string
}

export interface FarmingSalesParseResult {
  sheetName: string
  facts: ParsedFarmingSalesFact[]
  /** Expected sums keyed by `${companyId}::${metric}::${date}` so the
   *  caller can feed it straight into runKpiBatch's reconcile pass. */
  expectedSums: Map<ReconciliationKey, number>
  warnings: FarmingSalesParseWarning[]
}

/**
 * Convert a Cyrillic / Azerbaijani product name to a metric slug
 * suitable for `OperationalFact.metric`. Lowercase, strip diacritics,
 * replace whitespace with underscore.
 *
 * Examples:
 *   "Buğda"            → "bugda"
 *   "Şəkər Çuğunduru"  → "seker_cugunduru"
 *   "Qarğıdalı (Təkrar)" → "qargidali_tekrar"
 */
export function productNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ə/g, "e")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/**
 * Convert a year + zero-indexed month to the ISO last-of-month string.
 * Mirrors the existing KPI date convention (annual snapshots use
 * Dec-31; per-month snapshots use the last day of that month).
 */
function lastDayOfMonthIso(year: number, monthZeroIdx: number): string {
  const d = new Date(Date.UTC(year, monthZeroIdx + 1, 0))
  return d.toISOString().slice(0, 10)
}

/**
 * Parse the "Farming Budget sales plan" sheet from the AzerSheker
 * workbook. Returns one fact per (product × month) cell with a
 * non-zero value.
 *
 * @param companyId — the operational company that owns the farming
 *                    rollup (typically AZSEKER-EDEN's company id).
 */
export function parseFarmingSalesSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number; companyId: string },
): FarmingSalesParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      facts: [],
      expectedSums: new Map(),
      warnings: [
        { row: 0, reason: `Sheet "${sheetName}" not found in workbook` },
      ],
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  // Find the header row carrying 12 monthly date serials for the
  // target year. Mirrors azseker-plf.ts logic but at row index 1
  // (the Farming sheet uses r1 as header — r0 is the sheet title).
  let headerRow = -1
  const monthCols = Array(12).fill(-1)
  for (let r = 0; r < Math.min(aoa.length, 5); r++) {
    const row = aoa[r] || []
    const colsForYear = Array(12).fill(-1)
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== "number") continue
      if (v < 44000 || v > 48000) continue
      const d = new Date((v - 25569) * 86400 * 1000)
      if (d.getUTCFullYear() !== opts.preferYear) continue
      const mIdx = d.getUTCMonth()
      if (colsForYear[mIdx] === -1) colsForYear[mIdx] = c
    }
    if (colsForYear.every((v) => v !== -1)) {
      // Verify monotonic ascending.
      let mono = true
      for (let k = 1; k < 12; k++) {
        if (colsForYear[k] <= colsForYear[k - 1]) {
          mono = false
          break
        }
      }
      if (mono) {
        headerRow = r
        for (let i = 0; i < 12; i++) monthCols[i] = colsForYear[i]
        break
      }
    }
  }
  if (headerRow === -1) {
    return {
      sheetName,
      facts: [],
      expectedSums: new Map(),
      warnings: [
        {
          row: 0,
          reason: `No 12-month header row found for year ${opts.preferYear}`,
        },
      ],
    }
  }

  const facts: ParsedFarmingSalesFact[] = []
  const expectedSums = new Map<ReconciliationKey, number>()
  const warnings: FarmingSalesParseWarning[] = []

  // Section state machine. Each header row in col A toggles which
  // metric suffix + unit the next product rows produce. The Farming
  // sheet's section sentinels are case-insensitive prefix matches.
  type Section = { suffix: string; unit: string; label: string }
  const SECTIONS: ReadonlyArray<{ prefix: RegExp; sec: Section }> = [
    {
      prefix: /^satış plan,\s*ton/i,
      sec: { suffix: "ton", unit: "ton", label: "Volume" },
    },
    {
      prefix: /^satış plan,\s*azn/i,
      sec: { suffix: "revenue_azn", unit: "AZN", label: "Revenue" },
    },
    {
      prefix: /^satış plan,\s*qiymət/i,
      sec: {
        suffix: "price_azn_per_ton",
        unit: "AZN/ton",
        label: "Price",
      },
    },
    {
      prefix: /^maya dəyəri,\s*azn/i,
      sec: { suffix: "cost_azn", unit: "AZN", label: "Cost" },
    },
  ]
  let currentSection: Section | null = null

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const colARaw = row[0]
    const colA = typeof colARaw === "string" ? colARaw.trim() : ""
    if (!colA) continue

    // Section header? Switch state and skip the row.
    const match = SECTIONS.find((s) => s.prefix.test(colA))
    if (match) {
      currentSection = match.sec
      continue
    }
    // Skip generic totals if the file happens to use them.
    if (/^cəmi|^total/i.test(colA)) continue

    // We must be inside a section to interpret this row as a product.
    if (!currentSection) {
      warnings.push({
        row: r,
        reason: `Product row "${colA}" before any section header — skipping`,
      })
      continue
    }

    const slug = productNameToSlug(colA)
    if (!slug) {
      warnings.push({
        row: r,
        reason: `Could not slugify product name "${colA}"`,
      })
      continue
    }
    const metric = `farm_sales_${slug}_${currentSection.suffix}`

    for (let m = 0; m < 12; m++) {
      const cell = row[monthCols[m]]
      const v = typeof cell === "number" ? cell : 0
      if (v === 0) continue
      const date = lastDayOfMonthIso(opts.preferYear, m)
      facts.push({
        date,
        metric,
        productName: colA,
        value: v,
        unit: currentSection.unit,
        sourceCell: `${sheetName}!${currentSection.label}/${colA}@${date}`,
      })
      const key = buildReconKey(opts.companyId, metric, date)
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + v)
    }
  }

  return { sheetName, facts, expectedSums, warnings }
}

/**
 * Parse "Production Budget sales plan" — CPC tonnage by product +
 * location.
 *
 * Sheet shape:
 *   • r2 = header — col0 "For PLF", col1 "Group", col2 "Location",
 *     col5 "Production (Production Step 3)" (the specific product
 *     variant we use as metric name), cols 9..20 = 12 monthly dates.
 *   • r3..r16 = "Ana məhsul" main product rows
 *   • r18..r21 = "Yan məhsul" by-product rows
 *
 * Only tonnage — no price / revenue / cost section structure (unlike
 * Farming). Each row emits 1-12 facts.
 *
 * Metric shape: `prod_sales_<product_slug>_<location_slug>_ton`.
 * Location is encoded so Azerbaijan vs Export same-product splits
 * don't collide.
 */
export function parseProductionSalesSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number; companyId: string },
): FarmingSalesParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      facts: [],
      expectedSums: new Map(),
      warnings: [
        { row: 0, reason: `Sheet "${sheetName}" not found in workbook` },
      ],
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  // Locate the header row with 12 monthly dates for target year. The
  // Production sheet uses r2 as the header; date cells are intermixed
  // with text labels in row 2, so we scan all rows in the first 5.
  let headerRow = -1
  const monthCols = Array(12).fill(-1)
  for (let r = 0; r < Math.min(aoa.length, 5); r++) {
    const row = aoa[r] || []
    const colsForYear = Array(12).fill(-1)
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== "number") continue
      if (v < 44000 || v > 48000) continue
      const d = new Date((v - 25569) * 86400 * 1000)
      if (d.getUTCFullYear() !== opts.preferYear) continue
      const mIdx = d.getUTCMonth()
      if (colsForYear[mIdx] === -1) colsForYear[mIdx] = c
    }
    if (colsForYear.every((v) => v !== -1)) {
      let mono = true
      for (let k = 1; k < 12; k++) {
        if (colsForYear[k] <= colsForYear[k - 1]) {
          mono = false
          break
        }
      }
      if (mono) {
        headerRow = r
        for (let i = 0; i < 12; i++) monthCols[i] = colsForYear[i]
        break
      }
    }
  }
  if (headerRow === -1) {
    return {
      sheetName,
      facts: [],
      expectedSums: new Map(),
      warnings: [
        {
          row: 0,
          reason: `No 12-month header row found for year ${opts.preferYear}`,
        },
      ],
    }
  }

  const facts: ParsedFarmingSalesFact[] = []
  const expectedSums = new Map<ReconciliationKey, number>()
  const warnings: FarmingSalesParseWarning[] = []

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    // col 0 = section ("Ana məhsul" / "Yan məhsul")
    const section = typeof row[0] === "string" ? row[0].trim() : ""
    if (!section) continue
    if (!/^(ana məhsul|yan məhsul)/i.test(section)) continue
    // col 2 = location
    const location = typeof row[2] === "string" ? row[2].trim() : ""
    // col 5 = product (Production Step 3). Falls back to col 7
    // (Product Sales) if col 5 is empty.
    const productRaw =
      (typeof row[5] === "string" ? row[5].trim() : "") ||
      (typeof row[7] === "string" ? row[7].trim() : "")
    if (!productRaw) continue
    const productSlug = productNameToSlug(productRaw)
    const locationSlug = productNameToSlug(location) || "az"
    if (!productSlug) {
      warnings.push({
        row: r,
        reason: `Could not slugify product "${productRaw}"`,
      })
      continue
    }
    const metric = `prod_sales_${productSlug}_${locationSlug}_ton`

    for (let m = 0; m < 12; m++) {
      const cell = row[monthCols[m]]
      const v = typeof cell === "number" ? cell : 0
      if (v === 0) continue
      const date = lastDayOfMonthIso(opts.preferYear, m)
      facts.push({
        date,
        metric,
        productName: `${productRaw} (${location})`,
        value: v,
        unit: "ton",
        sourceCell: `${sheetName}!${productRaw}/${location}@${date}`,
      })
      const key = buildReconKey(opts.companyId, metric, date)
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + v)
    }
  }

  return { sheetName, facts, expectedSums, warnings }
}

/**
 * Parse "Satış ProMalt" — Malt sales by customer × month.
 *
 * Sheet shape:
 *   • r3 = header — col1 "Alıcı (MALT arpası)" (customer name),
 *     col2 "Qiymət TON/AZN" (price per tonne), then paired columns
 *     starting at col 3 — odd index = Miqdar (volume in ton),
 *     even index = Məbləğ (revenue in AZN). Each month consumes 2
 *     columns; 12 months = 24 columns (cols 3..26).
 *   • r4 = sub-header with literal "Miqdar/Məbləğ" labels (skipped).
 *   • r5..rN = customer rows. Stop at first "Cəmi" / "Total" line.
 *
 * Emits THREE metrics per (customer × month):
 *   • `malt_sales_customer_NN_volume_ton`
 *   • `malt_sales_customer_NN_revenue_azn`
 * Plus ONE metric per customer (constant across months):
 *   • `malt_sales_customer_NN_price_azn_per_ton` (Dec 31 snapshot).
 *
 * Customer index NN is the 1-based position in the file — stable as
 * long as the operator doesn't re-order the sheet. We don't slugify
 * the literal customer name because the file commonly uses placeholder
 * labels ("Müştəri 1", "Müştəri 2") that would collide.
 */
export function parseProMaltSalesSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts: { preferYear: number; companyId: string },
): FarmingSalesParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      facts: [],
      expectedSums: new Map(),
      warnings: [
        { row: 0, reason: `Sheet "${sheetName}" not found in workbook` },
      ],
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  // After `blankrows: false` stripping, ProMalt sheet AOA layout:
  //   r0 = sheet title
  //   r1 = main header (col 0 = "Alıcı...", col 1 = "Qiymət TON/AZN",
  //        col 2+ = monthly Cyrillic labels "YANVAR"/"FEVRAL"/...)
  //   r2 = sub-header ("Miqdar" / "Məbləğ" pairs per month)
  //   r3..rN = customer rows
  // Stop iterating at any "Cəmi" / "Yan məhsul" subtotal row.
  const dataStartRow = 3
  const customerCol = 0
  const priceCol = 1
  // Each month consumes 2 cols (Miqdar / Məbləğ) starting at col 2:
  //   vol Jan = col 2, rev Jan = col 3, vol Feb = col 4, rev Feb = col 5, ...
  const monthVolumeCols: number[] = []
  const monthRevenueCols: number[] = []
  for (let m = 0; m < 12; m++) {
    monthVolumeCols.push(priceCol + 1 + m * 2)
    monthRevenueCols.push(priceCol + 2 + m * 2)
  }

  const facts: ParsedFarmingSalesFact[] = []
  const expectedSums = new Map<ReconciliationKey, number>()
  const warnings: FarmingSalesParseWarning[] = []

  let customerIndex = 0
  for (let r = dataStartRow; r < aoa.length; r++) {
    const row = aoa[r] || []
    const nameRaw = row[customerCol]
    const customerName = typeof nameRaw === "string" ? nameRaw.trim() : ""
    if (!customerName) continue
    // Stop at any subtotal / footer row.
    if (/^(cəmi|total|yan məhsul satışı|malt maya|yan məhsul maya)/i.test(customerName)) {
      break
    }
    customerIndex += 1
    const customerSlug = `customer_${String(customerIndex).padStart(2, "0")}`

    const priceRaw = row[priceCol]
    const price = typeof priceRaw === "number" ? priceRaw : null
    if (price !== null && price > 0) {
      const date = lastDayOfMonthIso(opts.preferYear, 11) // Dec 31 snapshot
      const metric = `malt_sales_${customerSlug}_price_azn_per_ton`
      facts.push({
        date,
        metric,
        productName: customerName,
        value: price,
        unit: "AZN/ton",
        sourceCell: `${sheetName}!${customerName} price@${date}`,
      })
      const key = buildReconKey(opts.companyId, metric, date)
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + price)
    }

    for (let m = 0; m < 12; m++) {
      const volRaw = row[monthVolumeCols[m]]
      const revRaw = row[monthRevenueCols[m]]
      const volume = typeof volRaw === "number" ? volRaw : 0
      const revenue = typeof revRaw === "number" ? revRaw : 0
      if (volume === 0 && revenue === 0) continue
      const date = lastDayOfMonthIso(opts.preferYear, m)

      if (volume !== 0) {
        const metric = `malt_sales_${customerSlug}_volume_ton`
        facts.push({
          date,
          metric,
          productName: customerName,
          value: volume,
          unit: "ton",
          sourceCell: `${sheetName}!${customerName} vol@${date}`,
        })
        const key = buildReconKey(opts.companyId, metric, date)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + volume)
      }
      if (revenue !== 0) {
        const metric = `malt_sales_${customerSlug}_revenue_azn`
        facts.push({
          date,
          metric,
          productName: customerName,
          value: revenue,
          unit: "AZN",
          sourceCell: `${sheetName}!${customerName} rev@${date}`,
        })
        const key = buildReconKey(opts.companyId, metric, date)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + revenue)
      }
    }
  }

  if (customerIndex === 0) {
    warnings.push({
      row: dataStartRow,
      reason: "No customer rows found",
    })
  }

  return { sheetName, facts, expectedSums, warnings }
}

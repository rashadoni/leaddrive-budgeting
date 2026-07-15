/**
 * Product-sales parsers (2026-07-15) — volume + price + revenue per
 * product × month, for BOTH plan kinds.
 *
 * Why this exists: the Sales page reads `SalesBudgetLine` (quantity /
 * unitPrice / amount). Nothing in the AI import ever wrote it, so Qty/Price
 * always rendered 0 — the client's second reported gap. The numbers DO exist
 * in the workbook, in two shapes per plan kind:
 *
 *   BUDGET_GRID   — one row per product, one column per month, rows grouped
 *                   under section banners ("Satış plan, Ton" / ", AZN" /
 *                   ", Qiymət"). Farming shape.
 *   BUDGET_BANNER — one row per product, column GROUPS per measure, each
 *                   group opened by a banner in the row above the month
 *                   header ("SALES VOLUMES, TON" / "GROSS REVENUE, ₼" /
 *                   "DISCOUNTS, ₼"). Processing shape.
 *   TRANSACTIONS  — one row per sale (period / product / customer /
 *                   amount / tons), aggregated here to product × month.
 *
 * Revenue basis: NET of discounts (client decision 2026-07-15) — the banner
 * shape's `net = gross + discounts` (discounts are stored signed-negative);
 * the transactional CPC sheet is already "Net Satış AZN".
 *
 * Pure: no DB, no LLM, no workbook mutation.
 */
import type * as XLSXType from "xlsx"
import {
  resolveProductIdentity,
  isSectionBannerLabel,
  type ProductIdentity,
} from "./product-identity"

export type ProductSalesShape =
  | "budget_grid"
  | "budget_banner"
  | "transactions"

/** One product's numbers for one month — the canonical model both shapes emit. */
export interface ProductMonthRow {
  identity: ProductIdentity
  /** 1-12. */
  month: number
  year: number
  quantity: number
  /** NET revenue (discounts already applied). */
  amount: number
  /** Explicit price when the source states one; else derived by the caller. */
  explicitUnitPrice?: number
}

export interface ProductSalesParseResult {
  shape: ProductSalesShape | null
  rows: ProductMonthRow[]
  warnings: string[]
  /** Labels that fell outside the approved dictionary (surfaced for review). */
  unknownLabels: string[]
}

type Aoa = Array<Array<unknown>>

function toAoa(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xlsx: any,
): Aoa {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  }) as Aoa
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Excel serial date / Date / "2026-01-01" → {year, month} or null.
 *
 * A `Date` (only produced when a caller reads the workbook with
 * `cellDates:true`) is normalised by rounding its LOCAL wall clock to the
 * nearest midnight. Two traps this closes, both silently booking a month's
 * revenue into the wrong month:
 *   • xlsx builds dates from a local-time epoch base, so in a zone with a
 *     historical LMT offset the value lands ~24s EARLY — the real workbook's
 *     "1 Jan 2025" materialises as 2024-12-31T23:59:36 local (verified in
 *     Asia/Baku, 2026-07-15), i.e. the previous month AND year;
 *   • reading UTC getters off a locally-built date rolls the 1st of a month
 *     back a day east of Greenwich.
 * Serial numbers keep the exact UTC-epoch path — no wall clock involved.
 */
function cellToPeriod(v: unknown): { year: number; month: number } | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    // Shift so UTC getters read the LOCAL wall clock, round to nearest day.
    const wall = v.getTime() - v.getTimezoneOffset() * 60_000
    const day = new Date(Math.round(wall / 86_400_000) * 86_400_000)
    return { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1 }
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial (1900 epoch, day 25569 = 1970-01-01)
    const ms = (v - 25569) * 86400 * 1000
    const d = new Date(ms)
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
  }
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})/)
    if (m) return { year: Number(m[1]), month: Number(m[2]) }
  }
  return null
}

/** Month columns in `row`, restricted to `year`. Returns [colIndex, month][]. */
function monthColumns(
  row: ReadonlyArray<unknown>,
  year: number,
  from = 0,
  to = row.length,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let c = from; c < to; c++) {
    const p = cellToPeriod(row[c])
    if (p && p.year === year) out.push([c, p.month])
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Shape detection
// ──────────────────────────────────────────────────────────────────────

const BANNER_VOLUME = /sales\s+volumes?/i
const BANNER_GROSS = /gross\s+revenue/i
const BANNER_DISCOUNT = /discounts?/i
const GRID_TON = /^(satış|satis|sales)\s+plan\s*,\s*ton/i
const GRID_AZN = /^(satış|satis|sales)\s+plan\s*,\s*azn/i
const GRID_PRICE = /^(satış|satis|sales)\s+plan\s*,\s*(qiymət|qiymet|price)/i
/** Transactional headers, either language. Period + product + amount + qty. */
const TX_PERIOD = /^(dövr|dovr|period|tarix)$/i
const TX_AMOUNT = /(net\s+satış|net\s+satis|satış,\s*azn|satis,\s*azn|net\s+sales)/i
const TX_QTY = /(net\s+miqdar|satış,\s*ton|satis,\s*ton|net\s+quantity)/i
const TX_PRODUCT_GROUP = /^(məhsul qrupu|mehsul qrupu|product group)$/i
const TX_PRODUCT = /^(product|məhsul|mehsul)$/i

/**
 * Deterministic shape detection from the sheet's own cells — NOT the LLM.
 * A 95-column banner grid with mixed AZ/EN headers is not a good LLM routing
 * problem, and a misroute here writes wrong money.
 */
export function detectProductSalesShape(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xlsx: any,
): ProductSalesShape | null {
  const aoa = toAoa(workbook, sheetName, xlsx)
  if (aoa.length < 3) return null
  const head = aoa.slice(0, 6)
  const flat = head.flat().filter((v): v is string => typeof v === "string")

  if (flat.some((v) => BANNER_VOLUME.test(v)) && flat.some((v) => BANNER_GROSS.test(v)))
    return "budget_banner"

  const colA = aoa.map((r) => r[0]).filter((v): v is string => typeof v === "string")
  if (colA.some((v) => GRID_TON.test(v)) && colA.some((v) => GRID_AZN.test(v)))
    return "budget_grid"

  for (const row of head) {
    const strs = row.filter((v): v is string => typeof v === "string")
    if (
      strs.some((v) => TX_PERIOD.test(v.trim())) &&
      strs.some((v) => TX_AMOUNT.test(v)) &&
      strs.some((v) => TX_QTY.test(v))
    )
      return "transactions"
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────
// Shape 1 — farming budget grid (row sections × month columns)
// ──────────────────────────────────────────────────────────────────────

function parseBudgetGrid(
  aoa: Aoa,
  entityCode: string,
  year: number,
): ProductSalesParseResult {
  const warnings: string[] = []
  const unknown = new Set<string>()

  // ≥3 month cells identifies the header band without demanding a full year —
  // a sheet published mid-year legitimately carries only the booked months.
  let headerRow = -1
  for (let r = 0; r < Math.min(8, aoa.length); r++) {
    if (monthColumns(aoa[r] ?? [], year).length >= 3) {
      headerRow = r
      break
    }
  }
  if (headerRow < 0) {
    return {
      shape: "budget_grid",
      rows: [],
      warnings: [
        `Sales grid "${entityCode}": no month header row for ${year} — sheet skipped`,
      ],
      unknownLabels: [],
    }
  }
  const months = monthColumns(aoa[headerRow], year)

  // Walk rows, tracking which section banner we're under.
  type Section = "qty" | "amount" | "price" | null
  let section: Section = null
  const byKey = new Map<string, ProductMonthRow>()

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const label = aoa[r]?.[0]
    if (typeof label !== "string" || !label.trim()) continue
    const l = label.trim()
    if (isSectionBannerLabel(l)) {
      section = GRID_TON.test(l)
        ? "qty"
        : GRID_AZN.test(l)
          ? "amount"
          : GRID_PRICE.test(l)
            ? "price"
            : null // COGS section — parsed for validation only, not written
      continue
    }
    if (section === null) continue
    const identity = resolveProductIdentity(l, entityCode)
    if (!identity.known) unknown.add(l)
    for (const [col, month] of months) {
      const v = num(aoa[r]?.[col])
      if (v === null) continue
      const key = `${identity.code}:${month}`
      const row = byKey.get(key) ?? {
        identity,
        month,
        year,
        quantity: 0,
        amount: 0,
      }
      if (section === "qty") row.quantity = v
      else if (section === "amount") row.amount = v
      else if (section === "price" && v !== 0) row.explicitUnitPrice = v
      byKey.set(key, row)
    }
  }

  return {
    shape: "budget_grid",
    rows: [...byKey.values()].filter((r) => r.quantity !== 0 || r.amount !== 0),
    warnings,
    unknownLabels: [...unknown],
  }
}

// ──────────────────────────────────────────────────────────────────────
// Shape 2 — processing budget, banner column-groups
// ──────────────────────────────────────────────────────────────────────

/** Identity column preference: "For PL" (aligns with the P&L revenue lines) then "Product (Sales)". */
const IDENTITY_HEADERS = [/^for\s+pl$/i, /^product\s*\(sales\)$/i, /^product$/i]

function parseBudgetBanner(
  aoa: Aoa,
  entityCode: string,
  year: number,
): ProductSalesParseResult {
  const warnings: string[] = []
  const unknown = new Set<string>()

  // Banner row = the row carrying "SALES VOLUMES, TON"; header row is right below.
  let bannerRow = -1
  for (let r = 0; r < Math.min(6, aoa.length); r++) {
    if ((aoa[r] ?? []).some((v) => typeof v === "string" && BANNER_VOLUME.test(v))) {
      bannerRow = r
      break
    }
  }
  const headerRow = bannerRow + 1
  if (bannerRow < 0 || !aoa[headerRow]) {
    return {
      shape: "budget_banner",
      rows: [],
      warnings: [`Sales banner grid "${entityCode}": no banner/header row — skipped`],
      unknownLabels: [],
    }
  }

  // Banner start columns, in document order → each section spans until the next.
  const banners: Array<{ col: number; kind: "qty" | "gross" | "discount" | "other" }> = []
  ;(aoa[bannerRow] ?? []).forEach((v, c) => {
    if (typeof v !== "string") return
    const kind = BANNER_VOLUME.test(v)
      ? "qty"
      : BANNER_GROSS.test(v)
        ? "gross"
        : BANNER_DISCOUNT.test(v)
          ? "discount"
          : "other"
    banners.push({ col: c, kind })
  })
  banners.sort((a, b) => a.col - b.col)
  const spanOf = (kind: "qty" | "gross" | "discount") => {
    const i = banners.findIndex((b) => b.kind === kind)
    if (i < 0) return null
    const start = banners[i].col
    const end = i + 1 < banners.length ? banners[i + 1].col : (aoa[headerRow]?.length ?? 0)
    return { start, end }
  }
  const qtySpan = spanOf("qty")
  const grossSpan = spanOf("gross")
  const discSpan = spanOf("discount")
  if (!qtySpan || !grossSpan) {
    return {
      shape: "budget_banner",
      rows: [],
      warnings: [
        `Sales banner grid "${entityCode}": missing volume or gross-revenue section — skipped`,
      ],
      unknownLabels: [],
    }
  }

  const identityCol = (() => {
    const header = aoa[headerRow] ?? []
    for (const re of IDENTITY_HEADERS) {
      const c = header.findIndex((v) => typeof v === "string" && re.test(v.trim()))
      if (c >= 0) return c
    }
    return -1
  })()
  if (identityCol < 0) {
    return {
      shape: "budget_banner",
      rows: [],
      warnings: [
        `Sales banner grid "${entityCode}": no product identity column ("For PL" / "Product (Sales)") — skipped`,
      ],
      unknownLabels: [],
    }
  }

  const qtyMonths = monthColumns(aoa[headerRow], year, qtySpan.start, qtySpan.end)
  const grossMonths = monthColumns(aoa[headerRow], year, grossSpan.start, grossSpan.end)
  const discMonths = discSpan
    ? monthColumns(aoa[headerRow], year, discSpan.start, discSpan.end)
    : []
  if (qtyMonths.length === 0 || grossMonths.length === 0) {
    return {
      shape: "budget_banner",
      rows: [],
      warnings: [
        `Sales banner grid "${entityCode}": no ${year} month columns inside the sections — skipped`,
      ],
      unknownLabels: [],
    }
  }

  const byKey = new Map<string, ProductMonthRow>()
  const add = (
    identity: ProductIdentity,
    month: number,
    field: "quantity" | "amount",
    v: number,
  ) => {
    const key = `${identity.code}:${month}`
    const row = byKey.get(key) ?? { identity, month, year, quantity: 0, amount: 0 }
    row[field] += v
    byKey.set(key, row)
  }

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const label = aoa[r]?.[identityCol]
    if (typeof label !== "string" || !label.trim()) continue
    const identity = resolveProductIdentity(label, entityCode)
    if (!identity.known) unknown.add(label.trim())
    for (const [col, month] of qtyMonths) {
      const v = num(aoa[r]?.[col])
      if (v) add(identity, month, "quantity", v)
    }
    // NET revenue = gross + discounts (discounts are signed-negative).
    for (const [col, month] of grossMonths) {
      const v = num(aoa[r]?.[col])
      if (v) add(identity, month, "amount", v)
    }
    for (const [col, month] of discMonths) {
      const v = num(aoa[r]?.[col])
      if (v) add(identity, month, "amount", v)
    }
  }

  return {
    shape: "budget_banner",
    rows: [...byKey.values()].filter((r) => r.quantity !== 0 || r.amount !== 0),
    warnings,
    unknownLabels: [...unknown],
  }
}

// ──────────────────────────────────────────────────────────────────────
// Shape 3 — transactional actuals → product × month
// ──────────────────────────────────────────────────────────────────────

/**
 * Largest plausible per-unit price (AZN) for a quantity column that CLAIMS to
 * be tonnes. Agricultural + processed goods trade in the 50–20,000 ₼/t band;
 * an implied price below this floor means the column is really a smaller unit.
 */
const TONNE_PRICE_FLOOR = 20
const KG_PER_TONNE = 1000

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Divisor turning the sheet's quantity into the unit its header claims.
 *
 * The client's CPC actuals ship a column headed "Net Miqdar Ton" whose values
 * are actually KILOGRAMS — their own summary tab divides it by 1000, and the
 * implied price proves it (0.91 ₼ vs the budget's 946 ₼/t). Importing it as
 * stated would make the Sales page's price 1000× too small and break every
 * budget-vs-actual product comparison.
 *
 * Deterministic + conservative: only fires when the header EXPLICITLY claims
 * tonnes AND the sheet-wide MEDIAN implied price is below the floor (so one
 * cheap by-product can't flip a whole sheet). Otherwise the quantity is taken
 * as stated. Confirmed with the client 2026-07-15.
 */
export function inferQuantityScale(
  rows: ReadonlyArray<{ quantity: number; amount: number }>,
  qtyHeader: string,
): { divisor: number; reason: string | null } {
  if (!/\bton\b|tonn|miqdar\s+ton/i.test(qtyHeader)) return { divisor: 1, reason: null }
  const prices = rows
    .filter((r) => r.quantity !== 0 && r.amount !== 0)
    .map((r) => Math.abs(r.amount / r.quantity))
  if (prices.length < 3) return { divisor: 1, reason: null }
  const med = median(prices)
  if (med > 0 && med < TONNE_PRICE_FLOOR) {
    return {
      divisor: KG_PER_TONNE,
      reason: `column "${qtyHeader.trim()}" claims tonnes but the median implied price is ${med.toFixed(2)} ₼ — the values are kilograms; divided by ${KG_PER_TONNE} so price/volume read per tonne`,
    }
  }
  return { divisor: 1, reason: null }
}

function parseTransactions(
  aoa: Aoa,
  entityCode: string,
  year: number,
): ProductSalesParseResult {
  const warnings: string[] = []
  const unknown = new Set<string>()

  let headerRow = -1
  for (let r = 0; r < Math.min(8, aoa.length); r++) {
    const strs = (aoa[r] ?? []).filter((v): v is string => typeof v === "string")
    if (
      strs.some((v) => TX_PERIOD.test(v.trim())) &&
      strs.some((v) => TX_AMOUNT.test(v)) &&
      strs.some((v) => TX_QTY.test(v))
    ) {
      headerRow = r
      break
    }
  }
  if (headerRow < 0) {
    return {
      shape: "transactions",
      rows: [],
      warnings: [`Sales transactions "${entityCode}": no header row — skipped`],
      unknownLabels: [],
    }
  }
  const header = aoa[headerRow] ?? []
  const findCol = (re: RegExp) =>
    header.findIndex((v) => typeof v === "string" && re.test(v.trim()))

  const periodCol = findCol(TX_PERIOD)
  const amountCol = findCol(TX_AMOUNT)
  const qtyCol = findCol(TX_QTY)
  // Prefer the product GROUP (aligns with the budget's "For PL" granularity);
  // fall back to the individual product when the sheet has no group column.
  const groupCol = findCol(TX_PRODUCT_GROUP)
  const productCol = groupCol >= 0 ? groupCol : findCol(TX_PRODUCT)
  if (periodCol < 0 || amountCol < 0 || qtyCol < 0 || productCol < 0) {
    return {
      shape: "transactions",
      rows: [],
      warnings: [
        `Sales transactions "${entityCode}": missing a required column (period/product/amount/qty) — skipped`,
      ],
      unknownLabels: [],
    }
  }

  const byKey = new Map<string, ProductMonthRow>()
  let skippedYear = 0
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const period = cellToPeriod(row[periodCol])
    if (!period) continue
    if (period.year !== year) {
      skippedYear++
      continue
    }
    const label = row[productCol]
    if (typeof label !== "string" || !label.trim()) continue
    const identity = resolveProductIdentity(label, entityCode)
    if (!identity.known) unknown.add(label.trim())
    const amount = num(row[amountCol]) ?? 0
    const qty = num(row[qtyCol]) ?? 0
    if (amount === 0 && qty === 0) continue
    const key = `${identity.code}:${period.month}`
    const acc = byKey.get(key) ?? {
      identity,
      month: period.month,
      year,
      quantity: 0,
      amount: 0,
    }
    acc.quantity += qty
    acc.amount += amount
    byKey.set(key, acc)
  }
  if (skippedYear > 0) {
    warnings.push(
      `Sales transactions "${entityCode}": ${skippedYear} row(s) outside ${year} skipped (import that year separately).`,
    )
  }

  // Normalise the quantity to the unit the header claims (kg-as-"Ton" guard).
  const rows = [...byKey.values()]
  const qtyHeader = String(header[qtyCol] ?? "")
  const scale = inferQuantityScale(rows, qtyHeader)
  if (scale.divisor !== 1) {
    for (const r of rows) r.quantity /= scale.divisor
    warnings.push(`Sales transactions "${entityCode}": ${scale.reason}`)
  }

  return {
    shape: "transactions",
    rows,
    warnings,
    unknownLabels: [...unknown],
  }
}

// ──────────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────────

export function parseProductSalesSheet(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xlsx: any,
  opts: { entityCode: string; year: number },
): ProductSalesParseResult {
  const shape = detectProductSalesShape(workbook, sheetName, xlsx)
  if (!shape) {
    return {
      shape: null,
      rows: [],
      warnings: [`Sheet "${sheetName}" is not a recognised product-sales shape`],
      unknownLabels: [],
    }
  }
  const aoa = toAoa(workbook, sheetName, xlsx)
  const res =
    shape === "budget_grid"
      ? parseBudgetGrid(aoa, opts.entityCode, opts.year)
      : shape === "budget_banner"
        ? parseBudgetBanner(aoa, opts.entityCode, opts.year)
        : parseTransactions(aoa, opts.entityCode, opts.year)
  if (res.unknownLabels.length > 0) {
    res.warnings.push(
      `Sheet "${sheetName}": ${res.unknownLabels.length} product label(s) outside the approved dictionary — imported under their own code, review the mapping: ${res.unknownLabels.slice(0, 8).join(", ")}${res.unknownLabels.length > 8 ? "…" : ""}`,
    )
  }
  return res
}

/** Customer-name headers on a transactional sales sheet, either language. */
const TX_CUSTOMER = /^(müştəri|musteri|müştəri adı|musteri adi|customer|client)$/i

export interface SalesCustomerRow {
  name: string
  /** Net turnover for the year, same basis as the product rows. */
  amount: number
  /** Share of the sheet's total turnover, 0-100. */
  sharePct: number
}

/**
 * Aggregate a TRANSACTIONAL sales sheet by CUSTOMER for one year.
 *
 * This is what lights up CUSTOMER_HHI / TOP_CUSTOMER_SHARE /
 * TOP3_CUSTOMER_SHARE: the client's "Müştəri İcmalı" tab is a pre-computed
 * summary the counterparty-register parser can't read, but every fakt row
 * names its customer, so the concentration is derivable from the source.
 *
 * Returns [] (not an error) when the sheet has no customer column — plenty of
 * sales sheets don't, and that must not fail the import.
 */
export function parseSalesCustomers(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xlsx: any,
  opts: { year: number },
): { rows: SalesCustomerRow[]; warnings: string[] } {
  const aoa = toAoa(workbook, sheetName, xlsx)
  const warnings: string[] = []

  let headerRow = -1
  for (let r = 0; r < Math.min(8, aoa.length); r++) {
    const strs = (aoa[r] ?? []).filter((v): v is string => typeof v === "string")
    if (
      strs.some((v) => TX_PERIOD.test(v.trim())) &&
      strs.some((v) => TX_AMOUNT.test(v))
    ) {
      headerRow = r
      break
    }
  }
  if (headerRow < 0) return { rows: [], warnings: [] }
  const header = aoa[headerRow] ?? []
  const findCol = (re: RegExp) =>
    header.findIndex((v) => typeof v === "string" && re.test(v.trim()))
  const periodCol = findCol(TX_PERIOD)
  const amountCol = findCol(TX_AMOUNT)
  const customerCol = findCol(TX_CUSTOMER)
  if (periodCol < 0 || amountCol < 0 || customerCol < 0) return { rows: [], warnings: [] }

  const byName = new Map<string, number>()
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const period = cellToPeriod(row[periodCol])
    if (!period || period.year !== opts.year) continue
    const raw = row[customerCol]
    if (typeof raw !== "string" || !raw.trim()) continue
    const amount = num(row[amountCol]) ?? 0
    if (amount === 0) continue
    // Collapse case/spacing variants of the same customer so one buyer
    // written two ways doesn't halve its apparent concentration.
    const name = raw.trim().replace(/\s+/g, " ")
    const key = name.toUpperCase()
    byName.set(key, (byName.get(key) ?? 0) + amount)
  }
  if (byName.size === 0) return { rows: [], warnings: [] }

  // Display name = the first spelling seen for each key.
  const displayByKey = new Map<string, string>()
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const raw = aoa[r]?.[customerCol]
    if (typeof raw !== "string" || !raw.trim()) continue
    const name = raw.trim().replace(/\s+/g, " ")
    const key = name.toUpperCase()
    if (!displayByKey.has(key)) displayByKey.set(key, name)
  }

  const total = [...byName.values()].reduce((s, v) => s + v, 0)
  if (total <= 0) {
    warnings.push(
      `Sheet "${sheetName}": customer turnover for ${opts.year} nets to ${total.toFixed(0)} — concentration not derived`,
    )
    return { rows: [], warnings }
  }
  const rows = [...byName.entries()]
    .map(([key, amount]) => ({
      name: displayByKey.get(key) ?? key,
      amount,
      sharePct: (amount / total) * 100,
    }))
    .sort((a, b) => b.amount - a.amount)
  return { rows, warnings }
}

/**
 * Final price rule (client decision: NET basis).
 *   • explicit price wins ONLY when it agrees with amount/quantity (±1%) —
 *     a stated price that contradicts the money is a source error, and the
 *     money is the source of record;
 *   • else derived = amount / quantity;
 *   • quantity 0 → price 0 (the column is non-nullable) + caller warns.
 */
export function resolveUnitPrice(row: ProductMonthRow): number {
  if (row.quantity === 0) return 0
  const derived = row.amount / row.quantity
  if (row.explicitUnitPrice !== undefined && row.explicitUnitPrice !== 0) {
    const drift = Math.abs(row.explicitUnitPrice - derived) / Math.abs(derived || 1)
    if (drift <= 0.01) return row.explicitUnitPrice
  }
  return derived
}

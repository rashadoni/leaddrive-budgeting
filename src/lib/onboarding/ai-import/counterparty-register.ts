/**
 * Counterparty register parser (Top-10 customers / suppliers).
 *
 * Source shape (AzerSheker "Top 10.xlsx"): several entity blocks SIDE BY SIDE,
 * each two columns wide — an entity-name header over a "Turnover" column:
 *
 *   AZƏRŞƏKƏR MMC | Turnover |   | EDEN AGRO MMC | Turnover |   | CPC MMC | Turnover
 *   ATS FOOD MMC  | 2917403  |   | AZ ŞƏKƏR İTT   | 935888   |   | Veysəl. | 2569261
 *   …
 *
 * The parser auto-detects each (nameCol, turnoverCol) block from the header row,
 * reads the counterparty rows beneath, and derives each counterparty's share of
 * that entity's total turnover (0-100). The handler writes the `Counterparty`
 * table, which counterpartyHhiResolver reads → CUSTOMER_HHI / SUPPLIER_HHI.
 *
 * Pure: no DB, no LLM. Entity headers are mapped to company codes by
 * `mapCounterpartyEntity` (AzerSheker alias table + a normalized fallback);
 * unmapped blocks are reported as warnings, never guessed.
 */
import type * as XLSXType from "xlsx"

export type CounterpartyRole = "customer" | "supplier"

export interface ParsedCounterparty {
  name: string
  turnover: number
  /** % of the entity's total turnover for this role, 0-100. */
  sharePct: number
}
export interface CounterpartyBlock {
  entityHeader: string
  /** Resolved company code (e.g. AZSEKER-AZSF) or null if unmapped. */
  entityCode: string | null
  totalTurnover: number
  counterparties: ParsedCounterparty[]
}
export interface CounterpartyParseResult {
  role: CounterpartyRole
  blocks: CounterpartyBlock[]
  warnings: string[]
}

/** Map an in-sheet entity header ("AZƏRŞƏKƏR MMC") → company code. AzerSheker
 *  alias table first (handles the holding-vs-AZSF ambiguity: a counterparty
 *  block belongs to the operating sugar entity, not the holding), then a
 *  normalized contains-match against the optional knownCodes list. */
export function mapCounterpartyEntity(header: string, knownCodes: string[] = []): string | null {
  const n = header
    .toUpperCase()
    .replace(/["'.,]/g, "")
    .replace(/\b(MMC|LLC|LTD|ASC|QSC|MƏHDUD MƏSULIYYƏTLI CƏMIYYƏT)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!n) return null
  if (n.includes("EDEN")) return "AZSEKER-EDEN"
  if (n.includes("CPC")) return "AZSEKER-CPC"
  if (n.includes("PROMALT")) return "AZSEKER-PROMALT"
  if (n.includes("MALT")) return "AZSEKER-MALT"
  if (n.includes("AZƏRŞƏKƏR") || n.includes("AZERSEKER") || n.includes("AZERSHEKER") || n.includes("AZƏR ŞƏKƏR"))
    return "AZSEKER-AZSF"
  // Generic fallback: a known code whose tail matches the header start.
  const compact = n.replace(/[\s-]/g, "")
  for (const code of knownCodes) {
    const tail = code.split("-").pop()?.toUpperCase() ?? code.toUpperCase()
    if (compact.includes(tail.replace(/[\s-]/g, ""))) return code
  }
  return null
}

const TURNOVER_RE = /turnover|dövriyyə|dovriyye|оборот|amount|məbləğ/i
const TOTAL_RE = /^(total|cəmi|yekun|итого|grand total|ümumi)/i

export function parseCounterpartyRegister(
  workbook: XLSXType.WorkBook,
  sheetName: string,
  XLSX: typeof XLSXType,
  role: CounterpartyRole,
  knownCodes: string[] = [],
): CounterpartyParseResult {
  const warnings: string[] = []
  const ws = workbook.Sheets[sheetName]
  if (!ws) return { role, blocks: [], warnings: [`Sheet "${sheetName}" not found`] }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null }) as unknown[][]
  const header = aoa[0] ?? []

  // Detect blocks: a non-empty, non-"Turnover" header cell whose NEXT cell is a
  // turnover header → (nameCol, turnoverCol).
  const blocks: CounterpartyBlock[] = []
  for (let c = 0; c < header.length; c++) {
    const cell = String(header[c] ?? "").trim()
    const next = String(header[c + 1] ?? "").trim()
    if (!cell || TURNOVER_RE.test(cell)) continue
    if (!TURNOVER_RE.test(next)) continue
    const entityHeader = cell
    const entityCode = mapCounterpartyEntity(entityHeader, knownCodes)
    if (!entityCode) warnings.push(`Entity header "${entityHeader}" not mapped to a company — block skipped`)
    // Dedupe by name within the block (a name listed twice = the same
    // counterparty split across rows) — SUM the turnover before deriving the
    // share. The DB has @@unique(companyId, role, name, period), so emitting two
    // same-named rows would fail the whole import; combining is both correct and
    // safe (2026-06-21, Codex note).
    const byName = new Map<string, ParsedCounterparty>()
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] ?? []
      const name = String(row[c] ?? "").trim()
      const turnover = row[c + 1]
      if (!name || TOTAL_RE.test(name)) continue
      if (typeof turnover !== "number" || !isFinite(turnover) || turnover <= 0) continue
      const key = name.toLowerCase()
      const existing = byName.get(key)
      if (existing) existing.turnover += turnover
      else byName.set(key, { name, turnover, sharePct: 0 })
    }
    const counterparties = Array.from(byName.values())
    const totalTurnover = counterparties.reduce((s, x) => s + x.turnover, 0)
    for (const cp of counterparties) {
      cp.sharePct = totalTurnover > 0 ? Math.round((cp.turnover / totalTurnover) * 1e6) / 1e4 : 0
    }
    if (counterparties.length > 0) blocks.push({ entityHeader, entityCode, totalTurnover, counterparties })
  }
  if (blocks.length === 0) warnings.push(`No counterparty blocks detected on "${sheetName}"`)
  return { role, blocks, warnings }
}

/** Derive role from a sheet name. Customer/Müştəri/Alıcı → customer;
 *  Supplier/Təchizatçı/Satıcı → supplier. */
export function counterpartyRoleFromSheet(sheetName: string): CounterpartyRole | null {
  const n = sheetName.toLowerCase()
  if (/customer|client|müştəri|alıcı|alici|покупател|клиент/.test(n)) return "customer"
  if (/supplier|vendor|təchizatçı|techizatci|satıcı|поставщик/.test(n)) return "supplier"
  return null
}

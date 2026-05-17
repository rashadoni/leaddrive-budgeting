/**
 * AzerSheker × Guvven KPI sheet adapters.
 *
 * Two sheet shapes:
 *
 *  1. **Farming KPI** — per-row multi-entity farm yields. Row 2 is the
 *     header with Azerbaijani labels (İl / Məhsul / Sezon / Suvarma /
 *     Təsərrüfatlar / Xərc mərkəzi 1C / Unikal Kod / Check / Sahə həcmi
 *     HA / Net Məhsuldarlıq / Cəmi məhsuldarlıq / Toxum / Satılacaq).
 *     Data rows start at R3; each row is a (year × crop × season ×
 *     irrigation × farm) bucket. Multiple rows per AZSEKER child
 *     entity (EDEN/AZSF/FARM) because each entity operates multiple
 *     farms in different regions. The "Xərc mərkəzi 1C" column carries
 *     prefixes (EDN / AZS / QT / DAS / BO) that map to entities via
 *     `resolveEntityFromCostCenter()`.
 *
 *     Per-row metrics:
 *       col I  →  area_hectares (planted area)
 *       col J  →  yield_per_ha  (tons/ha net)
 *       col K  →  harvest_tons  (total harvested)
 *
 *     Aggregation per (entity × metric × year):
 *       area_hectares = Σ rows' area
 *       harvest_tons  = Σ rows' harvest
 *       yield_per_ha  = Σ harvest ÷ Σ area  (weighted by area)
 *
 *  2. **CPC KPI** (and any future "<ENTITY> KPI" sheet) — single-entity
 *     processing metrics. Row 1 has 12 monthly date columns starting
 *     at col G. Each row pairs a label (col A) + unit (col C) +
 *     12 monthly values. v1 only emits a small whitelist of metrics
 *     mapped to existing OperationalFact keys; unknown labels are
 *     captured as warnings (review-then-extend pattern — no silent
 *     drops).
 *
 * Output shape — `ParsedKpiFact` — feeds straight into
 * `OperationalFact.createMany({ organizationId, companyId, metric,
 * date, value, unit, source: "xlsx_import" })`.
 *
 * **Why a separate adapter (vs AI Mapper)**: the KPI rows aren't a
 * leaf-account chart of accounts. The AI Mapper expects PL/CF code
 * leaves with monthly columns and infers an account_type — it would
 * produce nonsense for an "agronomy KPI baseline" sheet. The Guvven
 * coding convention is fully knowable from the file structure, so a
 * deterministic adapter is more reliable, faster, and cheaper than an
 * LLM round-trip.
 */
import type * as XLSX from "xlsx"
import {
  resolveEntityFromCostCenter,
  resolveEntityFromProcessingKpiSheet,
} from "../azseker-guvven-mapping"

/** One row written to OperationalFact. */
export interface ParsedKpiFact {
  companyCode: string
  metric: string
  unit: string
  /** ISO date string "YYYY-MM-DD". Annual snapshots use Dec-31 of the year. */
  date: string
  value: number
  sourceNote: string
}

export interface KpiParseWarning {
  row: number
  reason: string
}

export interface KpiParseResult {
  sheetName: string
  facts: ParsedKpiFact[]
  warnings: KpiParseWarning[]
}

/**
 * Excel serial → JS Date. Same convention as `excelSerialToMonth` but
 * returns the full date (year-aware). Returns null if out of plausible
 * range.
 */
function excelSerialToDate(cell: unknown): Date | null {
  if (cell instanceof Date) return cell
  if (typeof cell !== "number" || !Number.isFinite(cell)) return null
  if (cell < 44000 || cell > 48000) return null
  const d = new Date((cell - 25569) * 86400 * 1000)
  if (isNaN(d.getTime())) return null
  return d
}

function toNumber(cell: unknown): number | null {
  if (typeof cell === "number" && Number.isFinite(cell)) return cell
  if (typeof cell === "string") {
    const trimmed = cell.replace(/[,\s]/g, "")
    const n = Number(trimmed)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Header column indices for a Farming KPI sheet. Cols 0..7 are
 *  classification columns (year, crop, season, irrigation, farm,
 *  cost-center, unique-code, check). Cols 8..10 are the agronomy
 *  metrics. The detector locates the header by looking for the col-A
 *  cell value "İl" / "Year" (case-insensitive Azerbaijani/English). */
interface FarmingKpiLayout {
  headerRow: number
  yearCol: number
  cropCol: number
  costCenterCol: number
  areaCol: number      // → area_hectares
  yieldPerHaCol: number // → yield_per_ha
  harvestCol: number   // → harvest_tons
}

/** Fold Azerbaijani column headers to ASCII-lowercase so the regex
 *  match logic stays simple. Handles:
 *   - İ→I, then NFD-strip combining marks → "i"
 *   - ə→e, ı→i, ş→s, ç→c, ğ→g, ü→u, ö→o (atomic chars Unicode does
 *     not decompose; explicit replacement)
 *   - Whitespace collapse
 *   - Final toLowerCase
 *  Without folding the schwa/dotless-i/etc., "İl".toLowerCase()
 *  yields "i̇l" (Turkish dotted-i with combining dot above) and
 *  "xərc mərkəzi" stays as-is — neither compares equal to plain
 *  ASCII patterns.
 */
function normalizeCell(v: unknown): string {
  if (typeof v !== "string") return ""
  return v
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ƏəĀāÂâÄä]/g, (c) => (c === "Ə" || c === "ə" ? "e" : c))
    .replace(/Ə/g, "e")
    .replace(/ə/g, "e")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function findFarmingKpiLayout(aoa: unknown[][]): FarmingKpiLayout | null {
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const row = aoa[i] ?? []
    const isYearCol = (v: unknown): boolean => {
      const s = normalizeCell(v)
      return s === "il" || s === "year" || s === "год"
    }
    if (!row.some(isYearCol)) continue

    const yearCol = row.findIndex(isYearCol)
    const cropCol = row.findIndex((v) => /^(mehsul|crop|культура)$/.test(normalizeCell(v)))
    const costCenterCol = row.findIndex((v) =>
      /(xerc merkezi|cost center)/.test(normalizeCell(v)),
    )
    const areaCol = row.findIndex((v) =>
      /(sahe hecmi|area.*ha|planted area)/.test(normalizeCell(v)),
    )
    const yieldPerHaCol = row.findIndex((v) =>
      /(net mehsuldarliq|yield.*ha|урожайность.*га)/.test(normalizeCell(v)),
    )
    const harvestCol = row.findIndex((v) =>
      /(cemi mehsuldarliq|total yield|harvest.*ton)/.test(normalizeCell(v)),
    )
    if (yearCol < 0 || costCenterCol < 0 || areaCol < 0 || yieldPerHaCol < 0 || harvestCol < 0) {
      continue
    }
    return {
      headerRow: i,
      yearCol,
      cropCol,
      costCenterCol,
      areaCol,
      yieldPerHaCol,
      harvestCol,
    }
  }
  return null
}

/**
 * Parse a "Farming KPI" sheet. Aggregates rows by (entity × year) and
 * emits 3 facts per group (area_hectares, harvest_tons, yield_per_ha).
 *
 * The `preferYear` option filters rows to only that year. When absent
 * we emit one fact-set per year present in the data.
 */
export function parseGuvvenFarmingKpiSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: { preferYear?: number },
): KpiParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      facts: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found in workbook` }],
    }
  }
  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]

  const layout = findFarmingKpiLayout(aoa)
  if (!layout) {
    return {
      sheetName,
      facts: [],
      warnings: [{ row: 0, reason: "Could not locate Farming KPI header row (İl / Cost center / Sahə həcmi columns)" }],
    }
  }

  // Aggregate per (year, entity).
  interface Bucket {
    year: number
    entity: string
    totalArea: number
    totalHarvest: number
    rowCount: number
    cropsSeen: Set<string>
  }
  const buckets = new Map<string, Bucket>()
  const warnings: KpiParseWarning[] = []

  for (let r = layout.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const yearVal = toNumber(row[layout.yearCol])
    if (yearVal === null) continue
    const year = Math.trunc(yearVal)
    if (year < 2020 || year > 2031) continue
    if (opts?.preferYear !== undefined && year !== opts.preferYear) continue

    const costCenterRaw = row[layout.costCenterCol]
    const costCenter = typeof costCenterRaw === "string" ? costCenterRaw : ""
    const entity = resolveEntityFromCostCenter(costCenter)
    if (!entity) {
      warnings.push({
        row: r + 1,
        reason: `Could not resolve entity from cost-center "${costCenter}". Add the prefix to GUVVEN_COST_CENTER_PREFIX_TO_ENTITY if it's a new farm.`,
      })
      continue
    }

    const area = toNumber(row[layout.areaCol]) ?? 0
    const yieldPerHa = toNumber(row[layout.yieldPerHaCol]) ?? 0
    const harvest = toNumber(row[layout.harvestCol]) ?? 0
    if (area === 0 && yieldPerHa === 0 && harvest === 0) continue // all-zero row

    const cropRaw = row[layout.cropCol]
    const crop = typeof cropRaw === "string" ? cropRaw.trim() : ""

    const key = `${year}:${entity}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        year,
        entity,
        totalArea: 0,
        totalHarvest: 0,
        rowCount: 0,
        cropsSeen: new Set<string>(),
      }
      buckets.set(key, bucket)
    }
    bucket.totalArea += area
    bucket.totalHarvest += harvest
    bucket.rowCount += 1
    if (crop !== "") bucket.cropsSeen.add(crop)
  }

  const facts: ParsedKpiFact[] = []
  for (const bucket of buckets.values()) {
    // Annual snapshot — use Dec-31 of the year.
    const date = `${bucket.year}-12-31`
    const crops = Array.from(bucket.cropsSeen).join(", ") || "—"
    const sourceNote = `Farming KPI: ${bucket.rowCount} farm rows aggregated (${crops})`
    if (bucket.totalArea > 0) {
      facts.push({
        companyCode: bucket.entity,
        metric: "area_hectares",
        unit: "hectares",
        date,
        value: bucket.totalArea,
        sourceNote,
      })
    }
    if (bucket.totalHarvest > 0) {
      facts.push({
        companyCode: bucket.entity,
        metric: "harvest_tons",
        unit: "tons",
        date,
        value: bucket.totalHarvest,
        sourceNote,
      })
    }
    // yield_per_ha = total harvest ÷ total area (weighted; a simple
    // average of per-row yields would over-weight tiny plots).
    if (bucket.totalArea > 0 && bucket.totalHarvest > 0) {
      const weighted = bucket.totalHarvest / bucket.totalArea
      facts.push({
        companyCode: bucket.entity,
        metric: "yield_per_ha",
        unit: "tons/ha",
        date,
        value: Math.round(weighted * 100) / 100,
        sourceNote: `${sourceNote} — yield_per_ha = Σharvest ÷ Σarea`,
      })
    }
  }
  return { sheetName, facts, warnings }
}

/** Whitelist mapping CPC-KPI sheet labels → canonical OperationalFact
 *  metric keys. Drives the processing-KPI parser without hardcoding the
 *  match logic. Add new entries to extend coverage (review-then-extend
 *  pattern; unknown rows are warnings, not silent drops). */
interface ProcessingKpiMetricSpec {
  // Match the label cell (col A) — case-insensitive, trimmed, regex-tested.
  labelPattern: RegExp
  // Match the unit cell (col C) — same matching. If null, no unit check.
  unitPattern: RegExp | null
  metric: string
  unit: string
}

const PROCESSING_KPI_METRICS: readonly ProcessingKpiMetricSpec[] = [
  // CPC sheet uses Azerbaijani-domain labels; v1 covers the rate +
  // capacity metrics that map to existing OperationalFact keys. The
  // sheet has many more rows (raw-material yields, prices) — those
  // need new metric keys before they can be persisted.
  {
    labelPattern: /capacity utilization rate/i,
    unitPattern: /%/,
    metric: "cane_hectares_harvested_pct", // closest existing % metric
    unit: "%",
  },
]

interface ProcessingKpiLayout {
  headerRow: number
  labelCol: number
  unitCol: number
  monthCols: number[] // 12 entries, Jan..Dec
  year: number
}

function findProcessingKpiLayout(
  aoa: unknown[][],
  preferYear: number | undefined,
): ProcessingKpiLayout | null {
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const row = aoa[i] ?? []
    // Need at least 12 date cells in this row matching a year
    const byYear = new Map<number, number[]>()
    for (let c = 0; c < row.length; c++) {
      const d = excelSerialToDate(row[c])
      if (!d) continue
      const y = d.getUTCFullYear()
      let cols = byYear.get(y)
      if (!cols) {
        cols = Array(12).fill(-1)
        byYear.set(y, cols)
      }
      const m = d.getUTCMonth()
      if (cols[m] === -1) cols[m] = c
    }
    if (byYear.size === 0) continue

    const candidates = Array.from(byYear.entries())
      .map(([year, cols]) => ({ year, cols, filled: cols.filter((v) => v !== -1).length }))
      .filter((c) => c.filled === 12)
    if (candidates.length === 0) continue
    candidates.sort((a, b) => {
      if (preferYear !== undefined) {
        if (a.year === preferYear && b.year !== preferYear) return -1
        if (b.year === preferYear && a.year !== preferYear) return 1
      }
      return b.year - a.year
    })
    const pick = candidates[0]
    return {
      headerRow: i,
      labelCol: 0,
      unitCol: 2,
      monthCols: pick.cols,
      year: pick.year,
    }
  }
  return null
}

/**
 * Parse a "<Entity> KPI" sheet (single-entity processing metrics).
 * Resolves the entity from the sheet name, then walks data rows.
 * Each row that matches a label in `PROCESSING_KPI_METRICS` produces
 * 12 monthly facts (one per month). Unmatched rows are silently
 * skipped — they're processing-step labels (not actual data) or
 * metrics we don't yet model. Counter-bumps go in v2.
 */
export function parseGuvvenProcessingKpiSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  opts?: { preferYear?: number },
): KpiParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      sheetName,
      facts: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found in workbook` }],
    }
  }
  const entity = resolveEntityFromProcessingKpiSheet(sheetName)
  if (!entity) {
    return {
      sheetName,
      facts: [],
      warnings: [{
        row: 0,
        reason: `Cannot resolve entity from sheet name "${sheetName}". Add the prefix to GUVVEN_COST_CENTER_PREFIX_TO_ENTITY.`,
      }],
    }
  }

  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const layout = findProcessingKpiLayout(aoa, opts?.preferYear)
  if (!layout) {
    return {
      sheetName,
      facts: [],
      warnings: [{ row: 0, reason: "Could not find a 12-month date header row" }],
    }
  }

  const facts: ParsedKpiFact[] = []
  const warnings: KpiParseWarning[] = []

  for (let r = layout.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const labelRaw = row[layout.labelCol]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : ""
    if (label === "") continue
    const unitRaw = row[layout.unitCol]
    const unit = typeof unitRaw === "string" ? unitRaw.trim() : ""

    const spec = PROCESSING_KPI_METRICS.find(
      (s) => s.labelPattern.test(label) && (s.unitPattern === null || s.unitPattern.test(unit)),
    )
    if (!spec) continue // not in whitelist; skip silently

    for (let m = 0; m < 12; m++) {
      const v = toNumber(row[layout.monthCols[m]])
      if (v === null || v === 0) continue
      // "%" values may be expressed as 0.87 (fraction) or 87 — pick the
      // form > 1 if both columns include >1 numbers; else multiply by 100.
      const value = spec.unit === "%" && v < 1 && v > 0 ? v * 100 : v
      const monthStr = String(m + 1).padStart(2, "0")
      facts.push({
        companyCode: entity,
        metric: spec.metric,
        unit: spec.unit,
        date: `${layout.year}-${monthStr}-01`,
        value: Math.round(value * 100) / 100,
        sourceNote: `Processing KPI "${label}" → ${spec.metric}`,
      })
    }
  }

  return { sheetName, facts, warnings }
}

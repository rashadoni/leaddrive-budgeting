/**
 * Phase 7.M Tier 3 (2026-05-19) — parse "Çıxarışların uçotu.xlsx" (Land
 * lease registry of Eden Agro LLC) into structured land parcels.
 *
 * Stored as JSON array on `Company.settings.landParcels` for AZSEKER-EDEN.
 *
 * Sheet layout (Sheet1, range A1:M26):
 *   row 0: title "EDEN AGRO MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏT"
 *   row 1: header row
 *     col 0: S/S
 *     col 1: Qeydiyyat nömrəsi (registration number)
 *     col 2: Yüklü edilən əmlakın reyestr nömrəsi (asset registry #)
 *     col 3: Qeydiyyat tarixi
 *     col 4: Bələdiyyə (lessor authority)
 *     col 5: Şirkətin əvvəlki adı (previous owner — e.g. Qarabağ Taxıl MMC, Əkinçi BOFT MMC)
 *     col 6: Əsas öhdəliyin mahiyyəti (obligation nature)
 *     col 7: Torpaq sahəsinin ölçüsü -ha
 *     col 8: İllik ödənişi (annual rent)
 *     col 9: Müddəti (term — date range)
 *     col 10: Kateqoriyası (Ehtiyat fondu / Kənd təsərrüfatı)
 *     col 11: Digər hüquqlar (İcarə / İstifadə)
 *     col 12: Ünvanı (address)
 *   rows 2-18: data rows (17 parcels)
 *   row 19: "Yekun" total row — skipped
 *
 * Region detection: extracted from address (col 12) — first word usually
 * names the district (Yevlax / Ağcabədi / Beyləqan / Şəmkir / Füzuli).
 */

export interface LandParcel {
  /** Sequence number from S/S column. */
  sequenceNumber: number
  /** Registration number (govt. system). */
  registrationNumber: string
  /** Asset registry number. */
  assetRegistryNumber: string
  /** Registration date (DD.MM.YYYY format from xlsx). */
  registrationDate: string | null
  /** Lessor authority — typically rayon İcra Hakimiyyəti or Bələdiyyə. */
  lessor: string
  /** Previous owner / company holding this land before transfer. */
  previousOwner: string | null
  /** Land area in hectares. */
  hectares: number
  /** Annual rent payment in AZN. */
  annualRentAzn: number
  /** Term descriptor — e.g. "23.08.2012-23.08.2061" or "11.07.2017-49 il". */
  termDescription: string
  /** Lease start date (ISO YYYY-MM-DD, parsed from term). */
  leaseStart: string | null
  /** Lease end date (ISO YYYY-MM-DD, parsed from term). */
  leaseEnd: string | null
  /** Land category — "Ehtiyat fondu" (reserve fund) or "Kənd təsərrüfatı" (agricultural). */
  category: string
  /** Rights granted — typically "İcarə" (lease) or "İstifadə" (use). */
  rightsGranted: string
  /** Full address. */
  address: string
  /** Region inferred from address (Ağcabədi / Beyləqan / Yevlax / Şəmkir / Füzuli). */
  region: string | null
}

export interface LandRegistryParseResult {
  parcels: LandParcel[]
  warnings: string[]
  totalHectares: number
  totalAnnualRentAzn: number
}

const REGION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /Ağcabədi/i, name: "Ağcabədi" },
  { pattern: /Beyləqan/i, name: "Beyləqan" },
  { pattern: /Yevlax/i, name: "Yevlax" },
  { pattern: /Şəmkir/i, name: "Şəmkir" },
  { pattern: /Füzuli/i, name: "Füzuli" },
  { pattern: /İmişli/i, name: "İmişli" },
  { pattern: /Salyan/i, name: "Salyan" },
  { pattern: /Sabirabad/i, name: "Sabirabad" },
  { pattern: /Tərtər/i, name: "Tərtər" },
]

function inferRegion(text: string): string | null {
  for (const { pattern, name } of REGION_PATTERNS) {
    if (pattern.test(text)) return name
  }
  return null
}

function parseDateAzToIso(s: string): string | null {
  // Accept formats: DD.MM.YYYY or D.MM.YYYY etc.
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
}

function parseTermRange(
  term: string,
): { start: string | null; end: string | null } {
  // Patterns:
  //   "23.08.2012-23.08.2061"       → both dates
  //   "23.08.2012-23.08.2061;"      → ignore trailing punctuation
  //   "11.07.2017-49 (qırx doqquz) il"  → start + duration in years
  //   "26.11.2025-27.03.2066"       → both dates
  const cleaned = term.replace(/[;:]\s*$/, "").trim()
  const parts = cleaned.split("-").map((p) => p.trim())
  if (parts.length < 2) return { start: null, end: null }
  const start = parseDateAzToIso(parts[0])
  // Try end as ISO date first
  const endIso = parseDateAzToIso(parts[1])
  if (endIso) return { start, end: endIso }
  // Else maybe end is "<years> il" → compute from start + years
  const yearsMatch = /(\d+)\s*\(/.exec(parts[1]) ?? /^(\d+)/.exec(parts[1])
  if (start && yearsMatch) {
    const years = parseInt(yearsMatch[1], 10)
    const startDate = new Date(start)
    const endDate = new Date(startDate)
    endDate.setFullYear(endDate.getFullYear() + years)
    return { start, end: endDate.toISOString().slice(0, 10) }
  }
  return { start, end: null }
}

function numericOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/**
 * Pure parser — takes AOA, emits structured land parcels.
 */
export function parseLandRegistryFromAoa(
  aoa: unknown[][],
): LandRegistryParseResult {
  const parcels: LandParcel[] = []
  const warnings: string[] = []

  // Find header row by looking for "S/S" or "Torpaq sahəsinin" keywords.
  let headerRow = -1
  for (let r = 0; r < Math.min(aoa.length, 10); r++) {
    const row = aoa[r] || []
    for (const cell of row) {
      if (
        typeof cell === "string" &&
        /Torpaq sahəsinin|S\/S/i.test(cell)
      ) {
        headerRow = r
        break
      }
    }
    if (headerRow >= 0) break
  }
  if (headerRow < 0) {
    warnings.push("Header row not found — using row 1 as default")
    headerRow = 1
  }

  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row) continue
    const seqRaw = row[0]
    if (seqRaw === undefined || seqRaw === null || seqRaw === "") continue
    // Stop on "Yekun" (total) row.
    if (
      typeof seqRaw === "string" &&
      /yekun|toplam|total/i.test(seqRaw)
    ) {
      break
    }
    const seq =
      typeof seqRaw === "number"
        ? seqRaw
        : parseInt(String(seqRaw).trim(), 10) || 0
    if (!seq) continue

    const hectares = numericOrZero(row[7])
    if (hectares === 0) {
      warnings.push(`Row ${r + 1}: zero hectares — skipped`)
      continue
    }
    const term = typeof row[9] === "string" ? row[9].trim() : ""
    const { start: leaseStart, end: leaseEnd } = parseTermRange(term)
    const address = typeof row[12] === "string" ? row[12].trim() : ""
    parcels.push({
      sequenceNumber: seq,
      registrationNumber: String(row[1] ?? "").trim(),
      assetRegistryNumber: String(row[2] ?? "").trim(),
      registrationDate: parseDateAzToIso(String(row[3] ?? "")),
      lessor: typeof row[4] === "string" ? row[4].trim() : "",
      previousOwner: strOrNull(row[5]),
      hectares,
      annualRentAzn: numericOrZero(row[8]),
      termDescription: term,
      leaseStart,
      leaseEnd,
      category: typeof row[10] === "string" ? row[10].trim() : "",
      rightsGranted: typeof row[11] === "string" ? row[11].trim() : "",
      address,
      region: inferRegion(address),
    })
  }

  const totalHectares = parcels.reduce((s, p) => s + p.hectares, 0)
  const totalAnnualRentAzn = parcels.reduce((s, p) => s + p.annualRentAzn, 0)
  return { parcels, warnings, totalHectares, totalAnnualRentAzn }
}

/**
 * Convenience wrapper around `parseLandRegistryFromAoa` that takes a
 * loaded xlsx workbook + sheet name.
 */
export function parseLandRegistrySheet(
  workbook: { Sheets: Record<string, unknown>; SheetNames: string[] },
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
): LandRegistryParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      parcels: [],
      warnings: [`Sheet "${sheetName}" not found`],
      totalHectares: 0,
      totalAnnualRentAzn: 0,
    }
  }
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: true,
  }) as unknown[][]
  return parseLandRegistryFromAoa(aoa)
}

// Phase 9.2 — Trade master-data import: pure parsing/validation helpers.
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §5 step 2.
//
// Deterministic header-synonym mapping (Mikro ERP exports use Turkish
// headers; AZ/RU/EN variants covered too). No LLM call — master lists are
// small and their shape is stable; the AI classifier path stays reserved
// for the daily invoice files (9.5) where layouts genuinely vary.
// When the first real Mikro exports arrive, extend the synonym lists —
// header names below are researched defaults, not verified samples.

export type MasterKind = "master_outlets" | "master_skus" | "master_reps";

export interface RowIssue {
  /** 1-based row number in the source sheet. */
  row: number;
  message: string;
}

export interface OutletRow {
  externalCode: string;
  name: string;
  legalName?: string;
  taxId?: string;
  chainCode?: string;
  regionName: string;
  channelName: string;
  repCode?: string;
}

export interface SkuRow {
  externalCode: string;
  barcode?: string;
  name: string;
  brand: string;
  category: string;
  packageSize?: string;
  unit?: string;
}

export interface RepRow {
  externalCode: string;
  name: string;
  regionName?: string;
  channelName?: string;
}

export type MasterRow = OutletRow | SkuRow | RepRow;

export interface ParsedMaster<R extends MasterRow = MasterRow> {
  kind: MasterKind;
  /** 0-based index of the detected header row. */
  headerRowIndex: number;
  /** field name -> 0-based column index actually matched. */
  columnMap: Record<string, number>;
  rows: R[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

interface FieldSpec {
  required: boolean;
  synonyms: string[];
}

// Headers are matched EXACTLY after normalization (no substring guessing —
// "kod" must not swallow "barkod"). Every synonym is stored normalized.
const FIELDS: Record<MasterKind, Record<string, FieldSpec>> = {
  master_outlets: {
    externalCode: {
      required: true,
      synonyms: [
        "code", "kod", "cari kodu", "cari kod", "musteri kodu", "müştəri kodu",
        "mushteri kodu", "outlet code", "customer code", "код", "код клиента",
      ],
    },
    name: {
      required: true,
      synonyms: [
        "name", "ad", "adi", "adı", "cari adi", "cari adı", "musteri adi",
        "müştəri adı", "outlet", "outlet name", "customer", "customer name",
        "наименование", "название", "клиент",
      ],
    },
    legalName: {
      required: false,
      synonyms: ["legal name", "huquqi adi", "hüquqi adı", "юридическое название", "unvan sahibi"],
    },
    taxId: {
      required: false,
      synonyms: ["voen", "vöen", "tax id", "vergi kodu", "инн", "voen/tin", "tin"],
    },
    chainCode: {
      required: false,
      synonyms: ["chain", "sebeke", "şəbəkə", "network", "сеть", "zincir"],
    },
    regionName: {
      required: true,
      synonyms: ["region", "bolge", "bölgə", "bölge", "rayon", "zona", "zone", "регион"],
    },
    channelName: {
      required: true,
      synonyms: ["channel", "kanal", "канал", "trade channel", "satis kanali", "satış kanalı"],
    },
    repCode: {
      required: false,
      synonyms: [
        "rep", "rep code", "plasiyer", "plasiyer kodu", "temsilci", "təmsilçi",
        "satis numayendesi", "satış nümayəndəsi", "numayende", "nümayəndə",
        "торговый представитель", "агент", "agent",
      ],
    },
  },
  master_skus: {
    externalCode: {
      required: true,
      synonyms: [
        "sku", "sku code", "code", "kod", "stok kodu", "mehsul kodu",
        "məhsul kodu", "код товара", "артикул",
      ],
    },
    barcode: {
      required: false,
      synonyms: ["barcode", "barkod", "ean", "ean13", "штрихкод", "штрих-код"],
    },
    name: {
      required: true,
      synonyms: [
        "name", "ad", "adi", "adı", "stok adi", "stok adı", "mehsul adi",
        "məhsul adı", "product", "product name", "наименование", "название",
      ],
    },
    brand: {
      required: true,
      synonyms: ["brand", "brend", "marka", "бренд"],
    },
    category: {
      required: true,
      synonyms: ["category", "kateqoriya", "kategori", "qrup", "group", "grup", "категория", "группа"],
    },
    packageSize: {
      required: false,
      synonyms: ["package", "package size", "qablasdirma", "qablaşdırma", "ambalaj", "упаковка", "litraj", "hecm", "həcm"],
    },
    unit: {
      required: false,
      synonyms: ["unit", "vahid", "birim", "olcu vahidi", "ölçü vahidi", "ед. изм", "ед. изм.", "единица"],
    },
  },
  master_reps: {
    externalCode: {
      required: true,
      synonyms: ["code", "kod", "rep code", "plasiyer kodu", "temsilci kodu", "təmsilçi kodu", "код"],
    },
    name: {
      required: true,
      synonyms: [
        "name", "ad", "adi", "adı", "plasiyer", "temsilci", "təmsilçi",
        "numayende", "nümayəndə", "fio", "фио", "имя", "rep", "rep name",
      ],
    },
    regionName: {
      required: false,
      synonyms: ["region", "bolge", "bölgə", "bölge", "rayon", "zona", "zone", "регион"],
    },
    channelName: {
      required: false,
      synonyms: ["channel", "kanal", "канал"],
    },
  },
};

/**
 * Normalize a header cell for synonym matching: Turkish/Azeri dotted-İ
 * folds to plain `i` BEFORE toLowerCase (JS 'İ'.toLowerCase() yields
 * `i`+U+0307 which would never match), whitespace collapses, trailing
 * colons drop. Diacritics are NOT stripped — synonym lists carry both
 * spellings explicitly.
 */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/̇/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:：]+$/g, "");
}

/** ASCII code from a display name: "Bakı-Mərkəz" -> "BAKI_MERKEZ". */
export function codeFromName(name: string): string {
  const translit: Record<string, string> = {
    ə: "E", Ə: "E", ü: "U", Ü: "U", ö: "O", Ö: "O", ğ: "G", Ğ: "G",
    ş: "S", Ş: "S", ç: "C", Ç: "C", ı: "I", İ: "I",
  };
  return name
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

/** Best-effort channelType from a channel display name (schema comment: modern_trade | traditional | horeca | wholesale). */
export function guessChannelType(channelName: string): string {
  const n = normalizeHeader(channelName);
  if (/modern|mt\b|supermarket|市场|market zenciri|market şəbəkəsi/.test(n)) return "modern_trade";
  if (/horeca|kafe|restoran|cafe|restaurant|otel|hotel/.test(n)) return "horeca";
  if (/topdan|toptan|wholesale|опт|distribut/.test(n)) return "wholesale";
  return "traditional";
}

function cellText(cells: unknown[][], r: number, c: number): string {
  const row = cells[r];
  if (!row) return "";
  const v = row[c];
  if (v == null) return "";
  return String(v).trim();
}

interface HeaderMatch {
  headerRowIndex: number;
  columnMap: Record<string, number>;
  missingRequired: string[];
}

/**
 * Scan the first `maxScan` rows for the row that exact-matches the most
 * field synonyms (Mikro exports often carry 1-2 title rows above the grid).
 */
export function findHeaderRow(
  kind: MasterKind,
  cells: unknown[][],
  maxScan = 10
): HeaderMatch | null {
  const specs = FIELDS[kind];
  let best: HeaderMatch | null = null;
  let bestCount = 0;
  const limit = Math.min(maxScan, cells.length);
  for (let r = 0; r < limit; r++) {
    const row = cells[r] ?? [];
    const columnMap: Record<string, number> = {};
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (!h) continue;
      for (const [field, spec] of Object.entries(specs)) {
        if (columnMap[field] !== undefined) continue;
        if (spec.synonyms.includes(h)) {
          columnMap[field] = c;
          break;
        }
      }
    }
    const count = Object.keys(columnMap).length;
    if (count > bestCount) {
      bestCount = count;
      best = {
        headerRowIndex: r,
        columnMap,
        missingRequired: Object.entries(specs)
          .filter(([f, s]) => s.required && columnMap[f] === undefined)
          .map(([f]) => f),
      };
    }
  }
  // A real header row must match at least 2 known fields.
  return bestCount >= 2 ? best : null;
}

export function parseMasterCells(kind: MasterKind, cells: unknown[][]): ParsedMaster {
  const header = findHeaderRow(kind, cells);
  if (!header) {
    return {
      kind,
      headerRowIndex: -1,
      columnMap: {},
      rows: [],
      errors: [
        {
          row: 1,
          message:
            "Header row not recognized — no row in the first 10 matches at least 2 known column names. " +
            "Expected columns like: " +
            Object.entries(FIELDS[kind])
              .filter(([, s]) => s.required)
              .map(([f, s]) => `${f} (${s.synonyms[0]})`)
              .join(", "),
        },
      ],
      warnings: [],
    };
  }
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  if (header.missingRequired.length > 0) {
    errors.push({
      row: header.headerRowIndex + 1,
      message: `Missing required column(s): ${header.missingRequired.join(", ")}`,
    });
    return { kind, headerRowIndex: header.headerRowIndex, columnMap: header.columnMap, rows: [], errors, warnings };
  }

  const specs = FIELDS[kind];
  const rows: MasterRow[] = [];
  const seenCodes = new Map<string, number>(); // externalCode -> first row no.
  for (let r = header.headerRowIndex + 1; r < cells.length; r++) {
    const values: Record<string, string> = {};
    let hasAny = false;
    for (const field of Object.keys(specs)) {
      const c = header.columnMap[field];
      if (c === undefined) continue;
      const v = cellText(cells, r, c);
      if (v) hasAny = true;
      values[field] = v;
    }
    if (!hasAny) continue; // fully empty row — common at sheet tail

    const rowNo = r + 1;
    const missing = Object.entries(specs)
      .filter(([f, s]) => s.required && !values[f])
      .map(([f]) => f);
    if (missing.length > 0) {
      errors.push({ row: rowNo, message: `Missing required value(s): ${missing.join(", ")}` });
      continue;
    }
    const code = values.externalCode;
    const firstRow = seenCodes.get(code);
    if (firstRow !== undefined) {
      errors.push({ row: rowNo, message: `Duplicate code "${code}" (first seen in row ${firstRow})` });
      continue;
    }
    seenCodes.set(code, rowNo);

    // Drop empty optional fields so Prisma writes null, not "".
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
    rows.push(clean as unknown as MasterRow);
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: header.headerRowIndex + 2, message: "No data rows found below the header" });
  }
  return { kind, headerRowIndex: header.headerRowIndex, columnMap: header.columnMap, rows, errors, warnings };
}

// ── Apply-plan derivation (pure — the route persists it) ────────────────

export interface DimensionPlan {
  regions: { code: string; name: string }[];
  channels: { code: string; name: string; channelType: string }[];
  /** rep codes referenced by outlet rows (placeholder reps auto-created). */
  referencedRepCodes: string[];
}

/** Distinct regions/channels/reps referenced by parsed rows, keyed by codeFromName. */
export function deriveDimensionPlan(kind: MasterKind, rows: MasterRow[]): DimensionPlan {
  const regions = new Map<string, string>();
  const channels = new Map<string, string>();
  const repCodes = new Set<string>();
  for (const row of rows) {
    const r = row as Partial<OutletRow & RepRow>;
    if (r.regionName) regions.set(codeFromName(r.regionName), r.regionName);
    if (r.channelName) channels.set(codeFromName(r.channelName), r.channelName);
    if (kind === "master_outlets" && r.repCode) repCodes.add(r.repCode);
  }
  return {
    regions: [...regions.entries()].map(([code, name]) => ({ code, name })),
    channels: [...channels.entries()].map(([code, name]) => ({
      code,
      name,
      channelType: guessChannelType(name),
    })),
    referencedRepCodes: [...repCodes],
  };
}

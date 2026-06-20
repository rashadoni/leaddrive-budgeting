/**
 * Phase C slice C2.1 — per-entity split parser (multi-company-in-one-sheet).
 *
 * A sheet with a business-unit / company column (role `entity`) carries rows
 * for SEVERAL companies. The generic single-company applier would merge them
 * into one undifferentiated stream — and worse, `dedupeParentRollups` would
 * collapse the same leaf code across entities (silent cross-entity collapse).
 *
 * The fix mirrors the proven bespoke `reporting-pack-detail.ts` BU-split:
 * group the sheet's rows by the entity-column value, then run the EXISTING,
 * unit-tested `applyProposal` on each group's synthetic single-entity
 * worksheet — so dedup, control-totals and section-tracking stay ENTITY-LOCAL.
 * No new parse logic is written here; this module only adds the split.
 *
 * Pure — no DB / IO / LLM. The apply route (`apply-multi-entity`) consumes the
 * per-entity ParseResults and routes each to its company in one transaction.
 *
 * Codex-reviewed corruption notes (2026-06-20):
 *   - A blank entity cell on a DATA row is its OWN `""` bucket (surfaced as
 *     `(blank)` upstream) — never silently forward-filled, never dropped.
 *   - `entityValues` is deterministic from the file; the apply route persists
 *     it and re-checks it at commit so a re-upload can't reroute a different
 *     company set than the reviewer approved.
 */
import type * as XLSX from 'xlsx';
import { applyProposal, mergeProposal } from './applier';
import type { ColumnMappingProposal, MappingProposal } from './types';
import type { ParseResult } from '../adapters/azmade-sopl';

// Header-band heuristic — identical to ai-mapper/extract.ts + applier.ts (the
// third intentional copy; keeping it local avoids touching the corruption-
// tested applier just to share ~12 lines).
const HEADER_DETECTION_LIMIT = 20;
const MIN_NON_EMPTY = 3;
const MAX_HEADER_CELL_LEN = 80;

type Cell = string | number | null;

function detectHeaderEndRow(aoa: Cell[][]): number {
  let headerEndRow = Math.min(5, aoa.length);
  for (let r = 0; r < Math.min(HEADER_DETECTION_LIMIT, aoa.length); r++) {
    const row = aoa[r] ?? [];
    const nonEmpty = row.filter((v) => v !== null && v !== undefined && v !== '');
    if (nonEmpty.length < MIN_NON_EMPTY) continue;
    const allStrings = nonEmpty.every((v) => typeof v === 'string');
    if (!allStrings) continue;
    const allShort = nonEmpty.every(
      (v) => typeof v === 'string' && v.length <= MAX_HEADER_CELL_LEN,
    );
    if (!allShort) continue;
    headerEndRow = r + 1;
    break;
  }
  return headerEndRow;
}

/** Normalise an entity cell to a trimmed string; blank → "" (its own bucket). */
function entityKey(v: Cell): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

/**
 * A code cell looks like real account data (vs a header label) when it has a
 * digit — finance codes always contain digits ("PLF.01", "601-04", "BS.02"),
 * header labels never ("Code", "KOD", "BU", "Account"). This is the reliable
 * data-start anchor: `detectHeaderEndRow`'s all-strings heuristic FAILS on
 * sheets whose header row carries numeric cells (e.g. Excel date-serial month
 * headers on the reporting-pack `Actual PLF`), falling back to row 5 and
 * pulling the first data rows into the header band — which, in
 * `applyProposalByEntity`, would replicate them into EVERY entity (verified
 * 2026-06-20 real-file run: AZSF lost 4 rows to cross-entity contamination).
 */
function looksLikeCode(v: Cell): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return s !== '' && /\d/.test(s);
}

/** Source-column index of the `code`-roled column, or -1 when none. */
export function findCodeColumn(columns: ColumnMappingProposal[]): number {
  for (const c of columns) {
    if (c.role === 'code') return c.sourceIndex;
  }
  return -1;
}

/**
 * First row index that carries DATA (a code-like value in the code column).
 * Everything above is the header band. Falls back to the all-strings
 * `detectHeaderEndRow` heuristic when there is no code column.
 */
function firstDataRow(aoa: Cell[][], codeCol: number): number {
  if (codeCol < 0) return detectHeaderEndRow(aoa);
  for (let r = 0; r < aoa.length; r++) {
    if (looksLikeCode((aoa[r] ?? [])[codeCol])) return r;
  }
  return detectHeaderEndRow(aoa);
}

/** A row carries data when any cell OTHER than the entity column is non-empty. */
function rowHasData(row: Cell[], entityColIdx: number): boolean {
  return row.some(
    (c, i) => i !== entityColIdx && c !== null && c !== undefined && c !== '',
  );
}

function readAoa(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): Cell[][] | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  return xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Cell[][];
}

/** Source-column index of the `entity`-roled column, or null when none. */
export function findEntityColumn(columns: ColumnMappingProposal[]): number | null {
  for (const c of columns) {
    if (c.role === 'entity') return c.sourceIndex;
  }
  return null;
}

/**
 * Distinct entity values over the sheet's DATA rows (rows from the first
 * code-bearing row), in first-appearance order. A blank entity cell on a data
 * row is included once as `""`. Cheap scan (no parse) — used to show the
 * reviewer the BU list to map. `codeColIdx` anchors the data start (pass -1 to
 * fall back to the header heuristic); MUST match `applyProposalByEntity`'s
 * anchor so the persisted reviewed set equals the commit-time recompute.
 */
export function extractEntityValues(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entityColIdx: number,
  codeColIdx: number,
  xlsx: typeof XLSX,
): string[] {
  const aoa = readAoa(workbook, sheetName, xlsx);
  if (!aoa) return [];
  const headerEndRow = firstDataRow(aoa, codeColIdx);
  const seen = new Set<string>();
  const order: string[] = [];
  for (let r = headerEndRow; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (!rowHasData(row, entityColIdx)) continue;
    const key = entityKey(row[entityColIdx]);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

export interface EntitySplitResult {
  /** Source-column index used to split. */
  entityColumn: number;
  /** Distinct entity values grouped (first-appearance order). Deterministic. */
  entityValues: string[];
  /** Per-entity parse outcome — same `ParseResult` shape as the single path. */
  perEntity: Array<
    | { entityValue: string; result: ParseResult }
    | { entityValue: string; error: string }
  >;
}

/**
 * Split a sheet by its `entity`-roled column and run `applyProposal` per
 * group. Returns `{ error }` when the proposal (after overrides) has no entity
 * column — caller falls back to the single-company path.
 *
 * Each synthetic worksheet = the original header band + that entity's data
 * rows (full-width, original column positions preserved), so `applyProposal`
 * re-detects headers and reads code/label/month columns exactly as on the
 * source sheet. The entity column itself is ignored by `resolveColumns`.
 */
export function applyProposalByEntity(
  workbook: XLSX.WorkBook,
  sheetName: string,
  proposal: MappingProposal,
  xlsx: typeof XLSX,
  userOverrides?: Partial<MappingProposal>,
  opts: { preferYear?: number; preferCurrency?: string } = {},
): EntitySplitResult | { error: string } {
  const merged = mergeProposal(proposal, userOverrides);
  const entityColumn = findEntityColumn(merged.columns);
  if (entityColumn === null) {
    return { error: 'Proposal has no "entity" column — use the single-company apply path.' };
  }

  const aoa = readAoa(workbook, sheetName, xlsx);
  if (!aoa) return { error: `Sheet "${sheetName}" not found in workbook` };
  if (aoa.length === 0) return { error: 'Sheet is empty' };

  // Anchor the header band on the code column (a digit-bearing code marks the
  // first data row) — NOT the all-strings heuristic, which mis-fires on sheets
  // with numeric (date-serial) month headers and would leak the first entity's
  // data rows into the shared header band, replicating them across all entities.
  const codeCol = findCodeColumn(merged.columns);
  const headerEndRow = firstDataRow(aoa, codeCol);
  const headerBand = aoa.slice(0, headerEndRow);

  // Group data rows by entity value, preserving first-appearance order.
  const order: string[] = [];
  const byEntity = new Map<string, Cell[][]>();
  for (let r = headerEndRow; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (!rowHasData(row, entityColumn)) continue;
    const key = entityKey(row[entityColumn]);
    let rows = byEntity.get(key);
    if (!rows) {
      rows = [];
      byEntity.set(key, rows);
      order.push(key);
    }
    rows.push(row);
  }

  const perEntity: EntitySplitResult['perEntity'] = order.map((entityValue) => {
    const rows = byEntity.get(entityValue)!;
    const synthSheet = xlsx.utils.aoa_to_sheet([...headerBand, ...rows]);
    const synthWb: XLSX.WorkBook = {
      SheetNames: [sheetName],
      Sheets: { [sheetName]: synthSheet },
    } as XLSX.WorkBook;
    // Pass the ORIGINAL proposal + overrides (applyProposal re-merges); the
    // entity-role column is ignored by resolveColumns on every group.
    const result = applyProposal(synthWb, sheetName, proposal, xlsx, userOverrides, opts);
    return 'error' in result
      ? { entityValue, error: result.error }
      : { entityValue, result };
  });

  return { entityColumn, entityValues: order, perEntity };
}

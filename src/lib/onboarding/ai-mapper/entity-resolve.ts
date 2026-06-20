/**
 * Phase C slice C2.2 — entity value → org company resolution.
 *
 * A sheet's distinct entity ("BU") values must each be routed to a Company.
 * The bespoke reporting-pack importer hardcodes this (`REPORTING_PACK_BU_TO_
 * ENTITY`); the generic path can't, so it AUTO-SUGGESTS a company per value and
 * the reviewer confirms/corrects in the UI.
 *
 * Suggestions are INJECTIVE: a company auto-suggested for one value is not
 * suggested for another (the apply route hard-enforces injectivity because two
 * values → one company is a collateral-wipe path — Codex P0-1 2026-06-20). A
 * non-injective auto-suggestion would pre-seed exactly that.
 *
 * Match strength, strongest first across the WHOLE value set (so the strongest
 * claim on a company wins before weaker ones):
 *   1. exact code or name (case-insensitive)
 *   2. a value token equal to the company code (e.g. "AZSF 2026" → AZSF)
 *   3. name substring either direction (min length 4)
 * Blank ("") is never auto-mapped.
 */

export interface CompanyLite {
  id: string;
  code: string;
  name: string;
}

/**
 * Sentinel `entityMap` value meaning "do NOT import this BU" — used for
 * elimination / consolidation / adjustment blocks (EJE/AJE/CONSOLIDATED) that
 * are not standalone companies. A skipped entity is excluded from the write and
 * is NOT required to be mapped (so the all-or-none gate doesn't force the
 * reviewer to send an elimination block to a real company).
 */
export const SKIP_ENTITY = '__SKIP__';

const ELIMINATION_EXACT = new Set([
  'EJE', 'AJE', 'ELIM', 'IC', 'CONS', 'CONSO', 'ADJ', 'ELIMINATION',
  'ELIMINATIONS', 'CONSOLIDATED', 'CONSOLIDATION', 'INTERCOMPANY',
  'ADJUSTMENT', 'ADJUSTMENTS', 'TOTAL', 'GROUP',
]);

/**
 * Heuristic: does a BU value look like an elimination / consolidation / rollup
 * / adjustment block rather than a real operating company? The generic
 * analogue of the bespoke `REPORTING_PACK_SKIP_BU` set. Short codes match
 * EXACTLY (so "IC" doesn't match "ICELAND"); descriptive long forms match as a
 * substring, multilingual (EN/RU/AZ). Advisory only — the reviewer decides;
 * the route just lets them skip.
 */
export function looksLikeEliminationBU(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (v === '') return false;
  if (ELIMINATION_EXACT.has(v)) return true;
  return /elimin|consolidat|inter[\s-]?company|adjustment|rollup|roll-up|консолид|элиминац|корректировк|внутригрупп|устранен|ixtisar|konsolid/i.test(
    value,
  );
}

export interface EntityResolution {
  /** entityValue → companyId for the auto-matched values. */
  suggestions: Record<string, string>;
  /** entityValues with no (injective) suggestion — reviewer must assign. */
  unresolved: string[];
}

const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ');
const tokens = (s: string): string[] =>
  norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);

export function resolveEntityCompanies(
  values: string[],
  companies: CompanyLite[],
): EntityResolution {
  const suggestions: Record<string, string> = {};
  const usedCompanyIds = new Set<string>();

  // Candidate match for a single value at a given strength tier; returns a
  // companyId not yet used, or null.
  const matchExact = (v: string): string | null => {
    const nv = norm(v);
    if (nv === '') return null;
    for (const c of companies) {
      if (usedCompanyIds.has(c.id)) continue;
      if (norm(c.code) === nv || norm(c.name) === nv) return c.id;
    }
    return null;
  };
  const matchCodeToken = (v: string): string | null => {
    const vt = new Set(tokens(v));
    if (vt.size === 0) return null;
    for (const c of companies) {
      if (usedCompanyIds.has(c.id)) continue;
      if (vt.has(norm(c.code))) return c.id;
    }
    return null;
  };
  const matchNameSubstring = (v: string): string | null => {
    const nv = norm(v);
    if (nv.length < 4) return null;
    for (const c of companies) {
      if (usedCompanyIds.has(c.id)) continue;
      const cn = norm(c.name);
      if (cn.length < 4) continue;
      if (nv.includes(cn) || cn.includes(nv)) return c.id;
    }
    return null;
  };

  // Process tier by tier across ALL values so a strong claim wins the company
  // before a weaker one can take it. Within a tier, first-appearance order.
  const remaining = [...values];
  for (const tier of [matchExact, matchCodeToken, matchNameSubstring]) {
    for (const v of remaining) {
      if (v in suggestions) continue;
      const id = tier(v);
      if (id) {
        suggestions[v] = id;
        usedCompanyIds.add(id);
      }
    }
  }

  const unresolved = values.filter((v) => !(v in suggestions));
  return { suggestions, unresolved };
}

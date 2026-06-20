/**
 * Phase C slice C2.2 — entity value → org company resolution tests.
 *
 * The generic analogue of the bespoke `mapReportingPackBu` hardcoded table:
 * auto-suggest a company for each distinct entity ("BU") value so the reviewer
 * only confirms/corrects. Suggestions are INJECTIVE (a company auto-suggested
 * for one value is not auto-suggested for another) — the route hard-enforces
 * injectivity, and a non-injective auto-suggestion would seed a collateral wipe.
 */
import { describe, it, expect } from 'vitest';
import { resolveEntityCompanies } from './entity-resolve';

const COMPANIES = [
  { id: 'c1', code: 'AZSF', name: 'Aze Sheker Farm' },
  { id: 'c2', code: 'EDEN', name: 'Eden Agro' },
  { id: 'c3', code: 'CPC', name: 'CPC Processing' },
];

describe('resolveEntityCompanies', () => {
  it('matches by exact code (case-insensitive)', () => {
    const r = resolveEntityCompanies(['azsf'], COMPANIES);
    expect(r.suggestions['azsf']).toBe('c1');
    expect(r.unresolved).toEqual([]);
  });

  it('matches by exact name (case-insensitive)', () => {
    const r = resolveEntityCompanies(['eden agro'], COMPANIES);
    expect(r.suggestions['eden agro']).toBe('c2');
  });

  it('matches a code token embedded in a longer value', () => {
    const r = resolveEntityCompanies(['AZSF 2026 actual'], COMPANIES);
    expect(r.suggestions['AZSF 2026 actual']).toBe('c1');
  });

  it('leaves an unknown value unresolved (no spurious match)', () => {
    const r = resolveEntityCompanies(['Mystery Unit'], COMPANIES);
    expect(r.suggestions['Mystery Unit']).toBeUndefined();
    expect(r.unresolved).toEqual(['Mystery Unit']);
  });

  it('is injective — a second value matching the same company is left unresolved', () => {
    // Both 'CPC' and 'cpc processing' point at c3; only the first wins.
    const r = resolveEntityCompanies(['CPC', 'cpc processing'], COMPANIES);
    expect(r.suggestions['CPC']).toBe('c3');
    expect(r.suggestions['cpc processing']).toBeUndefined();
    expect(r.unresolved).toContain('cpc processing');
  });

  it('prioritises exact matches over weaker token matches across the whole set', () => {
    // 'EDEN' exact-code-matches c2; 'eden agro region' would token-match c2 too,
    // but exact wins for 'EDEN' and c2 is then used, so the fuzzy one is unresolved.
    const r = resolveEntityCompanies(['eden agro region', 'EDEN'], COMPANIES);
    expect(r.suggestions['EDEN']).toBe('c2');
    expect(r.suggestions['eden agro region']).toBeUndefined();
  });

  it('handles the blank bucket as unresolved (never auto-mapped)', () => {
    const r = resolveEntityCompanies([''], COMPANIES);
    expect(r.suggestions['']).toBeUndefined();
    expect(r.unresolved).toEqual(['']);
  });
});

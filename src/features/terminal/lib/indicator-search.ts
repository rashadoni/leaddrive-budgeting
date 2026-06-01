/**
 * Phase 7 client-feedback #5 (2026-06-01) — intuitive indicator search for
 * HeatMap Panel 2.
 *
 * Client pain: "there are many indicators; to find the per-hectare one I had
 * to hover over them one by one. I need a search in Panel 2 that understands
 * what I want even if the word isn't exact."
 *
 * This matcher filters indicator COLUMNS by a free-text query. It is:
 *   - multilingual — matches against code + nameEn + nameRu + nameAz, so a
 *     user typing in any of EN/RU/AZ finds the indicator regardless of the
 *     UI locale (the per-ha indicators carry "hectare"/"гектар"/"Hektar");
 *   - tolerant of inexact words — exact → prefix → reverse-prefix (handles
 *     Russian declension: "гектару" still matches the stored "гектар") →
 *     substring → character-drift (typos: "margn" → "margin");
 *   - AND across typed words — every whitespace-separated query token must
 *     match somewhere, so "revenue hectare" narrows rather than widens.
 *
 * Pure + side-effect-free — fits the `src/features/terminal/lib/` convention
 * alongside resolve-indicator-label.ts / command-parser.ts. The single-string
 * tiering mirrors CommandBar's `fuzzyScore`, extended to tokens + multi-field.
 */
import type { IndicatorLabelSource } from "./resolve-indicator-label";

/** Score one query token against one already-lowercased target string.
 *  0 = no match, higher = better. Mirrors CommandBar.fuzzyScore tiers but
 *  adds the reverse-prefix tier for morphology (declension/plurals). */
function pairScore(qt: string, s: string): number {
  if (!s || !qt) return 0;
  if (s === qt) return 100;
  if (s.startsWith(qt)) return 70; // typed a prefix of the word ("marg" → "margin")
  if (qt.length >= 3 && qt.startsWith(s)) return 55; // word is a prefix of the typed token ("гектар" ⊂ "гектару")
  if (s.includes(qt)) return 45;
  // Character-drift fallback (typos / dropped letters). Require ≥3 chars so a
  // 1–2 letter token can't subsequence-match half the dictionary.
  if (qt.length >= 3 && isSubsequence(qt, s)) return 20;
  return 0;
}

/** True if every char of `q` appears in `t` in order (not necessarily adjacent). */
function isSubsequence(q: string, t: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Split a label/code into lowercased word tokens (underscore + whitespace). */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s_/]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Best score of `qt` against a target string and each of its tokens. */
function bestAgainstTarget(qt: string, target: string): number {
  const whole = target.toLowerCase();
  let best = pairScore(qt, whole);
  for (const tok of tokenize(target)) {
    const sc = pairScore(qt, tok);
    if (sc > best) best = sc;
  }
  return best;
}

/**
 * Score how well `query` matches an indicator. Returns 0 when any typed word
 * matches none of the indicator's fields (AND semantics), otherwise the sum of
 * each word's best field score (higher = more relevant). A blank query
 * returns 0 — callers treat that as "no filter" and skip filtering entirely.
 */
export function indicatorMatchScore(
  query: string,
  ind: IndicatorLabelSource,
): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;

  // Match pool: code, code with underscores as spaces, and every localized
  // name. de-underscored code lets "per ha" match the AGRO_*_PER_HA tokens.
  const targets = [
    ind.code,
    ind.code.replace(/_/g, " "),
    ind.nameEn,
    ind.nameRu,
    ind.nameAz,
  ].filter((t): t is string => Boolean(t));

  let total = 0;
  for (const qt of qTokens) {
    let bestForToken = 0;
    for (const target of targets) {
      const sc = bestAgainstTarget(qt, target);
      if (sc > bestForToken) bestForToken = sc;
    }
    if (bestForToken === 0) return 0; // this typed word matched nothing → reject
    total += bestForToken;
  }
  return total;
}

/**
 * Filter indicator columns by a free-text query, preserving the original
 * column order (no reshuffle — predictable for the user and stable for the
 * visual baseline). A blank query returns the input array unchanged.
 */
export function filterIndicatorsByQuery<T extends IndicatorLabelSource>(
  query: string,
  indicators: T[],
): T[] {
  if (!query.trim()) return indicators;
  return indicators.filter((ind) => indicatorMatchScore(query, ind) > 0);
}

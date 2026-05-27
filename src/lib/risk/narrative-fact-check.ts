/**
 * Phase 7.O C1 — AI narrative fact-checker.
 *
 * The Variance Explainer system prompt instructs the LLM to "always cite
 * the actual values from inputs". The LLM almost always does — but
 * occasionally a Russian / Azerbaijani narrative drifts: rounding the
 * wrong direction, citing a number that isn't in the inputs, or
 * referencing the wrong period. Those drift cases are exactly what a
 * CFO trusts blindly because the narrative reads fluent and confident.
 *
 * This module is the cheap safety net: pure programmatic regex against
 * the narrative, cross-referenced against the snapshot the explainer
 * was given. NO extra LLM call. NO new dependencies.
 *
 * Design choices:
 *   - Run AFTER the explainer returns. Never blocks the response.
 *   - Return structured flags (severity + claim text + suggestion);
 *     the UI renders them as an inline banner under the narrative.
 *   - Tolerance: numbers within 5% relative or 1 unit absolute are
 *     considered matched. CFO-friendly rounding ("about 12%") never
 *     trips a flag.
 *   - Period references: a narrative citing 2024 when the IV.period is
 *     2026Q1 is flagged — "wrong period" is the classic LLM mistake.
 *
 * Pure module: no DB, no LLM, no I/O. Caller (route + tests) supply
 * the narrative + the same inputs the explainer was given.
 */

import type { VarianceExplainerInput } from "./variance-explainer"

/** Severity of a single fact-check flag. */
export type FactCheckSeverity = "warn" | "info"

/** A single fact-check finding. */
export interface FactCheckFlag {
  /** Why this number / claim was flagged. Human-readable, EN. */
  reason: string
  /** The verbatim slice of the narrative that triggered the flag. */
  claim: string
  /** "warn" = looks fabricated / wrong; "info" = couldn't verify. */
  severity: FactCheckSeverity
  /** Short suggestion the UI surfaces ("check inputs", etc.). */
  suggestion: string
}

export interface FactCheckResult {
  /** All findings in narrative order. Empty array = narrative passed. */
  flags: FactCheckFlag[]
  /** Number of numeric claims we extracted. Lets the UI display "12/14
   *  cited values matched the snapshot". 0 = the narrative was prose only
   *  (rare; the LLM is instructed to cite numbers). */
  totalChecked: number
  /** Numeric claims that matched a known snapshot value. */
  matched: number
}

/**
 * Relative tolerance for numeric matches. A narrative saying "12%" when
 * the actual is 12.3% passes; saying 17% fails. Picked from manual
 * eyeballing of finance prose — finer than this fires on harmless
 * rounding; coarser than this misses real drift.
 */
const RELATIVE_TOLERANCE = 0.05
/**
 * Absolute fallback for tiny values (avoid dividing by ~0). A narrative
 * saying "0.5%" when actual is 0.4% should pass; 0.5 vs 0.001 should
 * fail.
 */
const ABSOLUTE_TOLERANCE = 1

/**
 * Numbers small enough to be statistically meaningless to flag — e.g.
 * "3" appearing in "3 quarters", "2 years". Most narratives have these
 * as adverbial references, not financial claims.
 */
const TRIVIAL_NUMBER_THRESHOLD = 10

/**
 * Flatten an `aggregates` blob into a flat list of (key, number) so we
 * can scan recursively without the caller knowing the shape. Pure.
 */
function flattenNumbers(
  blob: unknown,
  prefix = "",
  out: Array<{ key: string; value: number }> = [],
): Array<{ key: string; value: number }> {
  if (blob === null || blob === undefined) return out
  if (typeof blob === "number" && Number.isFinite(blob)) {
    out.push({ key: prefix || "(root)", value: blob })
    return out
  }
  if (Array.isArray(blob)) {
    blob.forEach((v, i) => flattenNumbers(v, `${prefix}[${i}]`, out))
    return out
  }
  if (typeof blob === "object") {
    for (const [k, v] of Object.entries(blob as Record<string, unknown>)) {
      flattenNumbers(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return out
  }
  return out
}

/**
 * Build the canonical set of "known good" numbers for an indicator-value
 * context. Includes the IV's own value, all resolved formula vars, and
 * every numeric leaf in the aggregates blob.
 *
 * Each number is also stored as a percentage variant (×100) AND a
 * /1000 variant — the LLM commonly cites a ratio as a percent
 * ("margin 0.12" → "margin 12%") or large amounts in thousands. Both
 * are legitimate paraphrases of the same underlying datum.
 */
function buildKnownNumbers(input: {
  result: { value: number }
  resolved: Record<string, number>
  aggregates: Record<string, unknown>
}): number[] {
  const raw: number[] = []
  raw.push(input.result.value)
  for (const v of Object.values(input.resolved)) {
    if (typeof v === "number" && Number.isFinite(v)) raw.push(v)
  }
  for (const { value } of flattenNumbers(input.aggregates)) {
    raw.push(value)
  }
  const expanded = new Set<number>()
  for (const n of raw) {
    if (!Number.isFinite(n)) continue
    expanded.add(n)
    expanded.add(n * 100) // ratio → percent
    expanded.add(n / 100) // percent → ratio
    expanded.add(n * 1000) // K → unit
    expanded.add(n / 1000) // unit → K
    expanded.add(n * 1_000_000) // M → unit
    expanded.add(n / 1_000_000) // unit → M
    expanded.add(-n) // sign flip (variance vs. value)
  }
  return Array.from(expanded)
}

/**
 * Is the candidate close to any known number, allowing for rounding +
 * unit/sign variants?
 */
function isCloseToKnown(candidate: number, knownNumbers: number[]): boolean {
  if (!Number.isFinite(candidate)) return false
  for (const known of knownNumbers) {
    if (!Number.isFinite(known)) continue
    const diff = Math.abs(candidate - known)
    if (diff < ABSOLUTE_TOLERANCE) return true
    const denom = Math.max(Math.abs(candidate), Math.abs(known))
    if (denom > 0 && diff / denom < RELATIVE_TOLERANCE) return true
  }
  return false
}

/**
 * Pull every numeric token from the narrative. Returns the match start
 * index so the UI can highlight, plus the raw token + parsed value.
 *
 * Patterns covered:
 *   - "12.34", "12,345.67", "12 345.67" (Eurodec & US decimals)
 *   - "12%", "-95%", "+3.2%"
 *   - "$1.2M", "₼ 12,345", "AZN 1.2K"
 *   - Negative leading minus: "-187,571,023"
 *
 * Trivially small whole numbers (< 10) are skipped — they're almost
 * always English-grammar refs ("the past 3 quarters", "2 main drivers").
 */
interface ExtractedNumber {
  /** Substring of narrative — the raw matched token. */
  text: string
  /** Parsed numeric value (negative if leading minus). */
  value: number
  /** Was the token a percent? Tightens the tolerance comparison. */
  isPercent: boolean
  /** Start offset inside narrative for UI highlight. */
  index: number
}

const NUMBER_REGEX =
  /(-?)(\d{1,3}(?:[ \s,.]\d{3})*(?:[.,]\d+)?|\d+[.,]\d+|\d+)\s*(%)?/g

function parseNarrativeNumbers(narrative: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = []
  // Reset state (regex is module-scoped).
  NUMBER_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NUMBER_REGEX.exec(narrative)) !== null) {
    const [full, sign, digits, percent] = m
    // Normalise group separators (commas, thin spaces, plain spaces) and
    // detect the decimal separator. European notation uses "," for the
    // decimal — heuristic: if exactly one "," and it's followed by 1-3
    // digits, treat it as the decimal point.
    const cleaned = digits.replace(/[ \s]/g, "")
    let normalised: string
    if (
      cleaned.includes(",") &&
      !cleaned.includes(".") &&
      /,\d{1,3}$/.test(cleaned)
    ) {
      // European decimal
      normalised = cleaned.replace(/\./g, "").replace(",", ".")
    } else {
      // US decimal — strip commas as thousand separators
      normalised = cleaned.replace(/,/g, "")
    }
    const value = parseFloat(normalised) * (sign === "-" ? -1 : 1)
    if (!Number.isFinite(value)) continue
    // Skip tiny standalone ints (likely English grammar)
    if (Math.abs(value) < TRIVIAL_NUMBER_THRESHOLD && !percent) continue
    out.push({
      text: full.trim(),
      value,
      isPercent: percent === "%",
      index: m.index,
    })
  }
  return out
}

/**
 * Pull any 4-digit year token (1900-2099) from the narrative. Used for
 * period-reference checks — a narrative talking about 2024 when the IV
 * is 2026Q1 is suspicious.
 */
function parseNarrativeYears(narrative: string): number[] {
  const matches = narrative.match(/\b(19|20)\d{2}\b/g)
  if (!matches) return []
  return matches.map((s) => parseInt(s, 10)).filter((y) => Number.isFinite(y))
}

/**
 * Parse the year out of an IV period string. Periods are stored as
 *   - "2026Q1" (quarterly)
 *   - "2026-04" (monthly)
 *   - "2026" (annual)
 */
function extractPeriodYear(period: string): number | null {
  const m = period.match(/^(\d{4})/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  return Number.isFinite(y) ? y : null
}

/**
 * Main entrypoint: run the fact-checker over a narrative.
 *
 * @param narrative The LLM-generated text to validate.
 * @param input The same VarianceExplainerInput passed into runExplainer
 *              — supplies the canonical numbers + period.
 * @returns A FactCheckResult: empty `flags` array = clean.
 */
export function verifyNarrative(
  narrative: string,
  input: Pick<VarianceExplainerInput, "result" | "resolved" | "aggregates">,
): FactCheckResult {
  if (typeof narrative !== "string" || narrative.trim() === "") {
    return { flags: [], totalChecked: 0, matched: 0 }
  }
  const knownNumbers = buildKnownNumbers(input)
  const flags: FactCheckFlag[] = []

  // ── 1. Numeric claim verification ────────────────────────────────────
  const extracted = parseNarrativeNumbers(narrative)
  let matched = 0
  for (const num of extracted) {
    if (isCloseToKnown(num.value, knownNumbers)) {
      matched++
      continue
    }
    // The IV's own value is the strongest signal — flag if cited number
    // is wildly different in magnitude. Otherwise treat as "info" (we
    // can't prove fabrication, but the value isn't in the snapshot).
    const sev: FactCheckSeverity =
      Math.abs(num.value) > 1000 || num.isPercent ? "warn" : "info"
    flags.push({
      reason:
        sev === "warn"
          ? `Number ${num.text} does not appear in the indicator snapshot.`
          : `Number ${num.text} could not be matched against inputs (might be a derived calculation).`,
      claim: num.text,
      severity: sev,
      suggestion:
        sev === "warn"
          ? "Verify this number against source data before quoting in a board pack."
          : "Cross-check with the resolved variables panel.",
    })
  }

  // ── 2. Period drift ─────────────────────────────────────────────────
  // The narrative may legitimately mention historical years for context
  // ("growth slowed since 2023"). We only flag years STRICTLY AFTER the
  // IV's period year — claiming 2027 data when the IV is 2026Q1 is
  // never legitimate.
  const ivYear = extractPeriodYear(input.result.period)
  if (ivYear !== null) {
    const yearsInNarrative = parseNarrativeYears(narrative)
    const futureYears = yearsInNarrative.filter((y) => y > ivYear)
    for (const y of futureYears) {
      flags.push({
        reason: `Narrative references future year ${y} but the indicator period is ${input.result.period}.`,
        claim: String(y),
        severity: "warn",
        suggestion:
          "Re-run the explainer — the LLM may have confused forecast horizons.",
      })
    }
  }

  return { flags, totalChecked: extracted.length, matched }
}

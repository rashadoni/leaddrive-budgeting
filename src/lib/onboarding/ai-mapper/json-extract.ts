/**
 * Robust JSON extraction from LLM responses.
 *
 * LLM sometimes wraps JSON in markdown fences, prose, or apologetic
 * intros despite system-prompt instructions. This helper progressively
 * tries to extract a parseable JSON object from anywhere in the text.
 *
 * Algorithm (in order of attempts):
 *   1. Strip ```json / ``` fences and try the trimmed string as-is
 *   2. If it starts with `{`, return it (caller will JSON.parse)
 *   3. Otherwise: enumerate every `{`...`}` substring in the text and try
 *      to JSON.parse each, longest-first. The largest valid JSON wins.
 *
 * Why longest-first: protects against scenarios like
 *   "Here's a thought: {fake} but the real answer is {actual: 1}"
 * where a stray prose-`{...}` before the real JSON would be picked by
 * a naive first-match strategy. By trying longer slices first, we get
 * the actual answer object.
 *
 * Bound: caps candidate enumeration at MAX_CANDIDATES to avoid O(n²)
 * blowup on pathologically nested LLM responses (with hundreds of
 * braces). After cap, returns the original stripped string and lets
 * the caller's JSON.parse produce the diagnostic error.
 *
 * Pure function — no SDK / IO. Unit-testable.
 */

const MAX_CANDIDATES = 500;

export function extractJsonFromText(text: string): string {
  // Stage 1: strip markdown fences.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // Stage 2: starts with `{` — try parsing the whole thing first.
  // If valid, return as-is. If invalid, fall through to brace-walk
  // (handles trailing prose: "{...} let me know if questions").
  if (stripped.startsWith('{')) {
    try {
      JSON.parse(stripped);
      return stripped;
    } catch {
      // fall through
    }
  }

  // Stage 3: enumerate brace pairs and try longest-first.
  const opens: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') opens.push(i);
    else if (ch === '}') closes.push(i);
  }
  if (opens.length === 0 || closes.length === 0) {
    return stripped;
  }

  type Candidate = { start: number; end: number; len: number };
  const candidates: Candidate[] = [];
  outer: for (const o of opens) {
    for (const c of closes) {
      if (c > o) {
        candidates.push({ start: o, end: c, len: c - o });
        if (candidates.length >= MAX_CANDIDATES) break outer;
      }
    }
  }
  candidates.sort((a, b) => b.len - a.len);

  for (const cand of candidates) {
    const slice = stripped.slice(cand.start, cand.end + 1);
    try {
      JSON.parse(slice);
      return slice;
    } catch {
      // try next
    }
  }

  // Give up — return the stripped text so the caller's error message
  // shows what we tried to parse.
  return stripped;
}

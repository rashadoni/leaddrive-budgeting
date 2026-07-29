/**
 * Repair a JSON object that was CUT OFF mid-generation (2026-07-30).
 *
 * The failure this exists for
 * ───────────────────────────
 * Import Doctor asked the model for a six-field JSON explanation under a
 * 900-token cap. In Azerbaijani and Russian a token buys far fewer characters
 * than in English, so the reply ran out of budget mid-sentence and arrived as
 *
 *   {"title":"...","plainExplanation":"...","whyBlocked":"Bu idxal blok
 *
 * `extractJsonFromText` cannot rescue that: it hunts for a `{...}` slice that
 * parses, and a truncated reply has no closing brace anywhere. So the operator
 * saw `Unterminated string in JSON at position 1920` — measured on production
 * 2026-07-29 — with no explanation at all, on the very panel whose job is to
 * explain things.
 *
 * What this does
 * ──────────────
 * Closes what the model left open — terminates a dangling string, drops a
 * trailing comma or half-written key, and appends the missing `]`/`}` — so the
 * fields that DID arrive survive. The tail is genuinely missing and is not
 * invented: the caller is told repair happened (`repaired: true`) so it can
 * say the text was cut short rather than present a stump as complete.
 *
 * Pure, no IO, no SDK.
 */

export interface JsonRepairResult {
  /** Parseable JSON text — the input untouched when it already parsed. */
  text: string
  /** True when characters had to be appended/removed to make it parse. */
  repaired: boolean
}

/** Longest input we will scan. Beyond this the reply is not a doctor payload. */
const MAX_INPUT = 200_000

/**
 * Walk the text tracking string/escape state and the bracket stack, then close
 * whatever is still open at the end.
 *
 * Deliberately a single forward pass rather than a parser: the goal is not to
 * validate the model's output but to make a truncated prefix loadable.
 */
export function repairTruncatedJson(input: string): JsonRepairResult {
  const text = input.trim()
  if (!text) return { text, repaired: false }
  if (text.length > MAX_INPUT) return { text, repaired: false }

  // Already valid — never touch it.
  try {
    JSON.parse(text)
    return { text, repaired: false }
  } catch {
    /* fall through to repair */
  }

  const stack: Array<"{" | "["> = []
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") stack.pop()
  }

  let out = text

  // A string cut mid-word: close it. A trailing lone backslash would escape
  // the quote we are about to add, so drop it first.
  if (inString) {
    if (escaped) out = out.slice(0, -1)
    out += '"'
  }

  // Trim a dangling separator or a key with no value —
  // `{"a":1,` and `{"a":1,"b":` are both unparseable with brackets alone.
  out = out.replace(/[,:]\s*$/, "")

  // `{"a":1,"b"` — a complete key that never got its value.
  //
  // Only INSIDE AN OBJECT. The identical shape inside an array
  // (`["one","two"`) is a finished VALUE, and stripping it would silently
  // discard data the model did manage to send.
  if (stack[stack.length - 1] === "{" && /[,{]\s*"[^"]*"\s*$/.test(out)) {
    out = out.replace(/(,|\{)\s*"[^"]*"\s*$/, (_m, sep: string) =>
      sep === "{" ? "{" : "",
    )
  }
  out = out.replace(/,\s*$/, "")

  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]"
  }

  try {
    JSON.parse(out)
    return { text: out, repaired: true }
  } catch {
    // Unrepairable — hand back the original so the caller's own error names
    // what it actually tried to parse.
    return { text, repaired: false }
  }
}

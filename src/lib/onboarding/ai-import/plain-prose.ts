/**
 * 2026-08-03 — the panel showed a CFO literal asterisks.
 *
 * The Import Doctor's prose fields are rendered as plain text — `{explanation
 * .plainExplanation}` inside a `<p>`, which is correct, because the UI already
 * supplies the heading, the paragraph and the bullet list. The model, told
 * only "return STRICT JSON", filled those fields with **markdown**. React
 * printed it verbatim, so the screen read:
 *
 *     • **Mənfəət-zərər, balans və pul axını vərəqləri** — standart olaraq …
 *
 * asterisks and all, with the bullet characters glued into one paragraph
 * instead of a list. `ImportFlowGuide`'s own header says the screen's job on
 * demo day "is to look like something a CFO would trust with their ledger".
 * Raw markup is the opposite of that.
 *
 * The prompt now asks for plain sentences (the root fix). This is the belt: a
 * model told not to emit markdown still will, occasionally, and the panel must
 * never be the place that finds out.
 *
 * Deliberately NARROW. It removes the four markers that actually appeared and
 * nothing else — no link parsing, no HTML, no table handling. A cleaner that
 * rewrites more than it was asked to is how a currency symbol or an account
 * code ends up mangled on the one screen whose job is to be believed.
 */

/** `**bold**` / `__bold__` → bold. Applied before the single-marker pass. */
const STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g
/**
 * `*italic*` / `_italic_` → italic.
 *
 * Requires a non-space on both inner edges so `2 * 3` and a lone `*` survive,
 * and an underscore is only stripped at a word boundary so `snake_case_code`
 * — which this product is full of — is left exactly as written.
 */
const EM_STAR = /\*(?=\S)([^*\n]*?\S)\*/g
const EM_UNDERSCORE = /\b_(?=\S)([^_\n]*?\S)_\b/g
/** A leading bullet or heading marker on a line the UI already bullets. */
const LEADING_MARKER = /^[ \t]*(?:[-*+•]|#{1,6})[ \t]+/gm

/**
 * Strip the markdown a model emits into a field that is rendered as text.
 *
 * Returns the input unchanged when there is nothing to strip, so a caller can
 * compare identity to detect that the prompt is being ignored.
 */
export function stripMarkdown(text: string): string {
  if (typeof text !== "string" || !text) return text
  return text
    .replace(STRONG, "$2")
    .replace(EM_STAR, "$1")
    .replace(EM_UNDERSCORE, "$1")
    .replace(LEADING_MARKER, "")
    .trim()
}

/** Apply `stripMarkdown` to every string in an array, dropping empties. */
export function stripMarkdownAll(items: readonly string[]): string[] {
  return items.map((s) => stripMarkdown(s)).filter((s) => s.length > 0)
}

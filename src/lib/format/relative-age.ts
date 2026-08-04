/**
 * Relative-age rendering — the one implementation. 2026-08-04.
 *
 * Five surfaces had grown their own copy of «N minutes ago»: the terminal
 * HeatMap header and CompanyTree row chip, the data-sources catalogue, the
 * intel-health dashboard, the drift dashboard, and the background-jobs panel.
 * Each carried its own message keys and its own thresholds, so they disagreed
 * on things a user can see side by side:
 *
 *   - az hours read "{n} s əvvəl" on one page and "{n} saat əvvəl" on four
 *     others ("s" is also the abbreviation for saniyə/second — so the short
 *     one was ambiguous, not just inconsistent);
 *   - three surfaces had a sub-minute "just now", two rendered "0 min ago"
 *     or "0.0 hours ago" instead;
 *   - the drift dashboard had no minutes bucket at all, and switched to days
 *     at 48h for daily sources but immediately for monthly ones;
 *   - the terminal rounded (90s → "2m ago"), everyone else floored.
 *
 * This module owns the buckets and the message namespace; call sites own only
 * the null state, because "never fetched" / "never" / "—" / render-nothing
 * are genuinely different answers to a genuinely different question.
 *
 * ── Do NOT reintroduce Intl.RelativeTimeFormat ──────────────────────────
 * It was tried and reverted the same day (9a1e6f3e). The owner's Chrome has
 * no relative-time ICU data for `az` and silently returns the CLDR root
 * pattern, while `supportedLocalesOf` still reports az as supported:
 *
 *     new Intl.RelativeTimeFormat('az', {numeric:'auto'}).format(-50,'minute')
 *     → "-50 min"          (Node with full ICU: "50 dəqiqə öncə")
 *
 * `supportedLocalesOf(['az'])` answering `['az']` means the locale is known,
 * not that this formatter has data for it. Node has the data, so the bug is
 * invisible locally and ships to the browser. Message keys keep the rendering
 * the app's own, which is why every surface here uses them.
 */

/** Bucket the age falls into. Not a message key on its own — see `format`. */
export type RelativeAgeBucket = "justNow" | "minutes" | "hours" | "days"

/**
 * `long` is prose for admin pages ("5 min ago"). `short` is the compact chip
 * for dense terminal rows ("5m"), where the container is fixed-width and the
 * surrounding label already supplies the "updated"/"ago" sense.
 */
export type RelativeAgeVariant = "long" | "short"

/**
 * Structurally what both `useTranslations(...)` and `await getTranslations(...)`
 * return, narrowed to what this module uses. Keeping it structural means the
 * helper stays pure and unit-testable with a plain stub — no next-intl import,
 * no React, so it runs in a node-environment test.
 */
export type RelativeAgeTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string

/** Namespace the messages live under in `messages/{en,ru,az}.json`. */
export const RELATIVE_AGE_NAMESPACE = "relativeAge"

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

export interface RelativeAgeParts {
  bucket: RelativeAgeBucket
  /** The number to render. Always 0 for `justNow` (the message takes none). */
  n: number
}

/**
 * Floor, not round, at every step. Rounding lets the displayed number leave
 * its own bucket — `Math.round(1439 / 60)` is 24, so a value the classifier
 * calls "hours" renders as "24 h ago", which is a day. Flooring keeps the
 * number and the bucket telling the same story.
 *
 * Fractional input is expected: two call sites hold hours as a float and
 * multiply by 60. Negative input (clock skew, a server clock ahead of the
 * browser's) clamps to `justNow` rather than rendering a negative age.
 */
export function bucketRelativeAge(minutes: number): RelativeAgeParts {
  // A non-finite age can only come from arithmetic on a corrupt timestamp.
  // Callers reach a null state before here for anything unparseable, so this
  // is a guard against throwing inside a render, not a real display path.
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  if (m < 1) return { bucket: "justNow", n: 0 }
  if (m < MINUTES_PER_HOUR) return { bucket: "minutes", n: m }
  if (m < MINUTES_PER_DAY) {
    return { bucket: "hours", n: Math.floor(m / MINUTES_PER_HOUR) }
  }
  return { bucket: "days", n: Math.floor(m / MINUTES_PER_DAY) }
}

/**
 * Render an age in minutes through the caller's translator.
 *
 * `t` must be scoped to `relativeAge` — `useTranslations("relativeAge")` in a
 * client component, `await getTranslations("relativeAge")` on the server.
 */
export function formatRelativeAge(
  minutes: number,
  t: RelativeAgeTranslator,
  variant: RelativeAgeVariant = "long",
): string {
  const { bucket, n } = bucketRelativeAge(minutes)
  const key = `${variant}.${bucket}`
  return bucket === "justNow" ? t(key) : t(key, { n })
}

/**
 * Minutes elapsed since an ISO timestamp, or null when there is nothing to
 * measure — the caller's null state (never / never fetched / — / no chip)
 * is deliberately not this module's business.
 *
 * Fractional on purpose: `bucketRelativeAge` floors, and pre-flooring here
 * would round twice. `nowMs` is injected so callers stay deterministic.
 */
export function minutesSince(
  iso: string | null | undefined,
  nowMs: number,
): number | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return null
  return (nowMs - ts) / 60_000
}

/**
 * Terminal freshness marker — Phase 8 A4, narrowed 2026-08-04.
 *
 * Turns a `computedAt` ISO into the two things the terminal chips need: how
 * old it is, and whether that crosses the 24h staleness line that flips the
 * dot teal→amber (trust-badge convention: live = emerald, known-old = amber).
 *
 * It used to also build the English strings ("5m ago" / "5m"), which the two
 * components then re-parsed with `/^(\d+)([mhd])$/` to pick a message key —
 * a formatter feeding a scanner feeding a formatter. The wording now comes
 * from `formatRelativeAge` in src/lib/format/relative-age.ts, shared with the
 * four admin surfaces; this file keeps only what is terminal-specific.
 *
 * Pure — the caller passes `nowMs`, so it stays deterministic and testable.
 */
import { minutesSince } from "@/lib/format/relative-age";

/** The 24h line. Strictly after, so exactly 24h is "1d ago" but not yet amber. */
const STALE_AFTER_SEC = 86_400;

export interface FreshnessParts {
  /** Age in minutes, fractional — `bucketRelativeAge` does the flooring. */
  ageMinutes: number;
  /** True when older than 24h. */
  isStale: boolean;
}

export function formatFreshness(
  iso: string | null | undefined,
  nowMs: number,
): FreshnessParts | null {
  const minutes = minutesSince(iso, nowMs);
  if (minutes === null) return null;
  // Clamp a future timestamp (clock skew) to 0 before the staleness test, so
  // it reads as fresh rather than wrapping into some other branch.
  const ageMinutes = Math.max(0, minutes);
  return { ageMinutes, isStale: ageMinutes * 60 > STALE_AFTER_SEC };
}

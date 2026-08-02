/**
 * Phase 12 / A07 (2026-08-02) — the one authentication check in this codebase
 * that is not a session.
 *
 * `/api/cron/*` is in the proxy's `publicPaths`, deliberately: a scheduler has
 * no session, and the routes span every organization on purpose. So a Bearer
 * secret is the entire boundary in front of jobs that refresh market feeds and
 * mail a trade digest.
 *
 * Both routes already fail CLOSED when `CRON_SECRET` is unset — 503, refuse to
 * run — which is the right direction and the harder half to get right. What
 * they did was compare with `!==`, which short-circuits on the first differing
 * byte and so leaks, in principle, how much of a guess was correct.
 *
 * Honest about the severity: over HTTP, network jitter swamps the difference,
 * and nobody has demonstrated this class of attack against a JS string compare
 * across a real network. It is fixed because the fix is four lines and the
 * alternative is arguing about it at every audit — not because an exploit is
 * expected.
 */
import { timingSafeEqual } from "node:crypto"

/**
 * Constant-time comparison of an `Authorization` header against the expected
 * `Bearer <secret>`.
 *
 * Length is compared first and non-constant-time, which is deliberate and not
 * a hole: `timingSafeEqual` throws on mismatched lengths, so something must
 * check, and the length of the configured secret is not the secret.
 */
export function bearerMatches(
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false
  const expected = Buffer.from(`Bearer ${secret}`, "utf8")
  const actual = Buffer.from(header, "utf8")
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

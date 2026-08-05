/**
 * 2026-08-04 — one User-Agent for every outbound feed request.
 *
 * Node's global `fetch` identifies itself as `User-Agent: node`, and public
 * data APIs increasingly refuse that outright. Measured against the live
 * endpoints from the production host:
 *
 *     api.worldbank.org   UA `node` → 403,   UA `BudgetPro/1.0` → 200
 *
 * Both World Bank adapters had therefore never succeeded on the server while
 * `curl` from the same box worked, which is what made it read as a transient
 * outage for months. `worldbank-cpi` was fixed first and alone; `wb-indicators`
 * kept failing for exactly the same reason, because the fix was applied to the
 * adapter the error list happened to name instead of to every caller of that
 * API. Hence a shared constant: the next adapter gets this for free.
 *
 * Identify honestly. These are unauthenticated public APIs and the filter is
 * aimed at unattributed scrapers, not at us — so say who we are and how to
 * reach us rather than borrowing a browser's identity.
 */
export const OUTBOUND_USER_AGENT =
  "BudgetPro/1.0 (+https://budget.fo.az) commodity-adapter"

/** Ready-made header bag — `fetch(url, OUTBOUND_FETCH_INIT)`. */
export const OUTBOUND_FETCH_INIT: RequestInit = {
  headers: { "User-Agent": OUTBOUND_USER_AGENT },
}

/** What UN Comtrade's public preview endpoint asks for when it throttles:
 *  `{"statusCode":429,"message":"Rate limit is exceeded. Try again in 1
 *  seconds."}`. Used when the response carries no `Retry-After`. */
const DEFAULT_RETRY_AFTER_MS = 1_100

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One outbound GET, and exactly one retry if the server says it is rate
 * limited.
 *
 * Deliberately one retry, not a backoff loop: this runs inside a scheduled
 * job that already has systemd's `Restart=on-failure` above it, and a feed
 * that is still throttled a second later is better reported than hidden
 * behind a minute of silent waiting. `Retry-After` is honoured when present
 * because the server knows its own quota better than we do.
 *
 * `sleep` is injectable so tests do not actually wait.
 */
export async function fetchWithRateLimitRetry(
  fetchImpl: typeof fetch,
  url: string,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<Response> {
  const first = await fetchImpl(url, OUTBOUND_FETCH_INIT)
  if (first.status !== 429) return first

  const header = first.headers?.get?.("Retry-After")
  const parsed = header ? Number(header) : NaN
  const waitMs =
    Number.isFinite(parsed) && parsed >= 0
      ? Math.min(parsed * 1000, 10_000)
      : DEFAULT_RETRY_AFTER_MS
  await sleep(waitMs)
  return fetchImpl(url, OUTBOUND_FETCH_INIT)
}

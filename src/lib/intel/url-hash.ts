import { createHash } from "node:crypto";

/**
 * SHA-256 of a normalised URL (lowercased + trailing-slash stripped +
 * query-string sorted). Shared by every IntelItem writer so the unique
 * `(organizationId, urlHash)` key remains an idempotency boundary.
 */
export function urlHash(rawUrl: string): string {
  let normalised: string;
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    const sortedSearch = Array.from(u.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    u.search = sortedSearch;
    normalised = u
      .toString()
      .toLowerCase()
      .replace(/\/$/, "");
  } catch {
    // Callers that persist IntelItem rows validate URLs before this helper.
    // Fail-soft retains the historic hash contract for diagnostics/tests.
    normalised = rawUrl.toLowerCase().trim();
  }
  return createHash("sha256").update(normalised).digest("hex");
}

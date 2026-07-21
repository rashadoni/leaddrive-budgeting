/** Free, no-key GDELT DOC 2.1 article-list adapter. */

export const GDELT_DOC_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
export const GDELT_MAX_RESULTS_PER_QUERY = 25;
export const GDELT_TIMEOUT_MS = 15_000;

export type FreeNewsArticle = {
  headline: string;
  url: string;
  domain: string;
  language: string | null;
  /** Provider-declared article publication time, if it is explicitly present. */
  publishedAt: Date | null;
  /** GDELT indexing-observation time (`seendate`), never represented as publish time. */
  observedAt: Date | null;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const candidate = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : value;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseArticle(raw: unknown): FreeNewsArticle | null {
  if (raw === null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const headline = stringOrNull(row.title);
  const rawUrl = stringOrNull(row.url);
  if (!headline || !rawUrl) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;

  const domain = stringOrNull(row.domain)?.toLowerCase() ?? parsedUrl.hostname.toLowerCase();
  const language = stringOrNull(row.language)?.toLowerCase() ?? null;
  // GDELT's standard article-list payload publishes `seendate`, not a source
  // publication timestamp. Keep the two concepts distinct in our contract.
  const publishedAt = parseDate(row.publishedAt ?? row.published_at);
  const observedAt = parseDate(row.seendate);
  return { headline, url: parsedUrl.toString(), domain, language, publishedAt, observedAt };
}

export function buildGdeltDocUrl(query: string, limit = GDELT_MAX_RESULTS_PER_QUERY): string {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    timespan: "7d",
    maxrecords: String(Math.max(1, Math.min(GDELT_MAX_RESULTS_PER_QUERY, Math.floor(limit)))),
  });
  return `${GDELT_DOC_ENDPOINT}?${params.toString()}`;
}

export async function fetchGdeltArticles(
  query: string,
  options: {
    fetchImpl?: FetchLike;
    limit?: number;
    timeoutMs?: number;
  } = {},
): Promise<FreeNewsArticle[]> {
  if (!query.trim()) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? GDELT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(buildGdeltDocUrl(query, options.limit), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GDELT DOC request failed (${response.status})`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("GDELT DOC returned invalid JSON");
    }
    if (payload === null || typeof payload !== "object" || !Array.isArray((payload as { articles?: unknown }).articles)) {
      throw new Error("GDELT DOC returned invalid payload: articles must be an array");
    }
    const effectiveLimit = Math.max(
      1,
      Math.min(GDELT_MAX_RESULTS_PER_QUERY, Math.floor(options.limit ?? GDELT_MAX_RESULTS_PER_QUERY)),
    );
    return (payload as { articles: unknown[] }).articles
      .slice(0, effectiveLimit)
      .map(parseArticle)
      .filter((article): article is FreeNewsArticle => article !== null);
  } finally {
    clearTimeout(timeout);
  }
}

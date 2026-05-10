/**
 * Phase 7.G Turn LXXXXIX (Phase 7.E #1 v2 D.5e) — vendor-agnostic web-search.
 *
 * Mirror of `src/lib/llm/index.ts` factory pattern (LXXXXV) for web-search.
 * Today wraps Anthropic's bundled `web_search_20250305` server tool. Future
 * providers (SearXNG self-hosted per FUTURE_SELF_HOSTED_LLM_MIGRATION.md,
 * Brave Search API at $3/1K) ship as additional impls behind the same
 * interface — 1-line factory swap, zero caller changes.
 *
 * Per LXXXV vendor pick #2: Anthropic-bundled is the active default; abstract
 * for future swap.
 *
 * **Note on integration:** Anthropic's `web_search_20250305` is a SERVER
 * tool — it runs INSIDE the LLM `messages.create` call, not as a separate
 * API. So this provider's `searchWeb()` actually makes the WHOLE LLM call
 * (prompt + tool config) and returns the consumed search results extracted
 * from the response. For SearXNG/Brave (which are pure-search), the impl
 * will return raw search results AND the caller composes a separate LLM
 * call to score/format them.
 *
 * Existing consumer: `src/lib/intel/crawler.ts` — Phase 7.E #1 v1 ships with
 * direct Anthropic call. v2 (LXXXXIX+) refactors to use this factory so
 * SearXNG can be wired without touching crawler.ts.
 */

export type WebSearchHit = {
  url: string
  title: string
  snippet: string
  /** Source identifier (e.g. "anthropic-bundled", "searxng", "brave"). */
  provider: string
  /** Provider-specific publish date (ISO 8601 if available). */
  publishedAt?: string
}

export type WebSearchOptions = {
  /** Max number of hits to return. Provider may cap lower. */
  limit?: number
  /** Time bound (e.g. "past_month"). Provider may ignore. */
  recency?: "past_day" | "past_week" | "past_month" | "past_year" | "all"
  /** Geo bias (ISO country code). Provider may ignore. */
  country?: string
}

export interface WebSearchProvider {
  /** Provider name for telemetry / audit. */
  readonly name: string
  /**
   * Execute a query, return ranked hits. Throws on provider error
   * (caller decides fallback). Empty array (not throw) on legitimate
   * "no results found".
   *
   * NOTE: Anthropic-bundled impl returns hits AS-USED-BY-LLM (the LLM
   * already filtered/scored them), not raw search results. SearXNG/Brave
   * impls will return raw — caller composes separate LLM call to score.
   */
  searchWeb(query: string, opts?: WebSearchOptions): Promise<WebSearchHit[]>
}

/**
 * Anthropic-bundled provider — placeholder/marker. The actual web_search
 * happens INSIDE `crawler.ts` runIntelCrawl's messages.create call (server
 * tool). This impl is a sentinel that documents which provider crawler.ts
 * uses; future SearXNG/Brave impls will have real `searchWeb()` bodies.
 *
 * For tests, AnthropicBundledProvider returns empty array (legitimate "no
 * external search performed by this layer; LLM did it inline").
 */
export class AnthropicBundledWebSearchProvider implements WebSearchProvider {
  readonly name = "anthropic-bundled"

  async searchWeb(_query: string, _opts: WebSearchOptions = {}): Promise<WebSearchHit[]> {
    // Real Anthropic web_search runs inline as a server-tool inside
    // messages.create call (see crawler.ts:280). This method exists
    // for interface conformance + future telemetry; returns empty for
    // direct callers (none currently — crawler.ts uses messages.create
    // directly for cohesion).
    return []
  }
}

/**
 * In-memory provider for tests — returns canned hits via setMockHits.
 */
let mockHits: WebSearchHit[] | null = null

export function setMockWebSearchHits(hits: WebSearchHit[] | null): void {
  mockHits = hits
}

export class InMemoryWebSearchProvider implements WebSearchProvider {
  readonly name = "in-memory"

  async searchWeb(_query: string, opts: WebSearchOptions = {}): Promise<WebSearchHit[]> {
    const hits = mockHits ?? []
    return opts.limit ? hits.slice(0, opts.limit) : hits
  }
}

let instance: WebSearchProvider | null = null

export function getWebSearchProvider(): WebSearchProvider {
  if (instance) return instance

  const provider = process.env.WEB_SEARCH_PROVIDER
  const isProd = process.env.NODE_ENV === "production"

  if (provider === "in-memory" && isProd) {
    throw new Error(
      "WEB_SEARCH_PROVIDER=in-memory not allowed in production. Set WEB_SEARCH_PROVIDER=anthropic-bundled.",
    )
  }

  if (provider === "in-memory") {
    instance = new InMemoryWebSearchProvider()
    return instance
  }

  if (provider === "anthropic-bundled" || provider === undefined || provider === "") {
    instance = new AnthropicBundledWebSearchProvider()
    return instance
  }

  throw new Error(
    `Unknown WEB_SEARCH_PROVIDER='${provider}'. Supported: anthropic-bundled, in-memory.`,
  )
}

export function resetWebSearchProviderForTests(): void {
  instance = null
}

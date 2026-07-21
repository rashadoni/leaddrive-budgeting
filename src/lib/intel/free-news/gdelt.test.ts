import { describe, expect, it, vi } from "vitest";
import {
  GDELT_DOC_ENDPOINT,
  buildGdeltDocUrl,
  fetchGdeltArticles,
} from "./gdelt";

describe("GDELT DOC free adapter", () => {
  it("encodes an exact query and enforces a bounded article-list request", () => {
    const url = new URL(buildGdeltDocUrl('"Eden Agro"', 999));
    expect(`${url.origin}${url.pathname}`).toBe(GDELT_DOC_ENDPOINT);
    expect(url.searchParams.get("query")).toBe('"Eden Agro"');
    expect(url.searchParams.get("mode")).toBe("artlist");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("timespan")).toBe("7d");
    expect(url.searchParams.get("maxrecords")).toBe("25");
  });

  it("also bounds a malformed provider response to the requested safe maximum", async () => {
    const articles = Array.from({ length: 30 }, (_, index) => ({
      title: `Article ${index}`,
      url: `https://example.com/${index}`,
    }));
    const result = await fetchGdeltArticles("query", {
      limit: 999,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ articles }), { status: 200 })),
    });
    expect(result).toHaveLength(25);
  });

  it("retains native headline/url/domain/language and does not mislabel seendate as publishedAt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          articles: [
            {
              title: "Eden Agro opens a new facility",
              url: "https://example.az/news/eden",
              domain: "example.az",
              language: "Azerbaijani",
              publishedAt: "2026-07-20T09:08:07Z",
              seendate: "20260721T101112Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const articles = await fetchGdeltArticles('"Eden Agro"', { fetchImpl });
    expect(articles).toEqual([
      expect.objectContaining({
        headline: "Eden Agro opens a new facility",
        url: "https://example.az/news/eden",
        domain: "example.az",
        language: "azerbaijani",
        publishedAt: new Date("2026-07-20T09:08:07.000Z"),
        observedAt: new Date("2026-07-21T10:11:12.000Z"),
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("drops malformed and non-http article URLs without converting them into evidence", async () => {
    const articles = await fetchGdeltArticles("query", {
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            articles: [
              { title: "bad", url: "not a url" },
              { title: "file", url: "file:///tmp/private" },
              { title: "good", url: "https://example.com/good" },
            ],
          }),
          { status: 200 },
        ),
      ),
    });
    expect(articles.map((article) => article.headline)).toEqual(["good"]);
  });

  it("reports non-JSON and structurally invalid provider payloads", async () => {
    await expect(
      fetchGdeltArticles("query", { fetchImpl: vi.fn().mockResolvedValue(new Response("nope", { status: 200 })) }),
    ).rejects.toThrow("invalid JSON");
    await expect(
      fetchGdeltArticles("query", { fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: [] }), { status: 200 })) }),
    ).rejects.toThrow("articles must be an array");
  });

  it("turns provider status failures into an observable error", async () => {
    await expect(
      fetchGdeltArticles("query", { fetchImpl: vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })) }),
    ).rejects.toThrow("(429)");
  });

  it("aborts a slow free-provider request at the bounded timeout", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by timeout")));
      }),
    );
    await expect(fetchGdeltArticles("query", { fetchImpl, timeoutMs: 1 })).rejects.toThrow("aborted by timeout");
  });
});

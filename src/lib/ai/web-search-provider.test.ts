// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  getWebSearchProvider,
  resetWebSearchProviderForTests,
  setMockWebSearchHits,
  AnthropicBundledWebSearchProvider,
  InMemoryWebSearchProvider,
  type WebSearchHit,
} from "./web-search-provider"

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  resetWebSearchProviderForTests()
  process.env = { ...ORIG_ENV }
  setMockWebSearchHits(null)
})

describe("getWebSearchProvider factory", () => {
  it("defaults to anthropic-bundled when env unset", () => {
    delete process.env.WEB_SEARCH_PROVIDER
    const p = getWebSearchProvider()
    expect(p).toBeInstanceOf(AnthropicBundledWebSearchProvider)
    expect(p.name).toBe("anthropic-bundled")
  })

  it("returns InMemoryWebSearchProvider when env=in-memory (test env)", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "in-memory")
    vi.stubEnv("NODE_ENV", "test")
    const p = getWebSearchProvider()
    expect(p).toBeInstanceOf(InMemoryWebSearchProvider)
    expect(p.name).toBe("in-memory")
  })

  it("throws on in-memory in production (Risk #2 mitigation)", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "in-memory")
    vi.stubEnv("NODE_ENV", "production")
    expect(() => getWebSearchProvider()).toThrow(/not allowed in production/)
  })

  it("throws on unknown provider value", () => {
    vi.stubEnv("WEB_SEARCH_PROVIDER", "made-up")
    expect(() => getWebSearchProvider()).toThrow(/Unknown WEB_SEARCH_PROVIDER/)
  })

  it("returns singleton on second call", () => {
    delete process.env.WEB_SEARCH_PROVIDER
    const a = getWebSearchProvider()
    const b = getWebSearchProvider()
    expect(a).toBe(b)
  })

  it("resetWebSearchProviderForTests breaks singleton", () => {
    delete process.env.WEB_SEARCH_PROVIDER
    const a = getWebSearchProvider()
    resetWebSearchProviderForTests()
    const b = getWebSearchProvider()
    expect(a).not.toBe(b)
  })
})

describe("AnthropicBundledWebSearchProvider", () => {
  it("returns empty array (real search runs inline in LLM messages.create)", async () => {
    const p = new AnthropicBundledWebSearchProvider()
    expect(await p.searchWeb("test query")).toEqual([])
  })
})

describe("InMemoryWebSearchProvider", () => {
  it("returns mock hits when setMockWebSearchHits called", async () => {
    const hits: WebSearchHit[] = [
      { url: "https://x.com", title: "X", snippet: "test", provider: "in-memory" },
      { url: "https://y.com", title: "Y", snippet: "test2", provider: "in-memory" },
    ]
    setMockWebSearchHits(hits)
    const p = new InMemoryWebSearchProvider()
    expect(await p.searchWeb("query")).toEqual(hits)
  })

  it("respects limit option", async () => {
    setMockWebSearchHits([
      { url: "https://1.com", title: "1", snippet: "", provider: "in-memory" },
      { url: "https://2.com", title: "2", snippet: "", provider: "in-memory" },
      { url: "https://3.com", title: "3", snippet: "", provider: "in-memory" },
    ])
    const p = new InMemoryWebSearchProvider()
    const result = await p.searchWeb("q", { limit: 2 })
    expect(result).toHaveLength(2)
  })

  it("returns empty array when no mock set", async () => {
    setMockWebSearchHits(null)
    const p = new InMemoryWebSearchProvider()
    expect(await p.searchWeb("q")).toEqual([])
  })
})

// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XLVIII (Board Deck v2 Turn 2) — HeroSection tests.
 *
 * Locks: org/period eyebrow, AI headline (with fallback), hero
 * metric ("—" when null), 3 lead-in lines from first sentence of
 * each AI paragraph, CTA anchor target, AI attribution footer
 * conditional on narration, ariaLabel.
 *
 * Server component: rendered via React's server-async invocation;
 * vitest setup mocks `next-intl/server` per the global setup so
 * `await getTranslations(...)` resolves to the EXPLICIT_LABELS map.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import type { NarrationOutput } from "@/lib/board-deck/narrate-snapshot";
import type { HoldingComposite } from "@/features/board-deck/lib/holding-composite";

// next-intl/server's `getTranslations` is async; vitest setup mocks
// `next-intl` (client) but we need a separate mock for the server
// path used by HeroSection. Mirrors `export-pptx/handler.test.ts`'s
// approach: stub returns key-tail uppercased + EXPLICIT_LABELS look
// up via the same fallback function.
vi.mock("next-intl/server", async () => {
  const setup = await import("../../../../vitest.setup");
  void setup;
  // Re-derive the EXPLICIT_LABELS lookup the way client-side mock
  // does — but since the setup module exports nothing, we inline a
  // minimal lookup matching what we registered for boardDeck.hero.*.
  const fallback = (key: string, values?: Record<string, unknown>): string => {
    const map: Record<string, string> = {
      "boardDeck.hero.ariaLabel": "Board deck hero",
      "boardDeck.hero.eyebrowSuffix": "Review",
      "boardDeck.hero.fallbackHeadline":
        "{org} · {period} period review",
      "boardDeck.hero.scoreLabel": "Holding composite score / 100",
      "boardDeck.hero.contributingCount":
        "{contributing} of {total} sub-cos scored",
      "boardDeck.hero.cta": "Read full report",
      "boardDeck.hero.aiAttribution":
        "AI-generated · {model} · prompt v{version}",
    };
    const tmpl = map[key] ?? key;
    if (!values) return tmpl;
    return tmpl.replace(/\{(\w+)\}/g, (_, k) =>
      k in values ? String(values[k]) : `{${k}}`,
    );
  };
  return {
    getTranslations: async (_namespace?: string) => fallback,
    getLocale: async () => "en",
  };
});

import { HeroSection } from "./HeroSection";

const ORG = { name: "AZMADE Group MMC" };
const PERIOD = "2026";
const GENERATED_AT = "2026-05-07T10:00:00.000Z";

const HEALTHY_COMPOSITE: HoldingComposite = {
  score: 75,
  contributingCount: 7,
  totalCount: 7,
  band: "green",
};

const NULL_COMPOSITE: HoldingComposite = {
  score: null,
  contributingCount: 0,
  totalCount: 7,
  band: null,
};

const NARRATION: NarrationOutput = {
  headline: "Hospitality recovery offsets industrial drag this period.",
  paragraphs: [
    "Hospitality sub-cos drove 60% of the composite gain. HLTN composite at 78.",
    "Industrial flagship is behind plan. AAC stuck at 38, capex pause needed.",
    "Bring to board: approve AAC capex hold; greenlight HLTN Q2 expansion.",
  ],
  modelName: "claude-sonnet-4-5-20250929",
  promptVersion: "v1",
  usage: { inputTokens: 1500, outputTokens: 700 },
};

async function renderHero(props: Parameters<typeof HeroSection>[0]) {
  // Server components return JSX after async resolution. Await the
  // component invocation to materialize the React tree, then hand
  // to render().
  const tree = await HeroSection(props);
  render(tree as React.ReactElement);
}

describe("HeroSection — happy path (narration present)", () => {
  it("renders with role=region + aria-label", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const section = screen.getByTestId("board-deck-hero");
    expect(section.getAttribute("aria-label")).toBe("Board deck hero");
  });

  it("renders the AI headline as load-bearing h1", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const headline = screen.getByTestId("hero-headline");
    expect(headline.textContent).toBe(NARRATION.headline);
    expect(headline.tagName).toBe("H1");
  });

  it("renders eyebrow row with org + period + suffix", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const section = screen.getByTestId("board-deck-hero");
    expect(section.textContent).toContain("AZMADE Group MMC");
    expect(section.textContent).toContain("2026");
    expect(section.textContent).toContain("Review");
  });

  it("renders hero metric as the composite score", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const score = screen.getByTestId("hero-score");
    expect(score.textContent).toBe("75");
  });

  it("renders 3 lead-in lines from first sentence of each AI paragraph", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const leads = screen.getByTestId("hero-lead-ins");
    const items = leads.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain(
      "Hospitality sub-cos drove 60% of the composite gain.",
    );
    expect(items[1].textContent).toContain(
      "Industrial flagship is behind plan.",
    );
    expect(items[2].textContent).toContain(
      "Bring to board: approve AAC capex hold; greenlight HLTN Q2 expansion.",
    );
    // Lead-ins should NOT include the second-sentence content.
    expect(items[0].textContent).not.toContain("HLTN composite at 78");
  });

  it("CTA anchors to #full-report", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const cta = screen.getByTestId("hero-cta");
    expect(cta.getAttribute("href")).toBe("#full-report");
    expect(cta.textContent).toContain("Read full report");
  });

  it("AI attribution footer surfaces model + promptVersion", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const attr = screen.getByTestId("hero-ai-attribution");
    expect(attr.textContent).toContain("claude-sonnet-4-5-20250929");
    expect(attr.textContent).toContain("v1");
  });

  it("contributing-count helper renders X of Y when score is non-null", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: NARRATION,
    });
    const section = screen.getByTestId("board-deck-hero");
    expect(section.textContent).toContain("7 of 7 sub-cos scored");
  });
});

describe("HeroSection — graceful degradation (narration null)", () => {
  it("falls back to '{org} · {period} period review' headline", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: null,
    });
    const headline = screen.getByTestId("hero-headline");
    expect(headline.textContent).toBe(
      "AZMADE Group MMC · 2026 period review",
    );
  });

  it("suppresses lead-in lines when no narration source", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: null,
    });
    expect(screen.queryByTestId("hero-lead-ins")).toBeNull();
  });

  it("suppresses AI attribution footer when no narration source", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: null,
    });
    expect(screen.queryByTestId("hero-ai-attribution")).toBeNull();
  });

  it("CTA still renders (graceful) when narration is null", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: null,
    });
    expect(screen.getByTestId("hero-cta")).toBeTruthy();
  });
});

describe("HeroSection — null composite (no data)", () => {
  it("renders '—' for the hero metric when score is null", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: NULL_COMPOSITE,
      narration: NARRATION,
    });
    const score = screen.getByTestId("hero-score");
    expect(score.textContent).toBe("—");
  });

  it("suppresses contributing-count line when score is null (don't say '0 of 7')", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: NULL_COMPOSITE,
      narration: NARRATION,
    });
    const section = screen.getByTestId("board-deck-hero");
    expect(section.textContent).not.toContain("of 7 sub-cos scored");
  });
});

describe("HeroSection — first-sentence helper edge cases", () => {
  it("strips full sentence including terminator from a paragraph with multiple sentences", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: {
        ...NARRATION,
        paragraphs: [
          "First. Second. Third.",
          "Single.",
          "First sentence! Second.",
        ],
      },
    });
    const items = screen
      .getByTestId("hero-lead-ins")
      .querySelectorAll("li");
    expect(items[0].textContent).toContain("First.");
    expect(items[0].textContent).not.toContain("Second");
    expect(items[1].textContent).toContain("Single.");
    expect(items[2].textContent).toContain("First sentence!");
    expect(items[2].textContent).not.toContain("Second");
  });

  it("appends '.' when paragraph has no sentence terminator", async () => {
    await renderHero({
      org: ORG,
      period: PERIOD,
      generatedAt: GENERATED_AT,
      composite: HEALTHY_COMPOSITE,
      narration: {
        ...NARRATION,
        paragraphs: ["No period here", "Has period.", "Has bang!"],
      },
    });
    const items = screen
      .getByTestId("hero-lead-ins")
      .querySelectorAll("li");
    expect(items[0].textContent).toContain("No period here.");
  });
});

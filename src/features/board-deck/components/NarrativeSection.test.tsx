// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LI (Board Deck v2 Turn 4) — NarrativeSection tests.
 *
 * Locks: 3 paragraphs render in order, attribution carries model +
 * prompt version + generatedAt timestamp, suppression when narration
 * is null (graceful degradation).
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { NarrationOutput } from "@/lib/board-deck/narrate-snapshot";
import { NarrativeSection } from "./NarrativeSection";

// Phase 7.G Turn LIII — NarrativeLanguagePicker is mounted inline in
// the NarrativeSection eyebrow row; it consumes next/navigation hooks
// that throw outside an App Router context. Mock them with no-op
// stubs so the picker renders in tests without driving its behavior
// (covered separately in NarrativeLanguagePicker.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/budgeting/board-deck",
}));

afterEach(() => {
  cleanup();
});

const NARRATION: NarrationOutput = {
  headline: "Industrial drag this period.",
  paragraphs: [
    "Para 1: drivers — hospitality recovery offsets industrial drag.",
    "Para 2: risk concentration — 14 of 18 red cells in industrial corridor.",
    "Para 3: board recommendations — approve AAC capex hold, greenlight HLTN expansion.",
  ],
  modelName: "claude-sonnet-4-5-20250929",
  promptVersion: "v1",
  usage: { inputTokens: 1500, outputTokens: 700 },
};

const GENERATED_AT = "2026-05-07T10:00:00.000Z";

async function renderSection(
  narration: NarrationOutput | null,
  generatedAt = GENERATED_AT,
  currentLanguage: "en" | "ru" | "az" = "en",
) {
  const tree = await NarrativeSection({
    narration,
    generatedAt,
    currentLanguage,
  });
  if (tree === null) return null;
  render(tree as React.ReactElement);
  return tree;
}

describe("NarrativeSection — happy path", () => {
  it("renders aria-label + 3 paragraphs in order", async () => {
    await renderSection(NARRATION);
    const section = screen.getByTestId("board-deck-narrative-full");
    expect(section.getAttribute("aria-label")).toBe("Executive narrative");
    const paragraphs = screen
      .getByTestId("narrative-paragraphs")
      .querySelectorAll("p");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].textContent).toBe(NARRATION.paragraphs[0]);
    expect(paragraphs[1].textContent).toBe(NARRATION.paragraphs[1]);
    expect(paragraphs[2].textContent).toBe(NARRATION.paragraphs[2]);
  });

  it("renders attribution with model + version + truncated ISO timestamp", async () => {
    await renderSection(NARRATION);
    const attr = screen.getByTestId("narrative-attribution");
    expect(attr.textContent).toContain("claude-sonnet-4-5-20250929");
    expect(attr.textContent).toContain("v1");
    // Timestamp format: ISO with T→space + .ms→stripped + Z
    expect(attr.textContent).toContain("2026-05-07 10:00:00Z");
  });
});

describe("NarrativeSection — graceful degradation", () => {
  it("returns null when narration is null (suppresses entire section)", async () => {
    const result = await renderSection(null);
    expect(result).toBeNull();
    expect(screen.queryByTestId("board-deck-narrative-full")).toBeNull();
  });
});

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import enMessages from "../../../messages/en.json"
import ruMessages from "../../../messages/ru.json"
import azMessages from "../../../messages/az.json"

type GuideScene = {
  voice: Record<"az" | "en" | "ru", string>
  do: (...args: unknown[]) => Promise<void>
}
type GuideScenario = { route: string; scenes: GuideScene[] }
let boardDeck: GuideScenario

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

beforeAll(async () => {
  const module = (await import(
    pathToFileURL(resolve(process.cwd(), "video/scenarios/overrides.mjs")).href
  )) as { default: Record<string, GuideScenario> }
  boardDeck = module.default["board-deck"]
})

describe("Board Deck evidence-boundary help-video scenario", () => {
  it("keeps Board Deck EN/RU/AZ message parity", () => {
    const en = flattenKeys(enMessages.terminal.boardDeck).sort()
    expect(flattenKeys(ruMessages.terminal.boardDeck).sort()).toEqual(en)
    expect(flattenKeys(azMessages.terminal.boardDeck).sort()).toEqual(en)
  })

  it("provides a substantial ten-scene trilingual walkthrough", () => {
    expect(boardDeck.route).toBe("/budgeting/board-deck")
    expect(boardDeck.scenes).toHaveLength(10)
    for (const language of ["az", "en", "ru"] as const) {
      const wordCounts = boardDeck.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...wordCounts)).toBeGreaterThanOrEqual(35)
      expect(wordCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(400)
    }
  })

  it("is strictly hover-only and cannot activate paid AI or exports", () => {
    for (const scene of boardDeck.scenes) {
      const action = scene.do.toString()
      expect(action).toMatch(/h\.(?:hover|moveTo)\(/)
      expect(action).not.toContain("safeClick")
      expect(action).not.toContain("h.click")
      expect(action).not.toContain("h.fill")
      expect(action).not.toContain("selectOption")
      expect(action).not.toMatch(/\bp\.(?:click|fill|type|press|evaluate)\s*\(/)
      expect(action).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
    }
  })

  it("pins anchors that remain present with empty data and no cached narrative", () => {
    const sources = [
      "src/app/(dashboard)/budgeting/board-deck/page.tsx",
      "src/features/board-deck/components/HeroSection.tsx",
      "src/features/board-deck/components/NarrationControls.tsx",
      "src/features/board-deck/components/CompositeTrendChart.tsx",
      "src/features/board-deck/components/TopAlertsSection.tsx",
      "src/features/board-deck/components/RiskFlagsSection.tsx",
      "src/features/board-deck/components/FooterActions.tsx",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n")
    for (const anchor of [
      "board-deck-guide-root",
      "board-deck-hero",
      "hero-score-caption",
      "board-deck-guide-evidence",
      "board-deck-guide-ai-boundary",
      "board-deck-metrics-row",
      "composite-trend-chart",
      "board-deck-top-alerts",
      "board-deck-risk-flags",
      "board-deck-footer-actions",
    ]) expect(sources).toContain(anchor)
  })

  it("locks cache-only GETs, explicit manager POST, and subgroup scope", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/budgeting/board-deck/page.tsx"), "utf8")
    const pptx = readFileSync(resolve(process.cwd(), "src/app/api/budgeting/board-deck/export-pptx/route.ts"), "utf8")
    const post = readFileSync(resolve(process.cwd(), "src/app/api/budgeting/board-deck/narration/route.ts"), "utf8")
    const pdf = readFileSync(resolve(process.cwd(), "src/app/api/budgeting/board-deck/export-pdf/route.ts"), "utf8")
    expect(page).toContain("getCachedNarration")
    expect(page).toContain("getCompanyScope")
    expect(page).not.toContain("getOrCreateNarration")
    expect(pptx).toContain("getCachedNarration")
    expect(pptx).toContain("getCompanyScope")
    expect(pptx).not.toContain("getOrCreateNarration")
    expect(pptx).not.toMatch(/all systems green/i)
    expect(post).toContain('requireRole(req, "manager")')
    expect(post).toContain("body.userInitiated !== true")
    expect(post.indexOf("body.userInitiated !== true")).toBeLessThan(post.indexOf("hasAnthropicKeyForOrg("))
    expect(post).toContain("getCompanyScope")
    expect(post).toContain("getOrCreateNarration")
    expect(pdf).toContain("process.env.NEXTAUTH_URL")
    expect(pdf).not.toContain('req.headers.get("host")')
  })
})

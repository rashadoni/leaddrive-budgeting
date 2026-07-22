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

type GuideScenario = {
  route: string
  scenes: GuideScene[]
}

let comparison: GuideScenario

beforeAll(async () => {
  const module = (await import(pathToFileURL(resolve(process.cwd(), "video/scenarios/overrides.mjs")).href)) as {
    default: Record<string, GuideScenario>
  }
  comparison = module.default.comparison
})

describe("Comparison help-video scenario", () => {
  it("keeps Comparison message keys in EN/RU/AZ parity", () => {
    const keys = (messages: typeof enMessages) => Object.keys(messages.budgeting).filter((key) => key.startsWith("comp")).sort()
    expect(keys(ruMessages)).toEqual(keys(enMessages))
    expect(keys(azMessages)).toEqual(keys(enMessages))
  })

  it("has substantial trilingual narration on the real Comparison tab", () => {
    expect(comparison.route).toBe("/budgeting?tab=comparison")
    expect(comparison.scenes).toHaveLength(9)
    for (const language of ["az", "en", "ru"] as const) {
      const words = comparison.scenes.map((scene) => scene.voice[language].trim().split(/\s+/).length)
      expect(Math.min(...words)).toBeGreaterThanOrEqual(35)
      expect(words.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(350)
    }
  })

  it("uses only the compatible populated guide pair", () => {
    const actions = comparison.scenes.map((scene) => scene.do.toString()).join("\n")
    const targets = Array.from(actions.matchAll(/h\.safeClick\(([^)]+)\)/g)).map((match) => match[1])
    expect(targets).toEqual(["CMP_PRIMARY", "CMP_SECONDARY"])
    expect(actions).not.toContain("h.click(")
    expect(actions).not.toContain("h.fill(")
    expect(actions).not.toContain("selectOption")
    expect(actions).not.toMatch(/DELETE|POST|PUT|PATCH|RESET|CREATE|APPROV/i)
  })

  it("pins evidence, basis, content and READONLY guide anchors", () => {
    const source = readFileSync(resolve(process.cwd(), "src/features/budgeting/components/ComparisonTab.tsx"), "utf8")
    for (const anchor of [
      "comparison-guide-root",
      "comparison-provenance",
      "comparison-currency-known",
      "comparison-currency-unknown",
      "comparison-plan-picker",
      "comparison-plan-option-",
      "comparison-basis",
      "comparison-loading",
      "comparison-error",
      "comparison-kpis",
      "comparison-category-chart",
      "comparison-opex-totals",
      "comparison-materiality-controls",
      "comparison-materiality-pct",
      "comparison-materiality-amount",
      "comparison-materiality-toggle",
      "comparison-actuals-absence",
      "comparison-table",
    ]) expect(source).toContain(anchor)
  })

  it("locks category identity, like-for-like basis, absence semantics and OpEx totals", () => {
    const component = readFileSync(resolve(process.cwd(), "src/features/budgeting/components/ComparisonTab.tsx"), "utf8")
    const helper = readFileSync(resolve(process.cwd(), "src/lib/budgeting/comparison-view.ts"), "utf8")
    const page = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/budgeting/page.tsx"), "utf8")
    expect(component).toContain("comparisonCategoryKey(c) === cat.key")
    expect(component).toContain('resolveLineTypeActualTotal(a, "expense")')
    expect(component).toContain("a.totalExpensePlanned - actualEvidence.amount")
    expect(component).toContain("amount(planSummaries[i].actual)")
    expect(component).not.toMatch(/totalVariance\s*\/\s*(?:a\.)?totalPlanned/)
    expect(helper).toContain("code:${code}||${row.lineType}")
    expect(helper).toContain("plansAreComparable")
    expect(page).not.toMatch(/COMPANY_FILTERED_TABS[^\]]*comparison/)
  })
})

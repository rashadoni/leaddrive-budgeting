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

let balanceSheet: GuideScenario

beforeAll(async () => {
  const url = pathToFileURL(resolve(process.cwd(), "video/scenarios/overrides.mjs")).href
  const module = (await import(url)) as { default: Record<string, GuideScenario> }
  balanceSheet = module.default["balance-sheet"]
})

describe("Balance Sheet help-video scenario", () => {
  it("keeps Balance Sheet message keys in EN/RU/AZ parity", () => {
    const keys = (messages: typeof enMessages) =>
      Object.keys(messages.budgeting).filter((key) => key.startsWith("balanceSheet")).sort()

    expect(keys(ruMessages)).toEqual(keys(enMessages))
    expect(keys(azMessages)).toEqual(keys(enMessages))
  })

  it("has a substantial trilingual narration on the exact Balance Sheet tab", () => {
    expect(balanceSheet.route).toBe("/budgeting?tab=balance-sheet")
    expect(balanceSheet.scenes).toHaveLength(9)

    for (const language of ["az", "en", "ru"] as const) {
      const counts = balanceSheet.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...counts)).toBeGreaterThanOrEqual(35)
      expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(350)
    }
  })

  it("uses only the six reviewed local section toggles", () => {
    const actions = balanceSheet.scenes.map((scene) => scene.do.toString()).join("\n")
    const targets = Array.from(actions.matchAll(/h\.safeClick\(([^)]+)\)/g)).map(
      (match) => match[1],
    )

    expect(targets).toEqual([
      "BS_ASSETS_TOGGLE",
      "BS_ASSETS_TOGGLE",
      "BS_LIABILITIES_TOGGLE",
      "BS_LIABILITIES_TOGGLE",
      "BS_EQUITY_TOGGLE",
      "BS_EQUITY_TOGGLE",
    ])
    expect(actions).not.toContain("h.click(")
    expect(actions).not.toContain("h.fill(")
    expect(actions).not.toMatch(/safeClick\([^)]*(IMPORT|INPUT|AI|PLAN)/i)
    expect(actions).not.toContain(".catch(() => {})")
  })

  it("pins every Balance Sheet evidence and interaction anchor", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/budget-balance-sheet.tsx"),
      "utf8",
    )

    for (const anchor of [
      "balance-sheet-guide-root",
      "balance-sheet-provenance",
      "balance-sheet-consolidated",
      "balance-sheet-edit-warning",
      "balance-sheet-kpis",
      "balance-sheet-kpi-assets",
      "balance-sheet-kpi-liabilities",
      "balance-sheet-kpi-equity",
      "balance-sheet-kpi-debt-equity",
      "balance-sheet-structure-chart",
      "balance-sheet-asset-composition",
      "balance-sheet-detail",
      "balance-sheet-section-assets",
      "balance-sheet-section-liabilities",
      "balance-sheet-section-equity",
      "balance-sheet-empty",
      "balance-sheet-error",
      "balance-sheet-import",
    ]) {
      expect(source).toContain(anchor)
    }
  })

  it("does not publish a help-video asset before reviewed media exists", async () => {
    const { getHelpVideoForPath } = await import("./video-assets")
    expect(getHelpVideoForPath("/budgeting", "tab=balance-sheet")).toBeNull()
  })
})

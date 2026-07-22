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

let forecast: GuideScenario

beforeAll(async () => {
  const url = pathToFileURL(
    resolve(process.cwd(), "video/scenarios/overrides.mjs"),
  ).href
  const module = (await import(url)) as {
    default: Record<string, GuideScenario>
  }
  forecast = module.default.forecast
})

describe("Forecast help-video scenario", () => {
  it("keeps Forecast message keys in EN/RU/AZ parity", () => {
    const relevantKeys = (messages: typeof enMessages) =>
      Object.keys(messages.budgeting)
        .filter((key) => key.startsWith("forecast") || key.startsWith("fc"))
        .sort()

    expect(relevantKeys(ruMessages)).toEqual(relevantKeys(enMessages))
    expect(relevantKeys(azMessages)).toEqual(relevantKeys(enMessages))
  })

  it("has substantial trilingual narration on the real Forecast tab", () => {
    expect(forecast.route).toBe("/budgeting?tab=forecast")
    expect(forecast.scenes).toHaveLength(9)

    for (const language of ["az", "en", "ru"] as const) {
      const sceneWords = forecast.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...sceneWords)).toBeGreaterThanOrEqual(35)
      expect(sceneWords.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(350)
    }
  })

  it("clicks only reviewed local scenario and section controls", () => {
    const actions = forecast.scenes.map((scene) => scene.do.toString()).join("\n")
    const targets = Array.from(actions.matchAll(/h\.safeClick\(([^)]+)\)/g)).map(
      (match) => match[1],
    )

    expect(targets).toEqual([
      "FC_OPTIMISTIC",
      "FC_PESSIMISTIC",
      "FC_BASE",
      "FC_REVENUE",
      "FC_REVENUE",
      "FC_COGS",
      "FC_COGS",
      "FC_EXPENSE",
      "FC_EXPENSE",
    ])
    expect(actions).not.toContain("h.click(")
    expect(actions).not.toContain("h.fill(")
    expect(actions).not.toMatch(/safeClick\([^)]*(SETTINGS|INPUT|ADD|SAVE|AI)/i)
  })

  it("pins the source, formula, and READONLY guide anchors", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/budgeting/components/ForecastTab.tsx"),
      "utf8",
    )

    for (const anchor of [
      "forecast-guide-root",
      "forecast-loading",
      "forecast-error",
      "forecast-empty",
      "forecast-provenance",
      "forecast-currency-unknown",
      "forecast-currency-known",
      "forecast-scenario-controls",
      "forecast-scenario-base",
      "forecast-scenario-optimistic",
      "forecast-scenario-pessimistic",
      "forecast-settings-toggle",
      "forecast-settings-panel",
      "forecast-kpis",
      "forecast-kpi-revenue",
      "forecast-kpi-cogs",
      "forecast-kpi-expense",
      "forecast-kpi-ebitda",
      "forecast-monthly-trend",
      "forecast-scenario-comparison",
      "forecast-pnl-summary",
      "forecast-pnl-ebitda",
      "forecast-matrix",
      "forecast-matrix-gross-profit",
      "forecast-matrix-ebitda",
      "forecast-section-revenue",
      "forecast-section-cogs",
      "forecast-section-expense",
    ]) {
      expect(source).toContain(anchor)
    }
  })

  it("keeps plan fallback and all displayed P&L surfaces on canonical helpers", () => {
    const component = readFileSync(
      resolve(process.cwd(), "src/features/budgeting/components/ForecastTab.tsx"),
      "utf8",
    )
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(dashboard)/budgeting/page.tsx"),
      "utf8",
    )

    expect(component).toContain("resolveForecastCell(saved")
    expect(component).toContain("const getMonthlyPnl")
    expect(component.match(/getMonthlyPnl\(m\)/g)?.length).toBeGreaterThanOrEqual(5)
    expect(page).not.toMatch(/COMPANY_FILTERED_TABS[^\]]*forecast/)
    expect(page).toContain("<ForecastTab planId={resolvedPlanId} />")
  })

  it("keeps narration synchronized with the scenario state it activates", () => {
    const actions = forecast.scenes.map((scene) => scene.do.toString())
    expect(actions[2]).not.toContain("safeClick(FC_")
    expect(actions[3]).toContain("safeClick(FC_OPTIMISTIC)")
    expect(actions[4]).toContain("safeClick(FC_PESSIMISTIC)")
    expect(actions[5]).toContain("safeClick(FC_BASE)")
    expect(actions[5].match(/safeClick\(FC_REVENUE\)/g)).toHaveLength(1)
    expect(actions[6]).toContain("safeClick(FC_REVENUE)")
    expect(actions[6]).toContain("safeClick(FC_COGS)")
    expect(actions[7]).toContain("safeClick(FC_COGS)")
    expect(actions[7]).toContain("safeClick(FC_EXPENSE)")
    expect(actions[8]).toContain("safeClick(FC_EXPENSE)")
    expect(forecast.scenes[3].voice.en).toMatch(/switch to Optimistic/i)
    expect(forecast.scenes[4].voice.en).toMatch(/switch to Pessimistic/i)
    expect(forecast.scenes[5].voice.en).toMatch(/return to Base/i)
  })
})

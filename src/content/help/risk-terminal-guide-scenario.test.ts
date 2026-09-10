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
let terminal: GuideScenario

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
  terminal = module.default["risk-terminal"]
})

describe("Risk Terminal help-video scenario", () => {
  it("keeps the complete Terminal message tree in EN/RU/AZ key parity", () => {
    const en = flattenKeys(enMessages.terminal).sort()
    expect(flattenKeys(ruMessages.terminal).sort()).toEqual(en)
    expect(flattenKeys(azMessages.terminal).sort()).toEqual(en)
  })

  it("has substantial trilingual narration on the real Expert route", () => {
    expect(terminal.route).toBe("/budgeting/terminal")
    expect(terminal.scenes).toHaveLength(9)
    for (const language of ["az", "en", "ru"] as const) {
      const words = terminal.scenes.map((scene) =>
        scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...words)).toBeGreaterThanOrEqual(35)
      expect(words.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(350)
    }
  })

  it("clicks only the reviewed company and evidence-cell selections", () => {
    const actions = terminal.scenes.map((scene) => scene.do.toString()).join("\n")
    const targets = Array.from(actions.matchAll(/h\.safeClick\(([^)]+)\)/g)).map(
      (match) => match[1],
    )
    expect(targets).toEqual(["TERM_COMPANY", "TERM_CELL"])
    expect(actions).not.toContain("h.fill(")
    expect(actions).not.toContain("selectOption")
    expect(actions).not.toMatch(/safeClick\([^)]*(EXPLAIN|RECOMPUTE|SIGNAL|AUDIT|MARKET)/i)
    expect(actions).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
  })

  it("pins stable overview and drill-down anchors", () => {
    const files = [
      "src/app/(dashboard)/budgeting/terminal/page.tsx",
      "src/features/terminal/components/PanelGrid.tsx",
      "src/features/terminal/components/CompanyTree.tsx",
      "src/features/terminal/components/heat-map/HeatMapCellTd.tsx",
      "src/features/terminal/components/IndicatorDetail.tsx",
      "src/features/terminal/components/AuditTicker.tsx",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n")

    for (const anchor of [
      "terminal-guide-root",
      "terminal-expert-workspace",
      "terminal-panel-${id}",
      "terminal-toolbar-compact-toggle",
      "terminal-company-tree",
      "data-company-code",
      "data-indicator-code",
      "indicator-detail-result",
      "audit-ticker",
    ]) expect(files).toContain(anchor)
  })

  it("requires explicit user intent before any paid Variance Explainer path", () => {
    const todayBrief = readFileSync(
      resolve(process.cwd(), "src/features/terminal/components/TodayBrief.tsx"),
      "utf8",
    )
    const cell = readFileSync(
      resolve(process.cwd(), "src/features/terminal/components/heat-map/HeatMapCellTd.tsx"),
      "utf8",
    )
    const panel = readFileSync(
      resolve(process.cwd(), "src/features/terminal/components/VarianceExplainerPanel.tsx"),
      "utf8",
    )
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/indicators/values/[id]/explain/route.ts"),
      "utf8",
    )

    expect(todayBrief).not.toContain("preWarmedRef")
    expect(todayBrief).not.toContain("terminal:run-explainer")
    expect(cell).not.toContain("fetchAISummary")
    expect(cell).not.toContain("onPointerEnter")
    expect(panel).toContain("userInitiated: true")
    expect(panel).not.toContain("terminal:run-explainer")
    const intentGate = route.indexOf("body.userInitiated !== true")
    expect(intentGate).toBeGreaterThan(0)
    expect(intentGate).toBeLessThan(route.indexOf("hasAnthropicKeyForOrg("))
    expect(intentGate).toBeLessThan(route.indexOf("enforceRateLimit("))
    expect(intentGate).toBeLessThan(route.indexOf("prisma.organization.findUnique"))
  })

  it("never invents AZN when the organization has no confirmed FX base", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/market/ticker/route.ts"),
      "utf8",
    )
    expect(route).toContain("baseCurrencies.length === 1")
    expect(route).toContain('status: baseCurrencies.length === 0 ? "missing" : "conflicting"')
    expect(route).toContain("`${c.code}_${baseCurrency!.code}`")
    expect(route).not.toContain("`${c.code}_AZN`")
    expect(route).not.toContain("`${c.code}/AZN`")
  })
})

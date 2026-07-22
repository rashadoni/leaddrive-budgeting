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
let alerts: GuideScenario

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
  alerts = module.default.alerts
})

describe("Alert evaluation snapshot help-video scenario", () => {
  it("keeps the complete Alerts message tree in EN/RU/AZ parity", () => {
    const en = flattenKeys(enMessages.alertHistory).sort()
    expect(flattenKeys(ruMessages.alertHistory).sort()).toEqual(en)
    expect(flattenKeys(azMessages.alertHistory).sort()).toEqual(en)
  })

  it("states snapshot, absence, severity, pagination, and navigation boundaries", () => {
    expect(enMessages.alertHistory.description).toContain("replaces the previous set")
    expect(enMessages.alertHistory.description).toContain("not a complete run history")
    expect(enMessages.alertHistory.scopeBody).toContain("do not prove")
    expect(enMessages.alertHistory.emptyBody).toContain("Absence is not a green status")
    expect(enMessages.alertHistory.readingSeverity).toContain("configured rule priority")
    expect(enMessages.alertHistory.readingPagination).toContain("not an older recompute run")
    expect(enMessages.alertHistory.readingDeepLink).toContain("does not run AI")
  })

  it("provides a substantial ten-scene trilingual walkthrough", () => {
    expect(alerts.route).toBe("/budgeting/alerts/history")
    expect(alerts.scenes).toHaveLength(10)
    for (const language of ["az", "en", "ru"] as const) {
      const wordCounts = alerts.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...wordCounts)).toBeGreaterThanOrEqual(35)
      expect(wordCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(400)
    }
  })

  it("is strictly hover-only and never activates filter, pagination, terminal, or AI", () => {
    for (const scene of alerts.scenes) {
      const action = scene.do.toString()
      expect(action).toContain("waitForSelector")
      expect(action).toMatch(/h\.(?:hover|moveTo)\(/)
      expect(action).not.toContain("safeClick")
      expect(action).not.toContain("h.click")
      expect(action).not.toContain("h.fill")
      expect(action).not.toContain("selectOption")
      expect(action).not.toMatch(/\bp\.(?:click|fill|type|press|evaluate)\s*\(/)
      expect(action).not.toContain(".catch(() => {})")
      expect(action).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
    }
  })

  it("pins data-independent anchors that exist even when the snapshot is empty", () => {
    const sources = [
      "src/app/(dashboard)/budgeting/alerts/history/page.tsx",
      "src/features/risk/components/AlertEventsFeed.tsx",
    ]
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n")

    for (const anchor of [
      "alerts-guide-root",
      "alerts-guide-header",
      "alerts-guide-scope",
      "alerts-guide-feed",
      "alerts-guide-filter",
      "alerts-guide-rule-input",
      "alerts-guide-apply",
      "alerts-guide-reset",
      "alerts-guide-filter-disclosure",
      "alerts-guide-reading",
      "alerts-guide-read-severity",
      "alerts-guide-read-message",
      "alerts-guide-read-pagination",
      "alerts-guide-read-deeplink",
    ]) {
      expect(sources).toContain(anchor)
    }
  })

  it("keeps subgroup scope, stored-ID resolution, and single-company link guards", () => {
    const eventsRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/indicators/alerts/events/route.ts"),
      "utf8",
    )
    const resolveRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/indicators/values/resolve/route.ts"),
      "utf8",
    )
    const feed = readFileSync(
      resolve(process.cwd(), "src/features/risk/components/AlertEventsFeed.tsx"),
      "utf8",
    )

    expect(eventsRoute).toContain("getCompanyScope")
    expect(eventsRoute).toContain("affectedCompanyIds.every")
    expect(eventsRoute).toContain("Cache-Control")
    expect(resolveRoute).toContain("{ organizationId: orgId, id: parsed.companyId }")
    expect(resolveRoute).toContain("{ organizationId: orgId, code: parsed.company! }")
    expect(resolveRoute).toContain("!scope.ids.has(company.id)")
    expect(feed).toContain("ev.affectedCompanyIds.length === 1")
    expect(feed).toContain("ev.affectedIndicatorCodes.length === 1")
    expect(feed).toContain("?companyId=${encodeURIComponent")
    expect(feed).toContain("openTerminalTitle")
  })
})

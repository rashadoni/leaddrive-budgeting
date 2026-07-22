import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import enMessages from "../../../messages/en.json"
import ruMessages from "../../../messages/ru.json"
import azMessages from "../../../messages/az.json"

type GuideScene = {
  route: string
  voice: Record<"az" | "en" | "ru", string>
  do: (...args: unknown[]) => Promise<void>
}

type GuideScenario = { route: string; scenes: GuideScene[] }
let dataControl: GuideScenario

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
  dataControl = module.default["data-control"]
})

describe("Data control group help-video scenario", () => {
  it("keeps every affected admin message tree in EN/RU/AZ key parity", () => {
    for (const key of [
      "adminCompaniesReadiness",
      "adminIndicatorBacklog",
      "adminIndicatorHealth",
      "adminIfrs",
    ] as const) {
      const en = flattenKeys(enMessages[key]).sort()
      expect(flattenKeys(ruMessages[key]).sort()).toEqual(en)
      expect(flattenKeys(azMessages[key]).sort()).toEqual(en)
    }
  })

  it("does not claim Indicator Health enumerates absent company-indicator pairs", () => {
    expect(enMessages.adminIndicatorHealth.pageDescription).toContain(
      "only for indicator rows stored in the displayed period",
    )
    expect(enMessages.adminIndicatorHealth.pageDescription).toContain(
      "use Indicator Backlog",
    )
    expect(enMessages.adminIndicatorHealth.pageDescription).not.toContain(
      "For every indicator",
    )
    expect(ruMessages.adminIndicatorHealth.pageDescription).toContain(
      "только строк индикаторов, сохранённых за отображаемый период",
    )
    expect(azMessages.adminIndicatorHealth.pageDescription).toContain(
      "göstərilən dövr üçün saxlanmış indikator sətirlərinin",
    )
  })

  it("covers all eight real routes with substantial trilingual narration", () => {
    expect(dataControl.route).toBe("/budgeting/admin/companies-readiness")
    expect(dataControl.scenes).toHaveLength(10)
    expect(new Set(dataControl.scenes.map((scene) => scene.route))).toEqual(
      new Set([
        "/budgeting/admin/companies-readiness",
        "/budgeting/admin/indicator-backlog",
        "/budgeting/admin/indicator-health",
        "/budgeting/admin/statement-controls",
        "/budgeting/admin/ifrs-conformance",
        "/budgeting/admin/compliance",
        "/budgeting/admin/drift",
        "/budgeting/admin/intel-health",
      ]),
    )
    for (const language of ["az", "en", "ru"] as const) {
      const words = dataControl.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...words)).toBeGreaterThanOrEqual(35)
      expect(words.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(400)
    }
  })

  it("is strictly hover-only and waits for stable evidence anchors", () => {
    for (const scene of dataControl.scenes) {
      const action = scene.do.toString()
      expect(action).toContain("waitForSelector")
      expect(action).toMatch(/h\.(?:hover|moveTo)\(/)
      expect(action).not.toContain("safeClick")
      expect(action).not.toContain("h.click")
      expect(action).not.toContain("h.fill")
      expect(action).not.toContain("selectOption")
      expect(action).not.toContain(".catch(() => {})")
      expect(action).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
    }
    const allActions = dataControl.scenes.map((scene) => scene.do.toString()).join("\n")
    expect(allActions).not.toMatch(/refresh|email|export|upload|run_btn/i)
  })

  it("pins the guide anchors in every rendered admin surface", () => {
    const sources = [
      "src/app/(dashboard)/budgeting/admin/companies-readiness/page.tsx",
      "src/app/(dashboard)/budgeting/admin/companies-readiness/ReadinessTable.tsx",
      "src/app/(dashboard)/budgeting/admin/indicator-backlog/page.tsx",
      "src/app/(dashboard)/budgeting/admin/indicator-backlog/IndicatorBacklogView.tsx",
      "src/app/(dashboard)/budgeting/admin/indicator-health/page.tsx",
      "src/app/(dashboard)/budgeting/admin/indicator-health/IndicatorHealthView.tsx",
      "src/app/(dashboard)/budgeting/admin/statement-controls/page.tsx",
      "src/app/(dashboard)/budgeting/admin/ifrs-conformance/page.tsx",
      "src/app/(dashboard)/budgeting/admin/compliance/page.tsx",
      "src/features/admin/components/DriftDashboard.tsx",
      "src/app/(dashboard)/budgeting/admin/intel-health/page.tsx",
    ]
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n")

    for (const anchor of [
      "data-control-readiness",
      "data-control-readiness-period",
      "data-control-readiness-table",
      "data-control-backlog",
      "data-control-backlog-period",
      "data-control-indicator-health",
      "data-control-indicator-health-period",
      "data-control-statement-controls",
      "data-control-ifrs",
      "data-control-compliance",
      "data-control-drift",
      "data-control-drift-freshness",
      "data-control-intel-health",
      "data-control-intel-health-summary",
    ]) {
      expect(sources).toContain(anchor)
    }
  })

  it("keeps period, plan, applicability, and direct-company evidence boundaries explicit", () => {
    const readiness = readFileSync(
      resolve(process.cwd(), "src/lib/server/get-company-readiness.ts"),
      "utf8",
    )
    const ifrs = readFileSync(
      resolve(process.cwd(), "src/app/api/companies/[id]/ifrs-check/route.ts"),
      "utf8",
    )
    const health = readFileSync(
      resolve(process.cwd(), "src/app/api/admin/indicator-health/route.ts"),
      "utf8",
    )
    const backlog = readFileSync(
      resolve(process.cwd(), "src/lib/risk/indicator-backlog.ts"),
      "utf8",
    )

    expect(readiness).toContain('by: ["companyId"]')
    expect(readiness).toContain("confirmedBases.length === 1")
    expect(readiness).toContain("row.currencyCode?.trim().toUpperCase() !== normalizedBaseCode")
    expect(ifrs).toContain("planId: selectedPlanId")
    expect(ifrs).toContain("sourcePlanCount > 1")
    expect(ifrs).toContain("plan: { year: maxY }")
    expect(health).toContain("period,")
    expect(health).toContain("parsePeriod(period)")
    expect(backlog).toContain("currentBakuYear()")
    expect(backlog).toContain("loadPairApplicabilityResolver")
    expect(backlog).toContain("preferOrgScopedDefinitions")
  })
})

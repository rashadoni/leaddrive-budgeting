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
let plans: GuideScenario

beforeAll(async () => {
  const module = (await import(pathToFileURL(resolve(process.cwd(), "video/scenarios/overrides.mjs")).href)) as {
    default: Record<string, GuideScenario>
  }
  plans = module.default.plans
})

describe("Plans help-video scenario", () => {
  it("keeps Plans message keys in EN/RU/AZ parity", () => {
    const keys = (messages: typeof enMessages) => Object.keys(messages.budgeting).filter((key) => key.startsWith("plans")).sort()
    expect(keys(ruMessages)).toEqual(keys(enMessages))
    expect(keys(azMessages)).toEqual(keys(enMessages))
  })

  it("has substantial trilingual narration on the real Plans tab", () => {
    expect(plans.route).toBe("/budgeting?tab=plans")
    expect(plans.scenes).toHaveLength(9)
    for (const language of ["az", "en", "ru"] as const) {
      const words = plans.scenes.map((scene) => scene.voice[language].trim().split(/\s+/).length)
      expect(Math.min(...words)).toBeGreaterThanOrEqual(35)
      expect(words.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(350)
    }
  })

  it("is hover-only and cannot mutate production state", () => {
    const actions = plans.scenes.map((scene) => scene.do.toString()).join("\n")
    expect(actions).not.toContain("safeClick(")
    expect(actions).not.toContain("h.click(")
    expect(actions).not.toContain("h.fill(")
    expect(actions).not.toContain("selectOption")
    expect(actions).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
  })

  it("pins truth, fail-closed and READONLY anchors", () => {
    const files = [
      "src/features/budgeting/components/PlansTab.tsx",
      "src/components/budget-approval-workflow.tsx",
      "src/components/budget-approval-history.tsx",
      "src/components/budget-version-history.tsx",
      "src/components/budget-version-diff.tsx",
    ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n")

    for (const anchor of [
      "plans-guide-root",
      "plans-loading",
      "plans-error",
      "plans-provenance",
      "plans-readonly-disclosure",
      "plans-currency-scope",
      "plans-write-controls",
      "plans-count",
      "plans-card-",
      "plans-evidence-",
      "plans-period-",
      "plans-kind-",
      "plans-status-",
      "plans-approval-workflow",
      "plans-approval-history-error",
      "plans-approval-history-loading",
      "plans-version-loading",
      "plans-version-error",
      "plans-version-empty",
      "plans-version-history",
      "plans-version-diff",
      "data-write-control",
    ]) expect(files).toContain(anchor)
  })

  it("preserves kind, line-count and version-chain semantics", () => {
    const plansTab = readFileSync(resolve(process.cwd(), "src/features/budgeting/components/PlansTab.tsx"), "utf8")
    const createVersion = readFileSync(resolve(process.cwd(), "src/app/api/budgeting/plans/[id]/create-version/route.ts"), "utf8")
    const versions = readFileSync(resolve(process.cwd(), "src/app/api/budgeting/plans/[id]/versions/route.ts"), "utf8")
    expect(plansTab).toContain("planLineEvidence(plan)")
    expect(plansTab).toContain("planKindKey(plan.kind)")
    expect(plansTab).toContain("if (!response.ok) throw")
    expect(plansTab).toContain("plans-reset-error")
    expect(createVersion).toContain("kind: plan.kind")
    expect(createVersion).toContain("const nextVersion = Math.max")
    expect(versions).toContain("deletedAt: null")
    expect(versions).toContain("kind: true")
  })
})

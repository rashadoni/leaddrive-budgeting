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
let aiImport: GuideScenario

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
  aiImport = module.default["ai-import"]
})

describe("AI Import help-video scenario", () => {
  it("keeps the complete AI Import message tree in EN/RU/AZ parity", () => {
    const en = flattenKeys(enMessages.adminAiImport).sort()
    expect(flattenKeys(ruMessages.adminAiImport).sort()).toEqual(en)
    expect(flattenKeys(azMessages.adminAiImport).sort()).toEqual(en)
  })

  it("states provider, staging, apply, and cleanup boundaries without an arbitrary-file guarantee", () => {
    expect(enMessages.adminAiImport.page.description).toContain("supported xlsx")
    expect(enMessages.adminAiImport.page.description).toContain("proposal is not proof")
    expect(enMessages.adminAiImport.page.description).not.toContain("any xlsx")
    expect(enMessages.adminAiImport.page.stackLine).toContain("explicit upload and Analyze")
    expect(enMessages.adminAiImport.page.stackLine).toContain("invoke Anthropic")
    expect(enMessages.adminAiImport.page.safetyBody).toContain("staging records")
    expect(enMessages.adminAiImport.page.safetyBody).toContain("Apply writes")
    expect(enMessages.adminAiImport.page.safetyBody).toContain("destructive workflow")
  })

  it("provides a substantial nine-scene trilingual walkthrough", () => {
    expect(aiImport.route).toBe("/budgeting/admin/ai-import")
    expect(aiImport.scenes).toHaveLength(9)
    for (const language of ["az", "en", "ru"] as const) {
      const wordCounts = aiImport.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...wordCounts)).toBeGreaterThanOrEqual(35)
      expect(wordCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(380)
    }
  })

  it("is strictly hover-only and never activates an import workflow", () => {
    for (const scene of aiImport.scenes) {
      const action = scene.do.toString()
      expect(action).toContain("waitForSelector")
      expect(action).toMatch(/h\.(?:hover|moveTo)\(/)
      expect(action).not.toContain("safeClick")
      expect(action).not.toContain("h.click")
      expect(action).not.toContain("h.fill")
      expect(action).not.toContain("selectOption")
      expect(action).not.toContain("setInputFiles")
      expect(action).not.toContain(".catch(() => {})")
      expect(action).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
    }
  })

  it("pins stable anchors across the page, tabs, cleanup warning, and default form", () => {
    const sources = [
      "src/app/(dashboard)/budgeting/admin/ai-import/page.tsx",
      "src/app/(dashboard)/budgeting/admin/ai-import/AIImportTabs.tsx",
      "src/app/(dashboard)/budgeting/admin/ai-import/AIImportForm.tsx",
      "src/features/admin/components/ImportDataResetPanel.tsx",
    ]
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n")

    for (const anchor of [
      "ai-import-guide-root",
      "ai-import-guide-pipeline",
      "ai-import-guide-safety",
      "ai-import-guide-cleanup",
      "ai-import-guide-reset",
      "ai-import-guide-workflows",
      "ai-import-guide-tabs",
      "ai-import-guide-panel",
      "ai-import-guide-drop-zone",
      "ai-import-guide-analyze",
      "tab-single",
      "tab-multi",
      "tab-universal",
      "tab-multisheet",
    ]) {
      expect(sources).toContain(anchor)
    }
  })

  it("keeps the initial rendered state free of client-side load effects", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/(dashboard)/budgeting/admin/ai-import/page.tsx"),
      "utf8",
    )
    const tabs = readFileSync(
      resolve(process.cwd(), "src/app/(dashboard)/budgeting/admin/ai-import/AIImportTabs.tsx"),
      "utf8",
    )
    const single = readFileSync(
      resolve(process.cwd(), "src/app/(dashboard)/budgeting/admin/ai-import/AIImportForm.tsx"),
      "utf8",
    )
    const reset = readFileSync(
      resolve(process.cwd(), "src/features/admin/components/ImportDataResetPanel.tsx"),
      "utf8",
    )

    expect(page).not.toContain("useEffect")
    expect(tabs).not.toContain("useEffect")
    expect(single).not.toContain("useEffect")
    expect(reset).not.toContain("useEffect")
    expect(single).toContain('form.append("year", String(initialYear ?? new Date().getFullYear()))')
    expect(single).not.toContain('form.append("year", "2026")')
    expect(single).not.toContain("handleConfirmImport")
  })
})

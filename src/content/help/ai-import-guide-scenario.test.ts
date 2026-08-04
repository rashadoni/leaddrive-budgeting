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

  it("provides a substantial ten-scene trilingual walkthrough", () => {
    expect(aiImport.route).toBe("/budgeting/admin/ai-import")
    expect(aiImport.scenes).toHaveLength(10)
    for (const language of ["az", "en", "ru"] as const) {
      const wordCounts = aiImport.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...wordCounts)).toBeGreaterThanOrEqual(35)
      expect(wordCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(380)
    }
  })

  /**
   * 2026-08-04 — this guide stopped being hover-only, on the owner's decision.
   *
   * The previous test forbade every click, and it was right for a narrated
   * tour: this is the screen where a wrong click destroys a year of financial
   * data. But a tour of an import that never imports leaves the viewer to
   * guess whether it works, so the guide now performs a real clear-then-load
   * run against a real stand.
   *
   * The blanket ban is replaced by a targeted one rather than deleted. A click
   * is allowed only on a named control of the import or the GUARDED delete
   * flow; anything else — another route, a raw HTTP verb — still fails here.
   */
  /** Mutating controls. `h.click` degrades to a hover when READONLY is on. */
  const ALLOWED_CLICK_TARGETS = [
    "AI_IMPORT_ANALYZE",
    "AI_IMPORT_APPLY",
    "DD_CHECK",
    "DD_CONFIRM_SUBMIT",
  ]

  /**
   * `safeClick` clicks for real even under READONLY, so its targets are pinned
   * here — the helper's own contract says scenario tests must do exactly that.
   * Only GET navigations and local view toggles belong on this list; a mutating
   * control here would silently defeat the recorder's main safety switch.
   */
  const ALLOWED_SAFECLICK_TARGETS = ["AI_IMPORT_RESET_CTA", "DD_TAB_ROUTING"]

  it("clicks only named controls of the import and guarded-delete flows", () => {
    for (const scene of aiImport.scenes) {
      const action = scene.do.toString()
      for (const call of action.match(/h\.click\(([^)]*)\)/g) ?? []) {
        const target = call.replace(/h\.click\(|\)/g, "").trim()
        expect(ALLOWED_CLICK_TARGETS, `unexpected click target: ${target}`).toContain(target)
      }
      for (const call of action.match(/h\.safeClick\(([^)]*)\)/g) ?? []) {
        const target = call.replace(/h\.safeClick\(|\)/g, "").trim()
        expect(
          ALLOWED_SAFECLICK_TARGETS,
          `safeClick bypasses READONLY — ${target} must be a GET or a view toggle`,
        ).toContain(target)
      }
      // No scenario may reach past the UI into the API directly.
      expect(action).not.toMatch(/\.(?:post|put|patch|delete)\s*\(/i)
      expect(action).not.toContain("evaluate(")
    }
  })

  it("never confirms a deletion without running the dry check first", () => {
    // The invariant worth protecting now that clicking is allowed. `check`
    // computes the blast radius and deletes nothing; confirming without it is
    // exactly the habit this guide must not teach.
    const flat = aiImport.scenes.map((s) => s.do.toString()).join("\n")
    const checkAt = flat.indexOf("h.click(DD_CHECK)")
    const confirmAt = flat.indexOf("h.click(DD_CONFIRM_SUBMIT)")
    expect(checkAt, "the dry check is never clicked").toBeGreaterThan(-1)
    expect(confirmAt, "the deletion is never confirmed").toBeGreaterThan(-1)
    expect(checkAt).toBeLessThan(confirmAt)
  })

  it("actually attaches the workbook it narrates", () => {
    // The narration says the file is dropped in. A tour that says so and does
    // not do it is the failure this rewrite exists to remove.
    const flat = aiImport.scenes.map((s) => s.do.toString()).join("\n")
    expect(flat).toContain("setInputFiles")
    expect(flat).toContain("WORKBOOK_PATH")
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

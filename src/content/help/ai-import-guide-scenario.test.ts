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

  it("provides a substantial fifteen-scene trilingual walkthrough", () => {
    expect(aiImport.route).toBe("/budgeting/admin/ai-import")
    expect(aiImport.scenes).toHaveLength(15)
    for (const language of ["az", "en", "ru"] as const) {
      const wordCounts = aiImport.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      )
      expect(Math.min(...wordCounts)).toBeGreaterThanOrEqual(35)
      expect(wordCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(500)
    }
  })

  // 2026-08-04 — this scenario stopped being hover-only ON PURPOSE, and the old
  // assertion ("strictly hover-only and never activates an import workflow")
  // was replaced rather than deleted.
  //
  // The previous version narrated "this guide never presses the button" over
  // nine static blocks. For a screen whose entire subject is importing a
  // workbook, that teaches nothing: the viewer never sees a preview, a routing
  // decision, the Import Doctor or a receipt. It also told the viewer the page
  // opens on the single-file tab, which stopped being true on 2026-07-30.
  //
  // What replaces "touch nothing" is a narrower, checkable promise: the two
  // writes are named explicitly, they go through the helper that REFUSES to run
  // under READONLY (so this scenario can only ever be recorded against a
  // throwaway stand, never prod), and nothing destructive is reachable.
  it("drives the real import, and only through explicitly named writes", () => {
    const actions = aiImport.scenes.map((scene) => scene.do.toString()).join("\n")

    expect(actions.match(/h\.mutatingClick\(/g)).toHaveLength(4)
    expect(actions).toContain("h.mutatingClick(DD_CHECK)")
    expect(actions).toContain("h.mutatingClick(DD_CONFIRM_SUBMIT)")
    expect(actions).toContain("h.mutatingClick(AI_ANALYZE)")
    expect(actions).toContain("h.mutatingClick(AI_APPLY)")

    // Local view state, one GET navigation to the deletion screen, and the
    // three stepwise choices the deletion wizard requires before it will even
    // render its Check button: task, company, year. None of them writes.
    expect(actions.match(/h\.safeClick\(/g)).toHaveLength(6)
    expect(actions).toContain("h.safeClick(AI_RESET_CTA)")
    expect(actions).toContain("h.safeClick(DD_TASK_CLEAR_YEAR)")
    expect(actions).toContain("h.safeClick(DD_COMPANY_OPTION)")
    expect(actions).toContain("h.safeClick(DD_YEAR_CHIP)")
    expect(actions).toContain("h.safeClick(AI_TAB_SINGLE)")
    expect(actions).toContain("h.safeClick(AI_TAB_MULTI)")

    // One file selection, into the multi-file input, and nothing else typed.
    expect(actions.match(/setInputFiles\(/g)).toHaveLength(1)
    expect(actions).not.toContain("h.fill")

    // 2026-08-04 — this list used to forbid the delete-data route outright, and
    // that was right while the guide only talked about clearing. The owner
    // asked it to SHOW one, so the ban is narrowed rather than dropped, and it
    // separates three things the old list ran together:
    //
    //   `force-override`  bypasses a BLOCKED apply. Still absolutely forbidden:
    //                     a guide must never demonstrate overriding a safety
    //                     gate, whatever stand it runs on.
    //   `btn-reset`       clears the form (`resetAll`), not any data. Harmless
    //                     but pointless on camera, so it stays out.
    //   the delete flow   now allowed — but only through the guarded route,
    //                     which the ordering test below pins: the dry check
    //                     runs first and the confirmation cannot precede it.
    for (const forbidden of ["force-override", "btn-reset"]) {
      expect(actions).not.toContain(forbidden)
    }
    // The unguarded one-shot entry points stay unreachable.
    expect(actions).not.toContain("h.mutatingClick(AI_RESET_CTA)")

    // Paced on narration length, not fixed sleeps — az runs ~2x longer than
    // en/ru, so fixed pauses would freeze the short takes.
    expect(actions).toContain("h.holdUntil(")
    for (const scene of aiImport.scenes) {
      expect(scene.do.toString()).toMatch(/h\.(?:hover|moveTo|holdUntil)\(/)
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

  /**
   * 2026-08-04 — the one ordering that must never slip.
   *
   * `DD_CHECK` computes the blast radius and deletes nothing; `DD_CONFIRM_SUBMIT`
   * is the deletion. A guide that confirmed first would be teaching the habit
   * this screen was built to prevent.
   */
  it("never confirms a deletion before the dry check has run", () => {
    const flat = aiImport.scenes.map((scene) => scene.do.toString()).join("\n")
    const checkAt = flat.indexOf("h.mutatingClick(DD_CHECK)")
    const confirmAt = flat.indexOf("h.mutatingClick(DD_CONFIRM_SUBMIT)")
    expect(checkAt, "the dry check is never clicked").toBeGreaterThan(-1)
    expect(confirmAt, "the deletion is never confirmed").toBeGreaterThan(-1)
    expect(checkAt).toBeLessThan(confirmAt)
  })

  it("clears before it loads, not after", () => {
    // The arc only makes sense in this order: empty the year, then show the
    // file filling it back in. Reversed, the video would end on an empty
    // screen.
    const flat = aiImport.scenes.map((scene) => scene.do.toString()).join("\n")
    expect(flat.indexOf("h.mutatingClick(DD_CONFIRM_SUBMIT)")).toBeLessThan(
      flat.indexOf("h.mutatingClick(AI_ANALYZE)"),
    )
  })
})

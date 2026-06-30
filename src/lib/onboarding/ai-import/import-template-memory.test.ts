import { describe, expect, it } from "vitest"
import {
  buildAiImportTemplateDraft,
  computeWorkbookStructureHash,
  findMatchingAiImportTemplate,
  markAiImportTemplateUsedInSettings,
  upsertAiImportTemplateInSettings,
} from "./import-template-memory"
import type { SheetClassification } from "./sheet-classifier"
import type { WorkbookProfile } from "./workbook-profile"

function profile(filename: string, rows = 120): WorkbookProfile {
  return {
    filename,
    sheetCount: 2,
    totalRows: rows,
    totalColumns: 18,
    workbookPlanHint: "actual",
    sourceLikeSheets: 2,
    summaryLikeSheets: 0,
    monthLikeSheets: 2,
    sheetsWithBuColumns: 1,
    sheetsWithFormulas: 0,
    sheetsWithEliminations: 0,
    duplicateGroups: [],
    repeatedDataHints: [],
    sheets: [
      {
        sheetName: "PLF CPC",
        totalRows: rows,
        totalColumns: 18,
        headerRowIndex: 0,
        roleHint: "source_like",
        planHint: "actual",
        sourceScore: 90,
        summaryScore: 10,
        monthHeaderCount: 12,
        monthHeaders: ["Jan", "Feb", "Mar"],
        buColumns: ["BU"],
        entityLikeValues: ["CPC"],
        formulaCells: 0,
        codeLikeCells: 20,
        numericCells: 100,
        totalRowsCount: 2,
        subtotalRowsCount: 0,
        eliminationSignals: [],
        duplicateGroupId: null,
        fingerprint: "ignored-for-template-hash",
      },
      {
        sheetName: "Summary",
        totalRows: 10,
        totalColumns: 5,
        headerRowIndex: 0,
        roleHint: "summary_like",
        planHint: "unknown",
        sourceScore: 20,
        summaryScore: 80,
        monthHeaderCount: 0,
        monthHeaders: [],
        buColumns: [],
        entityLikeValues: [],
        formulaCells: 5,
        codeLikeCells: 0,
        numericCells: 20,
        totalRowsCount: 1,
        subtotalRowsCount: 0,
        eliminationSignals: [],
        duplicateGroupId: null,
        fingerprint: "also-ignored",
      },
    ],
  }
}

const classifications: SheetClassification[] = [
  {
    sheetName: "PLF CPC",
    dataType: "PLF",
    entityCode: "AZSEKER-CPC",
    confidence: 0.96,
    reasoning: "reviewed PLF source",
    planKind: "actual",
    role: "source",
    planKindSignal: "config",
    roleSignal: "config",
  },
  {
    sheetName: "Summary",
    dataType: "INFO_SUMMARY",
    entityCode: null,
    confidence: 1,
    reasoning: "reviewed skip",
    planKind: null,
    role: "derived_summary",
    planKindSignal: "unresolved",
    roleSignal: "config",
  },
]

describe("AI import approved template memory", () => {
  it("hashes workbook structure without depending on filename", () => {
    expect(computeWorkbookStructureHash(profile("a.xlsx"))).toBe(
      computeWorkbookStructureHash(profile("b.xlsx")),
    )
  })

  it("appends versions without mutating older approvals", () => {
    const draft = buildAiImportTemplateDraft({
      name: "AzerSheker Actuals",
      approvedBy: "u1",
      files: [
        {
          filename: "actuals.xlsx",
          workbookProfile: profile("actuals.xlsx"),
          classifications,
        },
      ],
    })
    const first = upsertAiImportTemplateInSettings({}, draft, "2026-06-30T10:00:00Z")
    const second = upsertAiImportTemplateInSettings(
      first.settings,
      { ...draft, name: "AzerSheker Actuals v2" },
      "2026-06-30T11:00:00Z",
    )

    expect(first.template.version).toBe(1)
    expect(second.template.version).toBe(2)
    expect(first.template.name).toBe("AzerSheker Actuals")
    expect(second.template.name).toBe("AzerSheker Actuals v2")
  })

  it("matches the latest template and reconstructs classifications", () => {
    const draft = buildAiImportTemplateDraft({
      name: "AzerSheker Actuals",
      approvedBy: "u1",
      files: [
        {
          filename: "actuals.xlsx",
          workbookProfile: profile("actuals.xlsx"),
          classifications,
        },
      ],
    })
    const { settings, template } = upsertAiImportTemplateInSettings(
      {},
      draft,
      "2026-06-30T10:00:00Z",
    )

    const match = findMatchingAiImportTemplate(settings, [profile("renamed.xlsx")])

    expect(match?.template.id).toBe(template.id)
    expect(match?.files[0].classifications[0]).toMatchObject({
      sheetName: "PLF CPC",
      dataType: "PLF",
      entityCode: "AZSEKER-CPC",
      planKind: "actual",
      role: "source",
    })
    expect(match?.files[0].classifications[0].reasoning).toContain(
      "Approved template",
    )
  })

  it("persists approved semantic CoA mappings on sheet rules", () => {
    const draft = buildAiImportTemplateDraft({
      name: "No-code actuals",
      approvedBy: "u1",
      files: [
        {
          filename: "actuals.xlsx",
          workbookProfile: profile("actuals.xlsx"),
          classifications: [
            {
              ...classifications[0],
              coaMappings: [
                {
                  sourceLabel: "Raw materials",
                  targetCode: "PLF.02.01.01",
                  confidence: 1,
                  action: "map",
                },
              ],
            },
            classifications[1],
          ],
        },
      ],
    })
    const { settings } = upsertAiImportTemplateInSettings(
      {},
      draft,
      "2026-06-30T10:00:00Z",
    )

    const match = findMatchingAiImportTemplate(settings, [profile("renamed.xlsx")])

    expect(match?.files[0].classifications[0].coaMappings).toEqual([
      {
        sourceLabel: "Raw materials",
        targetCode: "PLF.02.01.01",
        confidence: 1,
        action: "map",
      },
    ])
  })

  it("returns null when sheet coverage no longer matches", () => {
    const draft = buildAiImportTemplateDraft({
      name: "AzerSheker Actuals",
      approvedBy: "u1",
      files: [
        {
          filename: "actuals.xlsx",
          workbookProfile: profile("actuals.xlsx"),
          classifications,
        },
      ],
    })
    const { settings } = upsertAiImportTemplateInSettings(
      {},
      draft,
      "2026-06-30T10:00:00Z",
    )
    const changed = profile("actuals.xlsx")
    changed.sheets[0] = { ...changed.sheets[0], sheetName: "PLF NEW" }

    expect(findMatchingAiImportTemplate(settings, [changed])).toBeNull()
  })

  it("tracks template reuse count on the latest version", () => {
    const draft = buildAiImportTemplateDraft({
      name: "AzerSheker Actuals",
      approvedBy: "u1",
      files: [
        {
          filename: "actuals.xlsx",
          workbookProfile: profile("actuals.xlsx"),
          classifications,
        },
      ],
    })
    const { settings, template } = upsertAiImportTemplateInSettings(
      {},
      draft,
      "2026-06-30T10:00:00Z",
    )

    const updated = markAiImportTemplateUsedInSettings(
      settings,
      template.id,
      "2026-06-30T12:00:00Z",
    )
    const match = findMatchingAiImportTemplate(updated, [profile("actuals.xlsx")])

    expect(match?.template.applyCount).toBe(1)
    expect(match?.template.lastUsedAt).toBe("2026-06-30T12:00:00Z")
  })
})

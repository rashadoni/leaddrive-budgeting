// @vitest-environment happy-dom
/**
 * 11.82 — the warning block as a finance user actually reads it.
 *
 * `warning-groups.test.ts` proves the classification and `warning-facts.test.ts`
 * proves the arithmetic. Neither proves that the sentence on screen contains
 * the number: the global test setup replaces every translation with the last
 * segment of its key in capitals, so a card that renders "TABLE" instead of
 * "371 data rows × 20 columns" would pass both of them.
 *
 * So this file resolves against the REAL `messages/en.json`. It is the only
 * place that asserts on prose, and it asserts on the two things the owner
 * asked for: that «Tech» stops being a warning, and that «Müştəri İcmalı»
 * says what is in it, what stays empty and what to do.
 *
 * The payload is the live preview: the same twelve warnings as
 * warning-groups.test.ts, plus the classifications and workbook profile the
 * same run produced (measured — see warning-facts.test.ts).
 */
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import en from "../../../../../../messages/en.json"

/** Resolve keys against the real catalogue with plain {var} substitution. */
vi.mock("next-intl", () => {
  const lookup = (namespace: string | undefined, key: string): string => {
    const path = namespace ? `${namespace}.${key}` : key
    let node: unknown = en
    for (const part of path.split(".")) {
      if (node && typeof node === "object" && part in (node as object)) {
        node = (node as Record<string, unknown>)[part]
      } else return path
    }
    return typeof node === "string" ? node : path
  }
  const make = (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      lookup(namespace, key).replace(/\{(\w+)\}/g, (m, k) =>
        values && k in values ? String(values[k]) : m,
      )
    t.rich = t
    t.raw = (key: string) => lookup(namespace, key)
    t.has = () => true
    return t
  }
  return {
    useTranslations: (namespace?: string) => make(namespace),
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
    useMessages: () => en,
    useFormatter: () => ({
      dateTime: (d: Date) => String(d),
      number: (n: number) => String(n),
    }),
  }
})

const { MultiFileForm } = await import("./MultiFileForm")

const FILE = "actual-budget-v1.xlsx"

/** Verbatim from the live run — the twelve the owner was looking at. */
const LIVE_WARNINGS = [
  `${FILE}: sheet "Satış İcmalı" — row 1: Missing required column(s): companyCode, metric, date, value, unit. Expected headers: companyCode, metric, date, value, unit (optional: sourceNote).`,
  `${FILE}: sheet "Müştəri İcmalı" — No counterparty blocks detected on "Müştəri İcmalı"`,
  `${FILE}: sheet "Satış Əkinçilik Fakt" — Sales transactions "AZSEKER-AZSF": 140 row(s) outside 2026 skipped (import that year separately). · Sheet "Satış Əkinçilik Fakt": 7 product label(s) outside the approved dictionary — imported under their own code, review the mapping: Arpa Püfə, Pambıq Çiyidi`,
  `${FILE}: sheet "Satış CPC Fakt" — Sales transactions "AZSEKER-CPC": 1516 row(s) outside 2026 skipped (import that year separately). · column "Net Miqdar Ton" claims tonnes but the median implied price is 0.72 ₼ — the values are kilograms; divided by 1000 so price/volume read per tonne`,
  `${FILE}: sheet "Tech" — Could not locate year-header row in İcmal sheet`,
  `${FILE}: sheet "Sales Budget CPC 2026" — 1 product label(s) outside the approved dictionary — imported under their own code, review the mapping: Byproduct`,
  `${FILE}: sheet "PLF Actual 2025 [AZSEKER-CPC]" — carries 2025 data, but this run imports 2026 — skipped without calling the AI detector.`,
  `${FILE}: sheet "PLF Actual 2025 [AZSEKER-AZSF]" — carries 2025, 2029 data, but this run imports 2026 — skipped without calling the AI detector.`,
  `${FILE}: sheet "PLF Actual 2025 [AZSEKER-EDEN]" — carries 2025 data, but this run imports 2026 — skipped without calling the AI detector.`,
  `${FILE}: sheet "BS Actual 2025 [AZSEKER-CPC]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.`,
  `${FILE}: sheet "BS Actual 2025 [AZSEKER-AZSF]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.`,
  `${FILE}: sheet "BS Actual 2025 [AZSEKER-EDEN]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.`,
]

const PREVIEW = {
  ok: true,
  mode: "preview",
  perFile: [
    {
      filename: FILE,
      fileTypeResult: {
        fileType: "main-financial",
        confidence: 0.9,
        reasoning: "x",
        sheetCounts: {},
      },
      classifications: [
        { sheetName: "Müştəri İcmalı", dataType: "COUNTERPARTY", entityCode: null, confidence: 0.82, reasoning: "" },
        { sheetName: "Satış İcmalı", dataType: "OPS_FACTS", entityCode: null, confidence: 0.61, reasoning: "" },
        { sheetName: "Tech", dataType: "INFO_SUMMARY", entityCode: null, confidence: 0.74, reasoning: "" },
      ],
      workbookProfile: {
        sheetCount: 13,
        workbookPlanHint: "mixed",
        sourceLikeSheets: 1,
        summaryLikeSheets: 0,
        monthLikeSheets: 0,
        sheetsWithBuColumns: 0,
        sheetsWithEliminations: 0,
        duplicateGroups: [],
        sheets: [
          { sheetName: "Müştəri İcmalı", totalRows: 375, totalColumns: 20, headerRowIndex: 3 },
          { sheetName: "Satış İcmalı", totalRows: 42, totalColumns: 21, headerRowIndex: 0 },
          { sheetName: "Tech", totalRows: 34, totalColumns: 2, headerRowIndex: 0 },
        ],
      },
      error: null,
    },
  ],
  sheetImpactsByFilename: {
    [FILE]: [
      {
        sheetName: "Müştəri İcmalı",
        dataType: "COUNTERPARTY",
        entityCode: null,
        confidence: 0.82,
        impact: {
          dataType: "COUNTERPARTY",
          writes: "Counterparty",
          note: null,
          indicators: [
            { code: "CUSTOMER_HHI" },
            { code: "TOP_CUSTOMER_SHARE" },
            { code: "TOP3_CUSTOMER_SHARE" },
            { code: "SUPPLIER_HHI" },
          ],
        },
      },
      {
        sheetName: "Satış İcmalı",
        dataType: "OPS_FACTS",
        entityCode: null,
        confidence: 0.61,
        impact: {
          dataType: "OPS_FACTS",
          writes: "OperationalFact",
          note: null,
          // The API caps this projection at 12. Every one of them is a claim
          // about the dataType, not about a product × month sales grid.
          indicators: [
            "AGRO_YIELD", "AGRO_DROUGHT_RISK", "AGRO_YIELD_PER_HA", "AGRO_SUGAR_CONTENT",
            "AGRO_WATER_INTENSITY", "AGRO_FERTILIZER_INTENSITY", "AGRO_CUT_TO_MILL",
            "AGRO_BUYER_CONCENTRATION", "AGRO_HARVEST_PROGRESS", "RE_OCCUPANCY",
            "RE_RENT_COLLECTION", "ENT_ATTENDANCE_UTIL",
          ].map((code) => ({ code })),
        },
      },
      { sheetName: "Tech", dataType: "INFO_SUMMARY", entityCode: null, confidence: 0.74, impact: { dataType: "INFO_SUMMARY", writes: "", note: null, indicators: [] } },
    ],
  },
  conflicts: [],
  perGroup: [],
  overallVerdict: "green",
  llmUsage: { inputTokens: 0, outputTokens: 0, modelName: "x" },
  durationMs: 10,
  recompute: { ok: 0, unknown: 0, failed: 0, targets: 0 },
  warnings: LIVE_WARNINGS,
}

let fetchMock: MockInstance

beforeEach(() => {
  fetchMock = vi.spyOn(global, "fetch") as unknown as MockInstance
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => PREVIEW,
  } as Response)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderPreview() {
  render(<MultiFileForm />)
  const blob = new Blob([new Uint8Array(64)])
  fireEvent.change(screen.getByTestId("multi-file-input"), {
    target: { files: [new File([blob], FILE)] },
  })
  fireEvent.click(screen.getByTestId("btn-analyze"))
  return screen.findByTestId("preview-warnings")
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim()

describe("the warning block, in English, on the live twelve", () => {
  it("counts eleven warnings, not twelve — Tech is not one", async () => {
    const box = await renderPreview()
    // Before: "12 warning(s) from the import", Tech among them.
    expect(text(box.querySelector("summary")!)).toContain(
      "11 warning(s) from the import",
    )
  })

  it("moves the deliberately-skipped sheet out of the amber block entirely", async () => {
    const box = await renderPreview()
    const quiet = screen.getByTestId("warning-group-by-design")
    expect(box.contains(quiet)).toBe(false)
    expect(text(quiet)).toContain("1 sheet(s) not read on purpose — nothing was lost")
    expect(text(quiet)).toContain("Tech")
    // It still says what the sheet is, so the reader can recognise it, and
    // why it was skipped — but offers no remedy, because none is needed.
    expect(text(quiet)).toContain(
      "Read as a summary or index sheet (INFO_SUMMARY), and this import never writes from one",
    )
    expect(text(quiet)).toContain("33 data row(s) × 2 column(s)")
    // The dataType is already in the reason sentence; the card does not
    // repeat it as a confidence readout.
    expect(text(quiet)).not.toContain("74% confidence")
    expect(text(quiet)).not.toContain("What to do")
  })

  it("Müştəri İcmalı answers all three questions", async () => {
    await renderPreview()
    const card = text(screen.getByTestId("warning-brief-Müştəri İcmalı"))

    // WHAT — the row count is the customer count, and the three summary rows
    // above the header are named because they are why the reader missed it.
    expect(card).toContain(
      "371 data row(s) × 20 column(s); the header is not the top row — 3 row(s) sit above it.",
    )
    expect(card).toContain("Read as COUNTERPARTY, 82% confidence.")

    // WHAT YOU LOSE — the four indicators, by name.
    expect(card).toContain(
      "4 indicator(s) stay empty: CUSTOMER_HHI, TOP_CUSTOMER_SHARE, TOP3_CUSTOMER_SHARE, SUPPLIER_HHI.",
    )

    // WHAT TO DO — a control on this page, an honest note that no screen
    // takes customer turnover by hand, and where the four go meanwhile.
    expect(card).toContain("Open the “Guided fixes” tab")
    expect(card).toContain("There is no screen for typing in customer or supplier turnover")
    expect(card).toContain("Indicator Backlog")
    // Never point at a screen that cannot accept this data.
    expect(card).not.toContain("Data entry page")

    // The server's own sentence survives, one click away.
    expect(card).toContain("No counterparty blocks detected")
  })

  it("Satış İcmalı repeats the reader's expected columns and refuses to invent a loss", async () => {
    await renderPreview()
    const card = text(screen.getByTestId("warning-brief-Satış İcmalı"))
    expect(card).toContain("41 data row(s) × 21 column(s), header on the first row.")
    expect(card).toContain(
      "The reader needs the columns companyCode, metric, date, value, unit",
    )
    // Twelve indicators spanning rent collection and event attendance are a
    // property of OPS_FACTS, not of a sales grid. They are not printed.
    expect(card).toContain("The OPS_FACTS reader feeds 12 different indicators")
    expect(card).not.toContain("RE_RENT_COLLECTION")
    expect(card).not.toContain("stay empty:")
  })

  it("leaves the six off-year skips as a plain collapsed list", async () => {
    const box = await renderPreview()
    const offYear = screen.getByTestId("warning-group-off-year")
    expect(box.contains(offYear)).toBe(true)
    expect(offYear.querySelectorAll("li")).toHaveLength(6)
    // No briefing: the line already reads as a sentence and the group hint
    // carries the remedy.
    expect(text(offYear)).not.toContain("What to do")
    expect(text(offYear)).toContain("2024, 2025, 2026, 2029")
  })

  it("opens the actionable groups and leaves the rest folded", async () => {
    await renderPreview()
    expect(
      (screen.getByTestId("warning-group-structure") as HTMLDetailsElement).open,
    ).toBe(true)
    expect(
      (screen.getByTestId("warning-group-off-year") as HTMLDetailsElement).open,
    ).toBe(false)
  })
})

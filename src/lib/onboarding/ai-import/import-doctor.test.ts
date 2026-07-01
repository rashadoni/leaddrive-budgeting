import { describe, expect, it } from "vitest"
import {
  parseImportDoctorRequestBody,
  runImportDoctorExplanation,
  runImportDoctorFixSuggestion,
  validateImportDoctorExplanation,
  validateImportDoctorFixProposal,
} from "./import-doctor"

function mockClient(text: string) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text }],
        usage: { input_tokens: 123, output_tokens: 45 },
      }),
    },
  }
}

describe("Import Doctor", () => {
  it("parses request body and defaults unknown locale to en", () => {
    const parsed = parseImportDoctorRequestBody({
      locale: "de",
      issue: {
        code: "routing_uncertain",
        severity: "warning",
        message: "Sheet routing is risky",
      },
      context: { conflicts: [] },
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.payload.locale).toBe("en")
      expect(parsed.payload.issue.severity).toBe("warning")
    }
  })

  it("validates explanations and caps checklist length", () => {
    const explanation = validateImportDoctorExplanation({
      title: "Blocked",
      plainExplanation: "Rows do not reconcile.",
      whyBlocked: "Parent totals differ from leaf rows.",
      whatToCheck: Array.from({ length: 20 }, (_, i) => `check ${i}`),
      safeNextStep: "Fix mapping and rerun preview.",
      needsReimport: true,
    })
    expect(explanation.whatToCheck).toHaveLength(8)
    expect(explanation.needsReimport).toBe(true)
  })

  it("rejects malformed explanation responses", () => {
    expect(() =>
      validateImportDoctorExplanation({
        title: "Blocked",
        plainExplanation: "Rows do not reconcile.",
      }),
    ).toThrow(/whyBlocked/)
  })

  it("validates executable sheet fixes only when they change preview controls", () => {
    const proposal = validateImportDoctorFixProposal({
      kind: "sheet_fix",
      executable: true,
      title: "Route PLF",
      rationale: "The sheet name says CPC.",
      confidence: 0.91,
      risk: "low",
      patch: {
        filename: "a.xlsx",
        sheetName: "PLF CPC",
        entityCode: "AZSEKER-CPC",
        planKind: "actual",
      },
    })
    expect(proposal.kind).toBe("sheet_fix")
    expect(proposal.requiresPreviewRerun).toBe(true)
    expect(() =>
      validateImportDoctorFixProposal({
        kind: "sheet_fix",
        executable: true,
        title: "No-op",
        rationale: "No-op patch.",
        confidence: 0.9,
        risk: "low",
        patch: { filename: "a.xlsx", sheetName: "PLF" },
      }),
    ).toThrow(/sheet_fix must change/)
  })

  it("validates CoA skip and conflict pick proposals", () => {
    expect(
      validateImportDoctorFixProposal({
        kind: "coa_mapping",
        executable: true,
        title: "Skip separator",
        rationale: "The source label is a visual separator.",
        confidence: 0.88,
        risk: "low",
        patch: {
          filename: "a.xlsx",
          sheetName: "PLF",
          sourceLabel: "TOTAL",
          targetCode: null,
          action: "skip",
        },
      }),
    ).toMatchObject({
      kind: "coa_mapping",
      patch: { action: "skip", targetCode: null },
    })
    expect(
      validateImportDoctorFixProposal({
        kind: "conflict_resolution",
        executable: true,
        title: "Use workbook A",
        rationale: "Workbook A is the latest source.",
        confidence: 0.76,
        risk: "medium",
        patch: {
          key: "AZSEKER-CPC::PLF.01::2026-01",
          resolution: { mode: "pick", filename: "a.xlsx" },
        },
      }),
    ).toMatchObject({
      kind: "conflict_resolution",
      requiresPreviewRerun: false,
    })
  })

  it("keeps high-risk proposals as manual review only", () => {
    const proposal = validateImportDoctorFixProposal({
      kind: "manual_review",
      executable: false,
      title: "Check workbook",
      rationale: "Evidence is insufficient.",
      confidence: 0.4,
      risk: "high",
      manualSteps: ["Open the source workbook", "Confirm the entity column"],
    })
    expect(proposal.executable).toBe(false)
  })

  it("runs explanation and fix prompts through the AI client", async () => {
    const payload = {
      locale: "en" as const,
      issue: {
        code: "routing_uncertain",
        severity: "warning" as const,
        message: "Routing is risky",
      },
      context: { guidedFixItems: [] },
    }
    const explanation = await runImportDoctorExplanation({
      client: mockClient(
        JSON.stringify({
          title: "Routing check",
          plainExplanation: "The sheet has incomplete entity evidence.",
          whyBlocked: "Preview cannot prove the target company.",
          whatToCheck: ["Sheet name", "BU column"],
          safeNextStep: "Pick the company and rerun preview.",
          needsReimport: false,
        }),
      ),
      model: "test-model",
      payload,
    })
    expect(explanation.usage.inputTokens).toBe(123)

    const fix = await runImportDoctorFixSuggestion({
      client: mockClient(
        JSON.stringify({
          kind: "sheet_fix",
          executable: true,
          title: "Set company",
          rationale: "The BU value is CPC.",
          confidence: 0.9,
          risk: "low",
          patch: {
            filename: "a.xlsx",
            sheetName: "PLF",
            entityCode: "AZSEKER-CPC",
          },
        }),
      ),
      model: "test-model",
      payload,
    })
    expect(fix.proposal.kind).toBe("sheet_fix")
  })
})

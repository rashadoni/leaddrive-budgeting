import { describe, expect, it } from "vitest"
import {
  parseImportDoctorRequestBody,
  runImportDoctorExplanation,
  runImportDoctorFixSuggestion,
  validateImportDoctorExplanation,
  validateImportDoctorFixProposal,
  FIX_SYSTEM_PROMPT,
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

/**
 * 2026-08-03 — the failure that reached the owner's screen twice.
 *
 * `validateImportDoctorFixProposal` threw "Executable Import Doctor fix must
 * be low or medium risk" because `risk` was absent, and the route reported
 * that as "the assistant is unavailable". The model had said nothing about
 * risk: the prompt never named the field. Same defect as the 2026-08-02
 * `title` / `rationale` omission, one field over.
 */
describe("Import Doctor fix — a missing field is not an outage", () => {
  const executable = {
    kind: "sheet_fix",
    title: "Route the 2025 tab to 2025",
    rationale: "The sheet name says 2025 but the run imports 2026.",
    confidence: 0.8,
    patch: { filename: "f.xlsx", sheetName: "PLF Actual 2025", planKind: "actual" },
  }

  it("degrades a proposal with NO risk field to manual review instead of throwing", () => {
    // The production case, verbatim in shape.
    const p = validateImportDoctorFixProposal({ ...executable })
    expect(p.kind).toBe("manual_review")
    expect(p.executable).toBe(false)
    // The model's reasoning survives — that is the whole value of the answer.
    expect(p.title).toBe("Route the 2025 tab to 2025")
    expect(p.rationale).toMatch(/imports 2026/)
  })

  it("quotes the rationale as the step rather than inventing one", () => {
    // Inventing a manual step here would be the product telling an operator to
    // do something nobody proposed.
    const p = validateImportDoctorFixProposal({ ...executable })
    expect(p.executable).toBe(false)
    if (!p.executable) expect(p.manualSteps).toEqual([executable.rationale])
  })

  it("degrades a HIGH-risk executable proposal too, keeping its steps", () => {
    // A well-formed answer meaning "I can describe this but would not apply it
    // unreviewed" — the answer a person most wants to read, and the one that
    // used to be discarded to raise an error.
    const p = validateImportDoctorFixProposal({
      ...executable,
      risk: "high",
      manualSteps: ["Open the routing tab", "Set the year to 2025"],
    })
    expect(p.kind).toBe("manual_review")
    if (!p.executable) {
      expect(p.manualSteps).toEqual(["Open the routing tab", "Set the year to 2025"])
    }
  })

  it("still executes a low or medium risk proposal", () => {
    // The degrade must not swallow the happy path.
    for (const risk of ["low", "medium"] as const) {
      const p = validateImportDoctorFixProposal({ ...executable, risk })
      expect(p.kind, risk).toBe("sheet_fix")
      expect(p.executable, risk).toBe(true)
      expect(p.risk, risk).toBe(risk)
    }
  })
})

describe("the prompt names every field the validator requires", () => {
  // The class, not the instance. Both prompt defects were the same shape — a
  // declared JSON skeleton that left out a field the validator rejects on —
  // and both were found in production rather than here.
  const REQUIRED_IN_SHAPE = [
    "kind",
    "title",
    "rationale",
    "confidence",
    "risk",
    "patch",
    "manualSteps",
  ]

  it("declares each required field in the JSON shape line", () => {
    const shapeLine = FIX_SYSTEM_PROMPT.split("\n").find((l) => l.trim().startsWith("{"))
    expect(shapeLine, "the prompt must state a JSON shape").toBeTruthy()
    for (const field of REQUIRED_IN_SHAPE) {
      expect(shapeLine, `shape line is missing "${field}"`).toContain(`"${field}"`)
    }
  })

  it("states the low/medium constraint that the validator enforces", () => {
    // Naming `risk` is not enough on its own: a model told only that the field
    // exists can still answer "high" on an executable kind.
    expect(FIX_SYSTEM_PROMPT).toMatch(/low.*medium/i)
    expect(FIX_SYSTEM_PROMPT).toMatch(/manual_review/)
  })
})

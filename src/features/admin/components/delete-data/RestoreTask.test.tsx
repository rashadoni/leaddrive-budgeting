// @vitest-environment happy-dom
/**
 * The "bring it back" panel, which is the other half of the promise the blast
 * radius makes.
 *
 * Translations resolve to their keys, so these assert on which promises are
 * made and which calls are fired — not on copy.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key
    const varStr = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join(",")
    return `${key}(${varStr})`
  },
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))

import { RestoreTask } from "./RestoreTask"
import type { AuditRow } from "./types"

const COMPANIES = [{ id: "c1", code: "ACME", name: "Acme", level: 2, parentCompanyId: null }]

function event(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "e1",
    action: "data_reset",
    entityType: "Company",
    entityId: "ACME:2026",
    createdAt: "2026-07-31T09:00:00.000Z",
    actor: "Rashad",
    companyCode: "ACME",
    year: 2026,
    rowsAffected: 100,
    breakdown: { budgetLine: 100 },
    // The restore key. Without it the event is a LEGACY row: listed, explained,
    // and never offered a button — see ARCHIVE_GENERATION_KEY in
    // `src/lib/server/archive.ts`.
    archivedAt: "2026-07-31T09:00:00.000Z",
    ...over,
  }
}

let bodies: Array<Record<string, unknown>>

beforeEach(() => {
  bodies = []
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}"))
    return new Response(JSON.stringify({ ok: true, rowsAffected: 25 }), { status: 200 })
  }) as never
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("RestoreTask", () => {
  it("promises back only what the deletion actually archived", () => {
    render(<RestoreTask events={[event()]} companies={COMPANIES} />)
    fireEvent.click(screen.getByText("restore.cta"))
    const returns = [...screen.getByTestId("restore-will-return").children].map(
      (li) => li.textContent,
    )
    expect(returns).toEqual(["category.budgetLine"])
    // The four-item hardcoded list is gone.
    expect(screen.queryByText("category.counterparty")).toBeNull()
    expect(screen.queryByText("category.cashFlowEntry")).toBeNull()
  })

  it("fires one call per archived kind, not four every time", async () => {
    render(
      <RestoreTask
        events={[event({ breakdown: { budgetLine: 100, counterparty: 4, operationalFact: 9 } })]}
        companies={COMPANIES}
      />,
    )
    fireEvent.click(screen.getByText("restore.cta"))
    fireEvent.click(screen.getByText("restore.cta"))
    await waitFor(() => expect(bodies.length).toBe(2))
    expect(bodies.map((b) => b.entityKind)).toEqual(["BudgetLine", "Counterparty"])
    expect(bodies.every((b) => b.companyCode === "ACME" && b.year === 2026)).toBe(true)
    // Every call names the ONE deletion being undone. Without this the server
    // un-archives every generation of ACME 2026 at once.
    expect(bodies.every((b) => b.archivedAt === "2026-07-31T09:00:00.000Z")).toBe(true)
  })

  it("does not list a deletion whose rows no restore call can reach", () => {
    // A year of operational figures: hard-deleted, so the button could only
    // ever report zero. The panel says so instead of offering it.
    render(
      <RestoreTask
        events={[event({ breakdown: { operationalFact: 900, indicatorValue: 50 } })]}
        companies={COMPANIES}
      />,
    )
    expect(screen.getByText("restore.emptyNotRestorable")).toBeTruthy()
  })

  it("still offers an old event that recorded no breakdown but DID record a key", () => {
    render(<RestoreTask events={[event({ breakdown: undefined })]} companies={COMPANIES} />)
    fireEvent.click(screen.getByText("restore.cta"))
    expect(
      [...screen.getByTestId("restore-will-return").children].map((li) => li.textContent),
    ).toEqual([
      "category.budgetLine",
      "category.balanceSheetLine",
      "category.cashFlowEntry",
      "category.counterparty",
    ])
  })

  // ── Fail closed on a deletion with no recorded key ─────────────────────
  it("refuses, in words, an event recorded before the key existed", () => {
    render(<RestoreTask events={[event({ archivedAt: undefined })]} companies={COMPANIES} />)
    expect(screen.getByTestId("restore-legacy")).toBeTruthy()
    expect(screen.getByText("restore.legacy.title")).toBeTruthy()
    expect(screen.getByText("restore.legacy.body")).toBeTruthy()
    // No button — not a disabled one, not one that 400s. There is nothing safe
    // to press: a scope-only restore would revive every archived generation.
    expect(screen.queryByText("restore.cta")).toBeNull()
  })

  it("keeps a keyed event restorable while a legacy one sits next to it", () => {
    render(
      <RestoreTask
        events={[event({ id: "old", archivedAt: undefined }), event({ id: "new" })]}
        companies={COMPANIES}
      />,
    )
    expect(screen.getAllByTestId("restore-legacy")).toHaveLength(1)
    expect(screen.getAllByText("restore.cta")).toHaveLength(1)
  })

  it("says how long the archive lasts, because the purge job is real", () => {
    render(<RestoreTask events={[event()]} companies={COMPANIES} />)
    expect(screen.getByTestId("restore-retention").textContent).toContain("days=30")
  })

  // ── Each unreachable line carries its OWN fate ─────────────────────────
  it("never captions an indicator row with 'upload the file again'", () => {
    // `indicatorValue` is in every per-company breakdown, and no file brings
    // it back. The old panel printed one blanket reimport caption over the
    // whole list, so 100 % of restore panels made a false file promise.
    render(
      <RestoreTask
        events={[
          event({
            breakdown: { budgetLine: 100, operationalFact: 9, indicatorValue: 50, budgetActualManual: 4 },
          }),
        ]}
        companies={COMPANIES}
      />,
    )
    fireEvent.click(screen.getByText("restore.cta"))
    const items = [...screen.getByTestId("restore-will-not-return").children].map(
      (li) => li.textContent,
    )
    // Ordered by fate, worst first — the same order the blast radius uses.
    expect(items).toEqual([
      "category.budgetActualManual — restore.fate.permanent",
      "category.operationalFact — restore.fate.reimport",
      "category.indicatorValue — restore.fate.recomputed",
    ])
    // The blanket caption is gone from the catalogue and from the DOM.
    expect(screen.queryByText("restore.reimportInstead")).toBeNull()
  })

  it("says the indicators are not rebuilt by a restore", () => {
    render(<RestoreTask events={[event()]} companies={COMPANIES} />)
    fireEvent.click(screen.getByText("restore.cta"))
    expect(screen.getByText("restore.noRecompute")).toBeTruthy()
    expect(screen.getByText("restore.widerCaveat")).toBeTruthy()
  })

  it("does not report a no-op in green", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, rowsAffected: 0 }), { status: 200 }),
    ) as never
    render(<RestoreTask events={[event()]} companies={COMPANIES} />)
    fireEvent.click(screen.getByText("restore.cta"))
    fireEvent.click(screen.getByText("restore.cta"))
    await waitFor(() => expect(screen.getByText("restore.doneNothing")).toBeTruthy())
    expect(screen.queryByText("restore.done(rows=0)")).toBeNull()
  })

  it("does not claim several sequential operations when it will make one", () => {
    render(<RestoreTask events={[event()]} companies={COMPANIES} />)
    fireEvent.click(screen.getByText("restore.cta"))
    expect(screen.queryByText(/restore\.multiCall/)).toBeNull()
  })
})

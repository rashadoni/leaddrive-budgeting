# BS/CF Single-Sheet Import Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This touches the import pipeline — the project's #1-risk area (recurring data corruption). Do NOT skip the reconciliation/clean-slate verification steps or the Codex review.**

**Goal:** Let the single-file **"İstənilən fayl (AI)"** import flow accept **Balance Sheet (BS)** and **Cash Flow (CF)** sheets by routing them to the existing BS/CF adapters (→ `BalanceSheetLine` / `CashFlowEntry`), instead of forcing every sheet through the P&L `applyProposal` (→ `BudgetLine`), which hard-requires all 12 monthly columns and so rejects partial-year BS/CF.

**Architecture:** The apply route currently ALWAYS calls `applyProposal()` (P&L-only). Add a **dataType branch**: when the sheet's classification is `BS` or `CF`, build an `AdapterRunInput` from the uploaded workbook + selected sheet + selected company, fetch the handler from the production adapter registry (`registry.get(dataType)`), and run its `applyToDb()` inside the route's transaction — exactly as `orchestrator.ts` already does for the multi-file flow. P&L (`PLF`) sheets keep the current `applyProposal` path unchanged.

**Tech Stack:** Next.js API route + Prisma; the existing `src/lib/onboarding/ai-import/` adapter registry + handlers; `xlsx`.

---

## Why (root cause, verified 2026-06-22)

- `src/app/api/onboarding/import/staging/[id]/apply/route.ts:327` — the apply handler **unconditionally** calls `applyProposal(...)`. There is NO dataType routing.
- `src/lib/onboarding/ai-mapper/applier.ts:234-240` — `applyProposal` builds `missingMonths` and throws `Proposal missing monthly columns: …. All 12 months required for budget P&L apply.` BS/CF sheets are quarterly snapshots / partial-year (2026 has only Jan–Apr) → rejected at preview/apply.
- `applyProposal` writes **`BudgetLine`** (P&L: revenue/COGS/expense). A Balance Sheet must write **`BalanceSheetLine`**; Cash Flow must write **`CashFlowEntry`**. **Relaxing the 12-month check is NOT a fix** — it would write BS/CF numbers as P&L lines (garbage that the terminal's BS/CF indicators never read).
- The UI confirms the design intent: the İstənilən-fayl tab text says *"Faza 1 — bir P&L vərəqi (balans/pul axını və çoxvərəqli — sonra)"* — single-file flow is P&L-only **by design**; BS/CF were deferred.

The BS/CF adapters already exist and are wired for the **multi-file** flow — this plan reuses them for the single-file flow.

## Reference implementation (the exact pattern to copy)

`src/lib/onboarding/ai-import/orchestrator.ts:140-160` (multi-file flow), per classified sheet:
```ts
const handler = deps.registry.get(cls.dataType)        // dataType: "PLF" | "BS" | "CF" | …
if (!handler) { /* skip with warning */ }
const adapterResult = await handler({
  workbook,                  // XLSX.WorkBook
  sheetName: cls.sheetName,
  entityCode: cls.entityCode, // company code, e.g. "AZSEKER-EDEN"
  year,
  /* …other AdapterRunInput fields… */
})
// later, inside the COMMIT transaction:
await adapterResult.applyToDb(tx, /* … */)
```

- `AdapterRunInput` (`src/lib/onboarding/ai-import/adapter-registry.ts:25`): `{ workbook: XLSX.WorkBook; sheetName: string; entityCode: string | null; year: number; … }`.
- `AdapterRunResult` (`adapter-registry.ts:14`): `{ itemCount; applyToDb: (tx, …) => Promise<{ rowsInserted: number }>; … }`.
- Registry build: `src/lib/onboarding/ai-import/production-adapter-registry.ts` — `BS: wrap(makeBsHandler)`, `CF: wrap(makeCfHandler)` (line ~119). Handlers live in `production-adapter-handlers-financial.ts`.

## Pre-implementation investigation (DO FIRST — resolve before coding)

These were not fully traced during planning; confirm each and write the answer into the task code:

1. **Where the dataType lives for the single-file flow.** The `Vərəq` dropdown renders e.g. `"BS EDEN · BS (98%)"`, so the classifier output IS available. Find whether it is on `staging.proposal` (a field on `MappingProposal`, `src/lib/onboarding/ai-mapper/types.ts:96`), on the `ImportStaging` row, or must be re-derived. The apply route must read it to branch. **Grep:** `grep -rn "dataType\|sheetType\|· BS\|classification" src/lib/onboarding/ai-mapper src/app/api/onboarding/import` and inspect a real staging row's `proposal` JSON in the DB.
2. **Registry instantiation in the route.** Find how the multi-file apply route (`staging/[id]/apply-multi/route.ts`) builds/wires the `production-adapter-registry`, and reuse that exact construction in the single-file route.
3. **Dry-run (preview) for BS/CF.** The single-file route has a `dryRun` path (`route.ts:207`) that calls `applyProposal` to compute the preview (control-totals + 94/85/83-row counts). The BS/CF handler exposes `applyToDb` but may have no dry-run. Decide: either (a) run the handler against a transaction that is **rolled back** for preview, or (b) compute the BS/CF reconciliation from `adapterResult` without writing. Match the existing green/⚠️/🔴 verdict UI.
4. **Reconciliation/control-total surface for BS/CF.** The route's green-gate (`route.ts:417` `commitValidation.verdict === 'blocked'`) is P&L control-totals. BS/CF need their own reconciliation (the adapters build cross-file sums — see `production-adapter-handlers-financial.ts` "cross-file reconciliation sums"). Surface a BS/CF verdict so the same hard-block-on-🔴 rule applies.

---

## File Structure

- **Modify:** `src/app/api/onboarding/import/staging/[id]/apply/route.ts` — add the dataType branch around the `applyProposal` call (line ~327) and the dry-run path (line ~207). The BS/CF branch builds `AdapterRunInput`, gets the handler, runs `applyToDb` inside the existing tx.
- **Create:** `src/lib/onboarding/import/route-adapter-bridge.ts` — a small pure helper `runAdapterSheet({ workbook, sheetName, dataType, entityCode, year, registry, tx })` that encapsulates `registry.get(dataType) → handler(input) → applyToDb(tx)`, so the route stays thin and the logic is unit-testable without a live request. One responsibility: bridge a single classified sheet to its adapter.
- **Test:** `src/lib/onboarding/import/route-adapter-bridge.test.ts` (unit, mocked registry/handler) + extend `src/app/api/onboarding/import/staging/[id]/apply/handler.test.ts` (route-level: BS staging routes to bridge, not applyProposal).

Keep the P&L path byte-identical — only ADD a branch.

---

## Tasks

### Task 1: Pure bridge helper (BS/CF → adapter)

**Files:**
- Create: `src/lib/onboarding/import/route-adapter-bridge.ts`
- Test: `src/lib/onboarding/import/route-adapter-bridge.test.ts`

- [ ] **Step 1 — Write the failing test** (mock a registry + handler; assert the bridge fetches the handler by dataType, passes the right `AdapterRunInput`, and calls `applyToDb` with the tx):

```ts
import { describe, it, expect, vi } from "vitest"
import { runAdapterSheet } from "./route-adapter-bridge"

describe("runAdapterSheet", () => {
  it("routes a BS sheet to its handler and applies in the given tx", async () => {
    const applyToDb = vi.fn(async () => ({ rowsInserted: 42 }))
    const handler = vi.fn(async () => ({ itemCount: 42, applyToDb, warnings: [] }))
    const registry = { get: vi.fn(() => handler) }
    const tx = { __tx: true } as never
    const wb = { SheetNames: ["BS EDEN"], Sheets: {} } as never

    const res = await runAdapterSheet({
      registry: registry as never, tx, workbook: wb,
      sheetName: "BS EDEN", dataType: "BS", entityCode: "AZSEKER-EDEN", year: 2026,
    })

    expect(registry.get).toHaveBeenCalledWith("BS")
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ sheetName: "BS EDEN", entityCode: "AZSEKER-EDEN", year: 2026 }),
    )
    expect(applyToDb).toHaveBeenCalled()
    expect(res.rowsInserted).toBe(42)
  })

  it("returns a skip result when no adapter is registered for the dataType", async () => {
    const registry = { get: vi.fn(() => null) }
    const res = await runAdapterSheet({
      registry: registry as never, tx: {} as never, workbook: { Sheets: {} } as never,
      sheetName: "X", dataType: "UNKNOWN", entityCode: "C", year: 2026,
    })
    expect(res.rowsInserted).toBe(0)
    expect(res.skipped).toBe(true)
  })
})
```

- [ ] **Step 2 — Run it, verify it fails** — `npx vitest run src/lib/onboarding/import/route-adapter-bridge.test.ts` → FAIL ("runAdapterSheet is not defined").
- [ ] **Step 3 — Implement `runAdapterSheet`** mirroring `orchestrator.ts:140-160` (build `AdapterRunInput` from the args, `registry.get(dataType)`, call handler, `applyToDb(tx)`; return `{ rowsInserted, skipped, warnings }`). Use the EXACT `AdapterRunInput` field set confirmed in pre-impl investigation #2.
- [ ] **Step 4 — Run it, verify it passes.**
- [ ] **Step 5 — Commit** `feat(import): pure bridge to route a single classified sheet to its BS/CF adapter`.

### Task 2: Route the apply path by dataType

**Files:**
- Modify: `src/app/api/onboarding/import/staging/[id]/apply/route.ts` (the `applyProposal` call ~line 327 and the dry-run path ~line 207)
- Test: `src/app/api/onboarding/import/staging/[id]/apply/handler.test.ts`

- [ ] **Step 1 — Write the failing route test:** a staging whose classification dataType is `BS` POSTed to apply → asserts the bridge (`runAdapterSheet`, mocked) is called and `applyProposal` is NOT. Mirror the existing handler-test mock setup. (Resolve pre-impl #1 to know how the test sets the dataType on the staging mock.)
- [ ] **Step 2 — Run, verify it fails.**
- [ ] **Step 3 — Implement the branch:** read the staging dataType (pre-impl #1). `if (dataType === "PLF" | "P&L") { …existing applyProposal… } else { runAdapterSheet({ … }) }`. Build the workbook by parsing the re-uploaded file (already available in the route). Wire the registry (pre-impl #2). Keep the audit-log, rate-limit, auth, and 🔴-hard-block gates intact for BOTH paths.
- [ ] **Step 4 — Run, verify it passes** + run the full route test file.
- [ ] **Step 5 — Commit** `feat(import): route BS/CF staging sheets to their adapters in the single-file apply`.

### Task 3: Dry-run preview verdict for BS/CF

**Files:** Modify the same route's `dryRun` path (~line 207) + the bridge.

- [ ] Implement per pre-impl #3 + #4 — a write-less preview that yields the same `{ writeCount, replaceCount, warnings, reconciliationVerdict }` shape the UI already renders for P&L, so the operator sees a 🟢/⚠️/🔴 before committing. **Hard-block on 🔴** (parity with the P&L gate). TDD each piece; commit.

### Task 4: End-to-end verification on real data

- [ ] **Manual (no test code):** in the running app, single-file flow, Şirkət = `AZSEKER-EDEN`, file = `Guvven Fin.xlsx`, Vərəq = `BS EDEN` → Önizləmə shows 🟢 (no "12 months" error) → Tətbiq et.
- [ ] **DB check:** `BalanceSheetLine` rows exist for EDEN, year 2026, `deletedAt: null`; count matches the sheet's leaf accounts; `companyId` = EDEN (NOT L1/CPC); no `companyId: null` orphans. Repeat one `CF …` sheet → `CashFlowEntry` rows present, scoped by the `<code>::` sourceId prefix.

---

## Risks (import = the project's #1 recurring failure — treat as high-risk)

- **Wrong-table writes:** the whole point is BS→`BalanceSheetLine`, CF→`CashFlowEntry`. A mis-route writes BS as P&L `BudgetLine` (garbage). The Task-2 route test (BS does NOT call `applyProposal`) guards this.
- **Clean-slate / collateral deletion:** BS/CF adapters clean-slate per company+year before insert. Re-confirm the `collateral-guard` (`src/lib/onboarding/collateral-guard.ts`) covers the BS/CF batch paths (it already does for the multi-file flow). Never broaden a clean-slate WHERE. See memory `project_import_clean_slate_guard`.
- **Entity attribution:** use the **selected** `Şirkət` (company picker) as `entityCode`, exactly like the P&L path — do NOT rely on the classifier's per-sheet entity for the single-file flow (the operator chose the company). This is the bug that put CPC's P&L on EDEN on 2026-06-22.
- **No plan-fork:** BS/CF are NOT `BudgetPlan`-scoped (company+year), so the plan-rename fork that bit the P&L import does not apply here.
- **Codex review REQUIRED** before merge — modifying a destructive import route is the exact risk class the project gates on Codex/architect review.

## Definition of done

- `npx tsc --noEmit` = 0; `npx vitest run src/lib/onboarding src/app/api/onboarding` green.
- BS EDEN + CF EDEN import via the single-file flow; DB shows `BalanceSheetLine`/`CashFlowEntry` on EDEN; no orphans; P&L untouched.
- Codex sign-off on the route diff.
- `docs/ROADMAP.md` changelog updated.

## Context the implementer needs (state as of 2026-06-22)

- P&L for CPC/AZSF/EDEN is already imported and verified (in plan `Azərşəkər 2026 Actuals`, 3144 lines). Do NOT touch it.
- The 12-month requirement lives in `applier.ts:240` and is CORRECT for P&L — leave it; just don't send BS/CF through `applyProposal`.
- The multi-file flow (`Bir neçə fayl` / `orchestrator.ts`) is the working reference for adapter routing — read it first.

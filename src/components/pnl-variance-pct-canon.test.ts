/**
 * 2026-08-18 — the KƏNARLAŞMA tile said "243%".
 *
 * `exec-pct.ts` was extracted precisely because two inline copies of the
 * execution formula had drifted. A THIRD copy then appeared in
 * `pnl-performance-charts.tsx` — no [0,200] clamp, no zero-budget guard —
 * and its number (an execution percent) was rendered as the suffix of the
 * VARIANCE tile. On real data (EBITDA budget −632,059, fact +271,160) the
 * tile read "+903k AZN · 243%", where the honest deviation is +143% and the
 * canonical execution percent is a clamped 200%.
 *
 * Two pins:
 *   1. the tile's number is the canonical `varPct` on the incident pair;
 *   2. the component defines no percent formula of its own — it must import
 *      one of the canonical modules, because counting on review to catch the
 *      fourth copy is how we got the third.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { varPct } from "@/lib/budgeting/var-pct"
import { execPct } from "@/lib/budgeting/exec-pct"

const COMPONENT = readFileSync(
  join(process.cwd(), "src/components/pnl-performance-charts.tsx"),
  "utf8",
)

describe("variance tile percent — one formula, owned by lib/budgeting", () => {
  it("the incident pair renders the canonical numbers", () => {
    // EBITDA Jan–May 2026 on actual-budget-v1.xlsx: budget −632,059,
    // computed fact +271,160.
    expect(varPct(271160, -632059)).toBeCloseTo(142.9, 1)
    expect(execPct(271160, -632059)).toBe(200) // clamped, not 243
  })

  it("varPct declines a zero budget instead of dividing by it", () => {
    expect(varPct(123, 0)).toBeNull()
  })

  it("the component imports a canonical percent and defines none", () => {
    expect(COMPONENT).toMatch(/from "@\/lib\/budgeting\/var-pct"/)
    // The drifted copy's signature — any resurrection fails here by name.
    expect(COMPONENT).not.toMatch(/function executionPercent/)
    // And by shape: the "100 +" trick is the execution formula's fingerprint;
    // a component has no business computing it inline.
    expect(COMPONENT).not.toMatch(/100 \+/)
  })
})

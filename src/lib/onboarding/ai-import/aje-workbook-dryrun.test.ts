// @vitest-environment node
/**
 * Dry-run: the AJE fold, end to end, against the REAL client workbook.
 *
 * `plf-workbook-dryrun.test.ts` checks the four operating entities with AJE
 * excluded on both sides of the equation, so it cannot see this defect. This
 * one runs the actual routing path — `applyBuColumnSplit`, the function that
 * decides which BU block reaches a company — and checks the result against two
 * subtotal rows the client computes and we never import:
 *
 *   Σ PLF.08 over BU_1 = EDEN   = 12,413,357.67   (EDEN + CPC + AJE)
 *   Σ PLF.08 over every BU_3    = 14,213,416.88   (the group)
 *
 * Before the fold, AJE was dropped and the group read 15,890,431.51 — 1.68M
 * too profitable — while legal entity EDEN read 14,090,372.30.
 *
 * The workbook is client data and is not in the repository, so this skips when
 * it is absent. Point `PLF_DRYRUN_WORKBOOK` at a copy to run it:
 *
 *   PLF_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run aje-workbook-dryrun
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { applyBuColumnSplit } from "./bu-column-split"
import { buildEntityAliasMap } from "./entity-inference"
import { parsePlfPlSheet } from "../adapters/azseker-plf"
import {
  otherOperatingContribution,
  pnlSectionFromCode,
  revenueContribution,
} from "../../budgeting/coa-role"
import { computeEbitda } from "../../budgeting/ebitda"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)

const SHEET = "PLF Budget 2026"
/** Half a qəpik — the tolerance the reconciliation layer already uses. */
const TOL = 0.005

const ALIAS_MAP = buildEntityAliasMap(
  ["AZSEKER", "AZSEKER-EDEN", "AZSEKER-CPC", "AZSEKER-PROMALT", "AZSEKER-AZSF"],
  { AZSF: "AZSEKER-AZSF", PROMALT: "AZSEKER-PROMALT" },
)

interface Run {
  /** Parsed EBITDA per virtual sheet, keyed by the company it routes to. */
  ebitdaByEntity: Map<string, number>
  /** Which BU values were written, and where. */
  mapping: Array<{ buValue: string; entityCode: string | null; action: string }>
  /** Σ of the sheet's own PLF.08 row, per BU_3 value. */
  plf08ByBu3: Map<string, number>
  /** Σ of the sheet's own PLF.08 row, per BU_1 (legal entity) value. */
  plf08ByBu1: Map<string, number>
  warnings: string[]
}

function readWorkbook(path: string): Run {
  const wb = XLSX.read(fs.readFileSync(path), { type: "buffer" })

  // ── The client's own arithmetic, read straight off the raw grid ─────────
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const header = aoa[0]
  const col = (name: string): number => {
    const i = header.findIndex((h) => String(h ?? "").trim() === name)
    if (i < 0) throw new Error(`no "${name}" column`)
    return i
  }
  const bu1 = col("BU_1")
  const bu3 = col("BU_3")
  const monthCols: number[] = []
  for (let c = 0; c < header.length; c++) {
    const v = header[c]
    if (typeof v === "number" && v >= 46023 && v <= 46357) monthCols.push(c)
  }
  const plf08ByBu3 = new Map<string, number>()
  const plf08ByBu1 = new Map<string, number>()
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    if (String(row[0] ?? "").trim() !== "PLF.08") continue
    let sum = 0
    for (const c of monthCols) {
      const v = row[c]
      if (typeof v === "number" && Number.isFinite(v)) sum += v
    }
    const k3 = String(row[bu3] ?? "").trim()
    const k1 = String(row[bu1] ?? "").trim()
    plf08ByBu3.set(k3, (plf08ByBu3.get(k3) ?? 0) + sum)
    plf08ByBu1.set(k1, (plf08ByBu1.get(k1) ?? 0) + sum)
  }

  // ── The routing path under test ─────────────────────────────────────────
  const split = applyBuColumnSplit(wb, XLSX, {
    sheetName: SHEET,
    dataType: "PLF",
    planKind: "budget",
    aliasMap: ALIAS_MAP,
  })

  const ebitdaByEntity = new Map<string, number>()
  for (const entry of split.sheetMapEntries) {
    // The split always names its virtual sheets literally.
    if (typeof entry.match !== "string") throw new Error("expected a literal sheet name")
    const parsed = parsePlfPlSheet(wb, entry.match, XLSX, { preferYear: 2026 })
    let revenue = 0
    let cogs = 0
    let otherOperating = 0
    let opex = 0
    let belowEbitda = 0
    for (const line of parsed.lines) {
      const section = pnlSectionFromCode(line.code, line.accountType)
      const amount = line.totalAnnual
      if (section === "revenue") revenue += revenueContribution(line.code, amount)
      else if (section === "cogs") cogs += amount
      else if (section === "otherOperating") {
        otherOperating += otherOperatingContribution(line.code, amount)
      } else if (section === "opex") opex += amount
      else if (section === "belowEbitda") belowEbitda += amount
    }
    const breakdown = computeEbitda({
      totalRevenue: revenue,
      totalCogs: cogs,
      totalOpex: opex,
      totalOtherOperating: otherOperating,
      totalBelowEbitda: belowEbitda,
      daInCogs: 0,
      daInOpex: 0,
    })
    ebitdaByEntity.set(
      entry.entityCode ?? "(none)",
      (ebitdaByEntity.get(entry.entityCode ?? "(none)") ?? 0) + breakdown.ebitda,
    )
  }

  return {
    ebitdaByEntity,
    mapping: split.mapping.map((m) => ({
      buValue: m.buValue,
      entityCode: m.entityCode,
      action: m.action,
    })),
    plf08ByBu3,
    plf08ByBu1,
    warnings: split.warnings,
  }
}

describe.skipIf(!AVAILABLE)("dry-run: the AJE block reaches a company", () => {
  const run: Run = AVAILABLE
    ? readWorkbook(WORKBOOK)
    : {
        ebitdaByEntity: new Map(),
        mapping: [],
        plf08ByBu3: new Map(),
        plf08ByBu1: new Map(),
        warnings: [],
      }

  it("routes AJE to AZSEKER-EDEN as a write, not a skip", () => {
    const aje = run.mapping.find((m) => m.buValue === "AJE")!
    expect(aje).toBeDefined()
    expect(aje.action).toBe("write")
    expect(aje.entityCode).toBe("AZSEKER-EDEN")
  })

  it("creates exactly four virtual sheets — AJE gets no company of its own", () => {
    const written = run.mapping.filter((m) => m.action === "write")
    expect(new Set(written.map((m) => m.entityCode))).toEqual(
      new Set(["AZSEKER-EDEN", "AZSEKER-AZSF", "AZSEKER-PROMALT", "AZSEKER-CPC"]),
    )
    expect(run.ebitdaByEntity.size).toBe(4)
  })

  it("says in the warnings which column attributed it", () => {
    expect(
      run.warnings.some(
        (w) => w.includes('"AJE"') && w.includes("BU_1") && w.includes("AZSEKER-EDEN"),
      ),
    ).toBe(true)
  })

  it("legal entity EDEN ties to 12,413,357.67 — the sheet's own BU_1 PLF.08", () => {
    // EDEN 11,962,639.82 + CPC 2,127,732.48 + AJE (−1,677,014.63). Without the
    // fold this read 14,090,372.30.
    const edenLegal =
      run.ebitdaByEntity.get("AZSEKER-EDEN")! + run.ebitdaByEntity.get("AZSEKER-CPC")!
    expect(edenLegal).toBeCloseTo(12_413_357.67, 2)
    expect(Math.abs(edenLegal - run.plf08ByBu1.get("EDEN")!)).toBeLessThan(TOL)
  })

  it("group EBITDA drops by exactly the adjustment, to the sheet's own total", () => {
    const group = [...run.ebitdaByEntity.values()].reduce((s, v) => s + v, 0)
    const sheetGroup = [...run.plf08ByBu3.values()].reduce((s, v) => s + v, 0)
    expect(Math.abs(group - sheetGroup)).toBeLessThan(TOL)
    expect(group).toBeCloseTo(14_213_416.88, 2)
    // …which is 1,677,014.63 below what dropping AJE reported.
    expect(group + 1_677_014.63).toBeCloseTo(15_890_431.51, 2)
  })

  it("only EDEN moves — the other three entities are untouched by the fold", () => {
    for (const [entity, bu3] of [
      ["AZSEKER-AZSF", "AZSF"],
      ["AZSEKER-PROMALT", "ProMalt"],
      ["AZSEKER-CPC", "CPC"],
    ] as const) {
      expect(
        Math.abs(run.ebitdaByEntity.get(entity)! - run.plf08ByBu3.get(bu3)!),
      ).toBeLessThan(TOL)
    }
    // EDEN's company now carries its own block PLUS the adjustment.
    expect(
      Math.abs(
        run.ebitdaByEntity.get("AZSEKER-EDEN")! -
          (run.plf08ByBu3.get("EDEN")! + run.plf08ByBu3.get("AJE")!),
      ),
    ).toBeLessThan(TOL)
  })
})

// @vitest-environment node
// Locks the canonical-fact emission so the LEGAL/AUDIT indicators light up
// straight from the import (no separate alias step). They went dark once when a
// later clean-slate wiped the facts — this guards against re-darkening.
import { describe, it, expect, vi } from "vitest"
import * as XLSX from "xlsx"
import { makeLegalCasesHandler, makeAuditFindingsHandler } from "./production-adapter-handlers-soft"
import type { OrgContext } from "./prod-adapter-context"

function ctx(): OrgContext {
  return {
    organizationId: "org_1",
    year: 2025,
    codeToId: new Map([["AZSEKER-AZSF", "co_azsf"], ["AZSEKER-CPC", "co_cpc"]]),
    planId: "p",
    orgCompanies: [],
    deptLabelToId: new Map(),
  } as unknown as OrgContext
}
function tx() {
  const created: Array<{ metric: string; value: number; companyId: string }> = []
  const t = {
    operationalFact: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async (a: { data: Array<{ metric: string; value: number; companyId: string }> }) => {
        created.push(...a.data)
        return { count: a.data.length }
      }),
    },
    company: {
      findUnique: vi.fn(async () => ({ settings: {} })),
      update: vi.fn(async () => ({})),
    },
  }
  return { t, created }
}
function sheet(rows: unknown[][], name: string, headerRows: number): XLSX.WorkBook {
  const aoa = [...Array.from({ length: headerRows }, () => ["H"]), ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, name)
  return book
}

describe("compliance adapters emit canonical indicator facts", () => {
  it("LEGAL_CASES adapter writes canonical total and active counts", async () => {
    const wb = sheet(
      [
        [1, "2026", "Bakı", "ATS", "CPC MMC", "mülki", "d", "", "", "davam edir"],
        [2, "2026", "Bakı", "ATS", "CPC MMC", "mülki", "d", "", "", "icraata xitam verilib"], // closed
      ],
      "Məhkəmə mübahisələri",
      3,
    )
    const handler = makeLegalCasesHandler({} as never, { value: null }, async () => ctx())
    const res = await handler({ workbook: wb, sheetName: "Məhkəmə mübahisələri", entityCode: null, year: 2025, organizationId: "org_1", XLSX } as never)
    const { t, created } = tx()
    await res.applyToDb(t as never)
    const total = created.find((f) => f.metric === "LEGAL_CASES_TOTAL")
    const active = created.find((f) => f.metric === "LEGAL_CASES_ACTIVE")
    expect(total?.value).toBe(2)
    expect(active?.value).toBe(1) // 2 cases, 1 closed → 1 active
    expect(active!.companyId).toBe("co_cpc")
    expect(t.operationalFact.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org_1",
        companyId: "co_cpc",
        metric: {
          in: expect.arrayContaining(["LEGAL_CASES_TOTAL", "LEGAL_CASES_ACTIVE"]),
        },
      }),
    })
  })

  it("AUDIT_FINDINGS adapter writes AUDIT_CLOSED_PCT + AUDIT_MAJOR_OPEN", async () => {
    const row = (sev: string, status: string) => [1, sev, "HR", "Azərşəkər", "Audit", "2026-01", status, "G", "", "open"]
    const wb = sheet([row("Major", "davam edir"), row("Minor", "Yerinə yetirilib")], "Follow-up", 2)
    const handler = makeAuditFindingsHandler({} as never, { value: null }, async () => ctx())
    const res = await handler({ workbook: wb, sheetName: "Follow-up", entityCode: null, year: 2025, organizationId: "org_1", XLSX } as never)
    const { t, created } = tx()
    await res.applyToDb(t as never)
    const pct = created.find((f) => f.metric === "AUDIT_CLOSED_PCT")
    const major = created.find((f) => f.metric === "AUDIT_MAJOR_OPEN")
    expect(pct?.value).toBe(50) // 1 of 2 completed
    expect(major?.value).toBe(1) // 1 open major
    expect(t.operationalFact.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org_1",
        companyId: "co_azsf",
      }),
    })
  })
})

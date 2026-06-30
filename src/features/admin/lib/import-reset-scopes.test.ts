import { describe, expect, it } from "vitest"
import { buildImportResetScopes } from "./import-reset-scopes"

describe("buildImportResetScopes", () => {
  it("offers one whole-holding scope when a single root contains all active companies", () => {
    const scopes = buildImportResetScopes({
      organizationName: "FO Holding",
      companies: [
        { id: "h1", code: "AZSEKER", name: "AzerSheker", level: 1, parentCompanyId: null },
        { id: "c1", code: "AZSEKER-CPC", name: "CPC MMC", level: 2, parentCompanyId: "h1" },
        { id: "c2", code: "AZSEKER-EDEN", name: "EDEN AGRO MMC", level: 2, parentCompanyId: "h1" },
      ],
    })

    expect(scopes[0]).toMatchObject({
      id: "holding:AZSEKER",
      kind: "holding",
      code: "AZSEKER",
      name: "FO Holding",
      rootCode: "AZSEKER",
      companyCodes: ["AZSEKER", "AZSEKER-CPC", "AZSEKER-EDEN"],
      companyCount: 3,
    })
    expect(scopes.filter((scope) => scope.kind === "company").map((scope) => scope.code)).toEqual([
      "AZSEKER-CPC",
      "AZSEKER-EDEN",
    ])
  })

  it("adds an org-wide holding scope when several root groups exist", () => {
    const scopes = buildImportResetScopes({
      organizationName: "FO Holding",
      companies: [
        { id: "h1", code: "AZSEKER", name: "AzerSheker", level: 1, parentCompanyId: null },
        { id: "h2", code: "TABIA", name: "Tabia Group", level: 1, parentCompanyId: null },
        { id: "c1", code: "AZSEKER-CPC", name: "CPC MMC", level: 2, parentCompanyId: "h1" },
        { id: "c2", code: "TABIA-HOTEL", name: "Tabia Hotel", level: 2, parentCompanyId: "h2" },
      ],
    })

    expect(scopes[0]).toMatchObject({
      id: "holding:__all__",
      kind: "holding",
      code: "__all__",
      name: "FO Holding",
      companyCodes: ["AZSEKER", "TABIA", "AZSEKER-CPC", "TABIA-HOTEL"],
      companyCount: 4,
    })
    expect(scopes.filter((scope) => scope.kind === "holding").map((scope) => scope.id)).toEqual([
      "holding:__all__",
      "holding:AZSEKER",
      "holding:TABIA",
    ])
  })
})

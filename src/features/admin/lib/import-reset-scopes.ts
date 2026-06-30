export type ImportResetScopeKind = "holding" | "company"

export interface ImportResetCompanyRow {
  id: string
  code: string
  name: string
  level: number
  parentCompanyId: string | null
}

export interface ImportResetScopeOption {
  id: string
  kind: ImportResetScopeKind
  code: string
  name: string
  rootCode?: string
  companyCodes: string[]
  companyCount: number
}

export function buildImportResetScopes({
  organizationName,
  companies,
}: {
  organizationName: string
  companies: ReadonlyArray<ImportResetCompanyRow>
}): ImportResetScopeOption[] {
  const active = companies.filter((c) => c.code)
  const allCodes = unique(active.map((c) => c.code))
  const childrenByParent = new Map<string, ImportResetCompanyRow[]>()
  for (const company of active) {
    if (!company.parentCompanyId) continue
    const list = childrenByParent.get(company.parentCompanyId) ?? []
    list.push(company)
    childrenByParent.set(company.parentCompanyId, list)
  }

  const rawHoldingScopes: ImportResetScopeOption[] = []
  for (const root of active.filter((c) => c.level <= 1 || !c.parentCompanyId)) {
    const children = childrenByParent.get(root.id) ?? []
    const companyCodes = unique([root.code, ...children.map((child) => child.code)])
    if (companyCodes.length <= 1) continue
    rawHoldingScopes.push({
      id: `holding:${root.code}`,
      kind: "holding",
      code: root.code,
      rootCode: root.code,
      name: root.name,
      companyCodes,
      companyCount: companyCodes.length,
    })
  }

  const scopes: ImportResetScopeOption[] = []
  const singleRootCoversOrg =
    rawHoldingScopes.length === 1 && sameCodeSet(rawHoldingScopes[0].companyCodes, allCodes)

  if (singleRootCoversOrg) {
    const rootScope = rawHoldingScopes[0]
    scopes.push({
      ...rootScope,
      name: organizationName || rootScope.name,
    })
  } else {
    if (allCodes.length > 1) {
      scopes.push({
        id: "holding:__all__",
        kind: "holding",
        code: "__all__",
        name: organizationName,
        companyCodes: allCodes,
        companyCount: allCodes.length,
      })
    }
    scopes.push(...rawHoldingScopes)
  }

  for (const company of active.filter((c) => c.level > 1)) {
    scopes.push({
      id: `company:${company.code}`,
      kind: "company",
      code: company.code,
      name: company.name,
      companyCodes: [company.code],
      companyCount: 1,
    })
  }

  return scopes
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function sameCodeSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((code) => bSet.has(code))
}

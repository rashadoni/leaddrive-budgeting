// Stub: cost model DB functions not used in standalone budgeting
export async function loadAndCompute(_orgId: string) {
  return {
    departments: {},
    grandTotalG: 0,
    serviceRevenues: { total: 0 },
    serviceDetails: {} as Record<string, any>,
    deptCosts: {},
  }
}

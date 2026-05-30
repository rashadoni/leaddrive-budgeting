/**
 * Phase 1 "Crisis Brief" — worst-first cascade ordering for the scenario
 * reflow. Only cells whose status CHANGED participate; red leads, then amber,
 * then green/unknown. Returns "companyId:code" keys in flip order. Pure.
 *
 * Sort is stable (Array.prototype.sort is stable in modern engines), so ties
 * within a rank keep input order.
 */
export type CascadeDeltaLite = {
  companyId: string
  code: string
  scenarioStatus: string | null
  changed: boolean
}

const RANK: Record<string, number> = { red: 0, amber: 1, green: 2, unknown: 3 }

export function orderCascade(deltas: CascadeDeltaLite[]): string[] {
  return deltas
    .filter((d) => d.changed && d.scenarioStatus)
    .sort((a, b) => (RANK[a.scenarioStatus!] ?? 9) - (RANK[b.scenarioStatus!] ?? 9))
    .map((d) => `${d.companyId}:${d.code}`)
}

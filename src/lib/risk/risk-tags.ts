/** Canonical risk-tag values shared by the API validator and client editor. */
export const RISK_TAGS = [
  "subsidy_dependency",
  "non_transparent_structure",
  "data_absence",
] as const

export type RiskTag = (typeof RISK_TAGS)[number]

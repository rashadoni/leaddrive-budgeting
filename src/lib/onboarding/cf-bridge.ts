/**
 * Canonical Cash Flow activity classification shared by the static and
 * dynamic onboarding adapters.
 *
 * CF.01–CF.03 are cash movements. CF.04–CF.07 are statement bridge evidence:
 * they must be persisted with a non-movement activity so ordinary cash-flow
 * totals cannot count them a second time.
 */

export const CASH_FLOW_MOVEMENT_ACTIVITIES = [
  "operating",
  "investing",
  "financing",
] as const

export type CashFlowMovementActivity =
  (typeof CASH_FLOW_MOVEMENT_ACTIVITIES)[number]

export const CASH_FLOW_BRIDGE_ACTIVITY = "bridge" as const

export type CashFlowStoredActivity =
  | CashFlowMovementActivity
  | typeof CASH_FLOW_BRIDGE_ACTIVITY

export type CashFlowBridgeKind =
  | "fx_effect_on_cash"
  | "net_change_in_cash"
  | "opening_cash"
  | "closing_cash"

export interface CashFlowCodeClassification {
  activityType: CashFlowStoredActivity
  bridgeKind: CashFlowBridgeKind | null
}

const BRIDGE_KIND_BY_SECTION: Readonly<Record<string, CashFlowBridgeKind>> = {
  "04": "fx_effect_on_cash",
  "05": "net_change_in_cash",
  "06": "opening_cash",
  "07": "closing_cash",
}

/** Classify a Workbook-style CF code without guessing from its label. */
export function classifyCashFlowCode(
  code: string,
): CashFlowCodeClassification | null {
  const match = code.trim().match(/^CF\.(\d{2})(?:\.|$)/)
  if (!match) return null

  if (match[1] === "01") {
    return { activityType: "operating", bridgeKind: null }
  }
  if (match[1] === "02") {
    return { activityType: "investing", bridgeKind: null }
  }
  if (match[1] === "03") {
    return { activityType: "financing", bridgeKind: null }
  }

  const bridgeKind = BRIDGE_KIND_BY_SECTION[match[1]]
  return bridgeKind
    ? { activityType: CASH_FLOW_BRIDGE_ACTIVITY, bridgeKind }
    : null
}

export function isCashFlowBridgeActivity(
  activityType: string,
): activityType is typeof CASH_FLOW_BRIDGE_ACTIVITY {
  return activityType === CASH_FLOW_BRIDGE_ACTIVITY
}

export function isCashFlowMovementActivity(
  activityType: string,
): activityType is CashFlowMovementActivity {
  return (CASH_FLOW_MOVEMENT_ACTIVITIES as readonly string[]).includes(
    activityType,
  )
}

/**
 * Drop bridge subtotal ancestors when a more specific descendant is present.
 * Sibling leaves are all retained; only a code that prefixes another code on a
 * segment boundary is removed. This prevents CF.04 + CF.04.01.01 double count.
 */
export function selectLeafMostCashFlowBridgeCodes(
  codes: ReadonlyArray<string>,
): ReadonlySet<string> {
  const uniqueBridgeCodes = [
    ...new Set(
      codes
        .map((code) => code.trim())
        .filter(
          (code) => classifyCashFlowCode(code)?.activityType === "bridge",
        ),
    ),
  ]
  return new Set(
    uniqueBridgeCodes.filter(
      (candidate) =>
        !uniqueBridgeCodes.some(
          (other) =>
            other !== candidate && other.startsWith(`${candidate}.`),
        ),
    ),
  )
}

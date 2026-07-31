export interface ProductVarianceInputLine {
  productId: string
  productName: string
  month: number
  amount: number
  quantity?: number | null
}

export interface ProductVarianceRow {
  productId: string
  productName: string
  budgetAmount: number
  actualAmount: number
  variance: number
  variancePct: number | null
  budgetQty: number
  actualQty: number
  budgetUnitRate: number | null
  actualUnitRate: number | null
  rateVariance: number | null
  volumeVariance: number | null
  mixVariance: number | null
  hasRateVolume: boolean
}

interface ProductBucket {
  productId: string
  productName: string
  amount: number
  quantity: number
}

export function buildProductVarianceRows(args: {
  budgetLines: ProductVarianceInputLine[]
  actualLines: ProductVarianceInputLine[]
}): ProductVarianceRow[] {
  const budget = aggregateByProduct(args.budgetLines)
  const actual = aggregateByProduct(args.actualLines)
  const productIds = new Set([...budget.keys(), ...actual.keys()])

  return Array.from(productIds)
    .map((productId) => {
      const b = budget.get(productId)
      const a = actual.get(productId)
      const productName = a?.productName || b?.productName || productId
      const budgetAmount = b?.amount ?? 0
      const actualAmount = a?.amount ?? 0
      const budgetQty = b?.quantity ?? 0
      const actualQty = a?.quantity ?? 0
      const budgetUnitRate = budgetQty > 0 ? budgetAmount / budgetQty : null
      const actualUnitRate = actualQty > 0 ? actualAmount / actualQty : null
      const hasRateVolume = budgetUnitRate != null && actualUnitRate != null
      const variance = actualAmount - budgetAmount
      const rateVariance = hasRateVolume ? (actualUnitRate - budgetUnitRate) * actualQty : null
      const volumeVariance = hasRateVolume ? (actualQty - budgetQty) * budgetUnitRate : null
      const mixVariance = hasRateVolume && rateVariance != null && volumeVariance != null
        ? variance - rateVariance - volumeVariance
        : null

      return {
        productId,
        productName,
        budgetAmount,
        actualAmount,
        variance,
        variancePct: budgetAmount !== 0 ? (variance / Math.abs(budgetAmount)) * 100 : actualAmount !== 0 ? 100 : null,
        budgetQty,
        actualQty,
        budgetUnitRate,
        actualUnitRate,
        rateVariance,
        volumeVariance,
        mixVariance,
        hasRateVolume,
      }
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
}

/**
 * Stable identifiers for the coverage notices. The renderer resolves each
 * one through `budgeting.productVarianceMissing.<code>` so the amber
 * banner speaks the viewer's language; `missingMessages` keeps the old
 * English literals for non-UI callers (and the existing unit tests).
 */
export type ProductVarianceMissingCode = "budgetRows" | "actualRows" | "rateVolume"

export function productVarianceCoverage(rows: ProductVarianceRow[]): {
  hasBudget: boolean
  hasActual: boolean
  hasRateVolume: boolean
  missingCodes: ProductVarianceMissingCode[]
  missingMessages: string[]
} {
  const hasBudget = rows.some((row) => row.budgetAmount !== 0)
  const hasActual = rows.some((row) => row.actualAmount !== 0)
  const hasRateVolume = rows.some((row) => row.hasRateVolume)
  const missingCodes: ProductVarianceMissingCode[] = []
  const missingMessages: string[] = []

  if (!hasBudget) {
    missingCodes.push("budgetRows")
    missingMessages.push("Budget product rows are not available for this year.")
  }
  if (!hasActual) {
    missingCodes.push("actualRows")
    missingMessages.push("Actual product rows are not available for this year.")
  }
  if (!hasRateVolume) {
    missingCodes.push("rateVolume")
    missingMessages.push("Price/volume variance needs quantity and unit price/unit cost in both budget and actual imports.")
  }

  return { hasBudget, hasActual, hasRateVolume, missingCodes, missingMessages }
}

function aggregateByProduct(lines: ProductVarianceInputLine[]): Map<string, ProductBucket> {
  const buckets = new Map<string, ProductBucket>()
  for (const line of lines) {
    const bucket = buckets.get(line.productId) ?? {
      productId: line.productId,
      productName: line.productName,
      amount: 0,
      quantity: 0,
    }
    bucket.amount += finite(line.amount)
    bucket.quantity += finite(line.quantity)
    buckets.set(line.productId, bucket)
  }
  return buckets
}

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

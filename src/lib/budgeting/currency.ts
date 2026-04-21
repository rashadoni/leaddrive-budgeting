import { prisma } from "@/lib/prisma"

/**
 * Convert an amount from a foreign currency to the org's base currency.
 * If currencyCode is null/undefined or matches base, returns amount unchanged.
 */
export function convertToBase(
  amount: number,
  exchangeRate: number | null | undefined,
): number {
  if (!exchangeRate || exchangeRate === 1) return amount
  return amount * exchangeRate
}

/**
 * Get the latest exchange rate for a currency within an org.
 * Falls back to the Currency table if no history entry exists.
 */
export async function getRate(
  orgId: string,
  currencyCode: string,
): Promise<number> {
  // First check CurrencyRateHistory for the most recent rate
  const historyRate = await prisma.currencyRateHistory.findFirst({
    where: { organizationId: orgId, currencyCode },
    orderBy: { rateDate: "desc" },
  })
  if (historyRate) return historyRate.rate

  // Fallback to Currency table
  const currency = await prisma.currency.findFirst({
    where: { organizationId: orgId, code: currencyCode },
  })
  if (currency) return currency.exchangeRate

  // Default: 1 (assume base currency)
  return 1
}

/**
 * Get base currency code for an org.
 */
export async function getBaseCurrency(orgId: string): Promise<string> {
  const base = await prisma.currency.findFirst({
    where: { organizationId: orgId, isBase: true },
  })
  return base?.code || "AZN"
}

/**
 * Process currency fields for a line/actual creation.
 * If currencyCode is provided, look up or use provided exchangeRate,
 * store originalAmount, and convert plannedAmount to base.
 */
export async function processCurrencyFields(
  orgId: string,
  amount: number,
  currencyCode?: string | null,
  exchangeRate?: number | null,
): Promise<{
  plannedAmount: number
  currencyCode: string | null
  exchangeRate: number | null
  originalAmount: number | null
}> {
  if (!currencyCode) {
    return {
      plannedAmount: amount,
      currencyCode: null,
      exchangeRate: null,
      originalAmount: null,
    }
  }

  // Get base currency
  const baseCurrency = await getBaseCurrency(orgId)
  if (currencyCode === baseCurrency) {
    return {
      plannedAmount: amount,
      currencyCode: null,
      exchangeRate: null,
      originalAmount: null,
    }
  }

  // Get exchange rate if not provided
  const rate = exchangeRate || (await getRate(orgId, currencyCode))

  return {
    plannedAmount: convertToBase(amount, rate),
    currencyCode,
    exchangeRate: rate,
    originalAmount: amount,
  }
}

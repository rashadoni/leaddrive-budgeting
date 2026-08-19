/**
 * Per-product gross margin read off the P&L chart of accounts (2026-08-19).
 *
 * The owner asked for `(revenue − cogs) / revenue` with wheat, cotton and the
 * rest stated separately. `product-margin.ts` already knows how to say that
 * honestly; what was missing was a source of paired revenue and cost. The
 * product-sales tables cannot supply it — they carry the processing plant's
 * own budget sheet and nothing for the farming side — but the customer's P&L
 * chart already does:
 *
 *     PLF.01.01.05  Revenue from Sale of Cotton
 *     PLF.02.01.05  Cotton Costs
 *
 * The two halves of a product sit at the same position under different
 * sections, so the pairing rule is structural: drop the `PLF.0N` head and what
 * remains identifies the product. Measured against the client's chart, that
 * rule pairs 19 of 23 revenue accounts and leaves no cost account orphaned.
 *
 * ## Why the code prefix and not the role layer
 *
 * `plfNature` tells you a code is revenue or cogs; it cannot tell you WHICH
 * cost belongs to WHICH revenue, because that information lives only in the
 * code's position. So the pairing has to be structural. It is still checked
 * against `plfNature` rather than trusting the string: a code is only eligible
 * as revenue or cost if the canonical classifier agrees, which keeps the
 * sheet's own subtotal rows (`PLF.03`, `PLF.08`, …) out of a product table
 * they would otherwise double every line of.
 *
 * ## Returns and discounts are not products
 *
 * `PLF.01.10.01` (Sales Return) and `PLF.01.10.02` (Discounts) classify as
 * revenue and have no cost counterpart, so the naive reading files them beside
 * wheat as products whose margin is unknown. They are neither: they are
 * contra-revenue that reduces the top line, they are stored negative, and
 * nothing in the chart says which product each one belongs to — so they cannot
 * be allocated per product at all. They are reported separately instead, which
 * is also what makes the totals legible: product revenue deliberately does not
 * sum to P&L revenue, and a reader who is not told that will assume the
 * difference is a bug.
 *
 * Pure — the caller supplies rows it has already aggregated.
 */
import { plfNature } from "./plf-chart"
import { summarizeProductMargins, type ProductMarginSummary } from "./product-margin"

/**
 * Contra-revenue under the PLF chart. Deliberately NOT added to
 * `isContraRevenueCode` in `coa-role.ts`: that helper NEGATES what it matches,
 * and these rows are already stored negative by the importer. Teaching it this
 * prefix would flip returns back to positive and silently inflate the P&L top
 * line — verified against the 2025 actuals, where the rows sum to −4,523 and
 * −93,944 as stored.
 */
const CONTRA_REVENUE_PREFIX = "PLF.01.10."

/** One account and its total over the period being reported. */
export interface AccountAmount {
  code: string
  name: string
  amount: number
}

export interface ProductMarginAccountsResult extends ProductMarginSummary {
  /**
   * Returns and discounts, summed as stored (negative reduces revenue). Not
   * allocatable to a product, so it is stated on its own rather than folded
   * into one.
   */
  contraRevenue: number
  contraRevenueAccounts: AccountAmount[]
  /**
   * Cost accounts with no revenue counterpart. Expected to be empty on this
   * chart; surfaced rather than dropped, because a cost with no revenue beside
   * it is money leaving the product table without anyone being told.
   */
  unpairedCostAccounts: AccountAmount[]
}

/**
 * The part of a PLF code that identifies the product rather than the section:
 * `PLF.01.01.05` and `PLF.02.01.05` both yield `.01.05`. Year-suffixed
 * accounts (`PLF.01.01.06.FY2025`) pair on the same rule.
 */
function productKey(code: string): string {
  return code.trim().toUpperCase().slice("PLF.0N".length)
}

/** Sum duplicate codes so the caller's grouping can never silently drop one. */
function foldByCode(rows: ReadonlyArray<AccountAmount>): AccountAmount[] {
  const byCode = new Map<string, AccountAmount>()
  for (const row of rows) {
    const code = row.code.trim().toUpperCase()
    const seen = byCode.get(code)
    if (seen) seen.amount += row.amount
    else byCode.set(code, { code, name: row.name, amount: row.amount })
  }
  return [...byCode.values()]
}

export function buildProductMarginsFromAccounts(
  rows: ReadonlyArray<AccountAmount>,
): ProductMarginAccountsResult {
  const revenue: AccountAmount[] = []
  const contraRevenueAccounts: AccountAmount[] = []
  const costByProduct = new Map<string, AccountAmount>()

  for (const row of foldByCode(rows)) {
    // The canonical classifier decides what a code IS; the code's position
    // decides what it pairs WITH. Anything it does not call revenue or cogs —
    // opex, below-EBITDA, and the sheet's own subtotals — is not a product.
    const nature = plfNature(row.code)
    if (nature === "revenue") {
      if (row.code.startsWith(CONTRA_REVENUE_PREFIX)) contraRevenueAccounts.push(row)
      else revenue.push(row)
    } else if (nature === "cogs") {
      costByProduct.set(productKey(row.code), row)
    }
  }

  const pairedCost = new Set<string>()
  // Largest first: the point of the split is to show which products carry the
  // business, and a reader scanning from the top should meet those first.
  const inputs = [...revenue]
    .sort((a, b) => b.amount - a.amount)
    .map((r) => {
      const key = productKey(r.code)
      const cost = costByProduct.get(key)
      if (cost) pairedCost.add(key)
      return {
        productCode: r.code,
        productName: r.name,
        revenue: r.amount,
        // Omitted, never zeroed — a fabricated zero cost renders as a 100%
        // margin, which is indistinguishable from an excellent one.
        ...(cost ? { cost: cost.amount } : {}),
      }
    })

  return {
    ...summarizeProductMargins(inputs),
    contraRevenue: contraRevenueAccounts.reduce((sum, r) => sum + r.amount, 0),
    contraRevenueAccounts,
    unpairedCostAccounts: [...costByProduct.entries()]
      .filter(([key]) => !pairedCost.has(key))
      .map(([, account]) => account),
  }
}

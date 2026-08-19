"use client"

/**
 * Gross margin per product (2026-08-19).
 *
 * The owner asked for `(revenue − cogs) / revenue` with wheat, cotton and the
 * rest stated separately, because the group number hides the thing worth
 * knowing: on the client's own 2026 actuals cotton turns over thirty times
 * what wheat does and keeps 1.1% of it.
 *
 * The design rule here is that an unknown margin must LOOK unknown. A product
 * whose cost the workbook never states renders as "—" with the reason beside
 * it, never as a number; a zero substituted for the missing cost would render
 * as a 100% margin, which is a fabrication a reader cannot tell from an
 * excellent result. The same rule applies to the totals: the group margin is
 * computed over products that have costs, and the revenue it could not speak
 * for is stated next to it rather than quietly left out.
 */

import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface MarginRow {
  productCode: string
  productName: string
  revenue: number
  cost: number | null
  grossProfit: number | null
  marginPct: number | null
  reason?: "no_cost_data" | "no_revenue"
}

interface ProductMarginResponse {
  success: true
  plan: { id: string; name: string; year: number; kind: string }
  products: MarginRow[]
  knownRevenue: number
  knownCost: number
  knownMarginPct: number | null
  revenueWithoutCost: number
  contraRevenue: number
  contraRevenueAccounts: { code: string; name: string; amount: number }[]
  unpairedCostAccounts: { code: string; name: string; amount: number }[]
  monthsCovered: number[]
  basis: "consolidated_computed" | "sum_of_entities" | "single_entity"
}

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Margin colouring: a loss is not a small positive, and must not read as one. */
function marginTone(pct: number): string {
  if (pct < 0) return "text-red-600 dark:text-red-400"
  if (pct < 5) return "text-amber-600 dark:text-amber-400"
  return "text-emerald-600 dark:text-emerald-400"
}

export function ProductMarginTable({
  planId,
  companyId,
}: {
  planId: string
  companyId?: string | null
}) {
  const t = useTranslations("productMargin")
  const query = new URLSearchParams({ planId })
  if (companyId) query.set("companyId", companyId)

  const { data, isLoading, error } = useQuery<ProductMarginResponse>({
    queryKey: ["product-margin", planId, companyId ?? null],
    enabled: Boolean(planId),
    queryFn: async () => {
      const res = await fetch(`/api/budgeting/product-margin?${query.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  if (!planId) return null
  if (isLoading) return <Card><CardContent className="p-6 text-muted-foreground">{t("loading")}</CardContent></Card>
  if (error || !data) return <Card><CardContent className="p-6 text-muted-foreground">{t("failed")}</CardContent></Card>
  if (data.products.length === 0) {
    return <Card><CardContent className="p-6 text-muted-foreground">{t("empty")}</CardContent></Card>
  }

  const months = data.monthsCovered
  const period = months.length > 0 ? `${months[0]}–${months[months.length - 1]}` : "—"

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="text-xs text-muted-foreground pt-2">
            {t("period", { period, count: months.length })} · {t(`basis.${data.basis}`)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="p-3 font-medium">{t("product")}</th>
                <th className="p-3 font-medium text-right">{t("revenue")}</th>
                <th className="p-3 font-medium text-right">{t("cost")}</th>
                <th className="p-3 font-medium text-right">{t("grossProfit")}</th>
                <th className="p-3 font-medium text-right">{t("margin")}</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => (
                <tr key={p.productCode} className="border-b last:border-0">
                  <td className="p-3">
                    <div>{p.productName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.productCode}</div>
                  </td>
                  <td className="p-3 text-right tabular-nums">{money.format(p.revenue)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {p.cost === null ? <span className="text-muted-foreground">—</span> : money.format(p.cost)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {p.grossProfit === null
                      ? <span className="text-muted-foreground">—</span>
                      : money.format(p.grossProfit)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {p.marginPct === null ? (
                      // Why there is no number here, in the cell where the
                      // reader is looking for one.
                      <Badge variant="outline" className="font-normal">
                        {t(`reason.${p.reason ?? "no_cost_data"}`)}
                      </Badge>
                    ) : (
                      <span className={marginTone(p.marginPct)}>{p.marginPct.toFixed(1)}%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-muted/20 font-medium">
              <tr>
                <td className="p-3">{t("groupTotal")}</td>
                <td className="p-3 text-right tabular-nums">{money.format(data.knownRevenue)}</td>
                <td className="p-3 text-right tabular-nums">{money.format(data.knownCost)}</td>
                <td className="p-3 text-right tabular-nums">
                  {money.format(data.knownRevenue - data.knownCost)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {data.knownMarginPct === null
                    ? "—"
                    : <span className={marginTone(data.knownMarginPct)}>{data.knownMarginPct.toFixed(1)}%</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* Everything the table above deliberately does not account for. Without
          this the reader compares its total against the P&L, finds a gap, and
          has no way to learn whether it is a rule or a bug. */}
      {(data.revenueWithoutCost !== 0 ||
        data.contraRevenue !== 0 ||
        data.unpairedCostAccounts.length > 0) && (
        <Card>
          <CardContent className="p-6 space-y-2 text-sm">
            <h3 className="font-medium">{t("notCounted")}</h3>
            {data.revenueWithoutCost !== 0 && (
              <p className="text-muted-foreground">
                {t("revenueWithoutCost", { amount: money.format(data.revenueWithoutCost) })}
              </p>
            )}
            {data.contraRevenue !== 0 && (
              <p className="text-muted-foreground">
                {t("contraRevenue", { amount: money.format(data.contraRevenue) })}
              </p>
            )}
            {data.unpairedCostAccounts.map((a) => (
              <p key={a.code} className="text-muted-foreground">
                {t("unpairedCost", { code: a.code, name: a.name, amount: money.format(a.amount) })}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

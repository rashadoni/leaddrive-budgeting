"use client"

/**
 * Indirect cash flow (2026-08-19).
 *
 * This tab held zero rows: the direct statement below needs `cash_flow_entries`
 * and the client's workbook has none. Everything an indirect statement needs
 * was already imported, so it is assembled from the balance sheet instead.
 *
 * Two things the screen is obliged to say, and does:
 *
 * The owners put money in. Over the client's February–May two entities were
 * funded, and a statement that folds that into "result" reports earnings that
 * were never earned. Contributions sit in financing, on their own line.
 *
 * The P&L and the balance sheet disagree about the period. The derived result
 * is shown beside the P&L's own, and the difference is stated rather than
 * absorbed — it is a real defect in one of the two statements and this is where
 * it is most visible.
 */

import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BUDGET_COLORS } from "@/lib/budget-chart-theme"
import type { IndirectCashFlow } from "@/lib/budgeting/cash-flow-indirect"

interface CashFlowResponse {
  success: true
  statement: IndirectCashFlow | null
  openingMonth?: number
  closingMonth?: number
  basis?: string
}

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const tone = (v: number) => (v < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive)

export function CashFlowIndirectPanel({
  planId,
  companyId,
}: {
  planId: string
  companyId?: string | null
}) {
  const t = useTranslations("cashFlow")

  const { data, isLoading, error } = useQuery<CashFlowResponse>({
    queryKey: ["cash-flow-indirect", planId, companyId ?? null],
    enabled: Boolean(planId),
    queryFn: async () => {
      const q = new URLSearchParams({ planId })
      if (companyId) q.set("companyId", companyId)
      const res = await fetch(`/api/budgeting/cash-flow/indirect?${q.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  if (!planId) return null
  if (isLoading) return <Card><CardContent className="p-6 text-muted-foreground">{t("loading")}</CardContent></Card>
  if (error) return <Card><CardContent className="p-6 text-muted-foreground">{t("failed")}</CardContent></Card>
  const s = data?.statement
  if (!s) return <Card><CardContent className="p-6 text-muted-foreground">{t("empty")}</CardContent></Card>

  const section = (
    key: string,
    lines: { key: string; amount: number }[],
    total: number,
  ) => (
    <div key={key} className="space-y-1">
      <div className="flex justify-between font-medium">
        <span>{t(`section.${key}`)}</span>
        <span className="tabular-nums" style={{ color: tone(total) }}>{money.format(total)}</span>
      </div>
      {lines.map((l) => (
        <div key={l.key} className="flex justify-between text-sm text-muted-foreground pl-4">
          <span>{t(`line.${l.key}`)}</span>
          <span className="tabular-nums">{money.format(l.amount)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="text-xs text-muted-foreground pt-2">
            {t("window", { from: data?.openingMonth ?? 0, to: data?.closingMonth ?? 0 })}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { k: "openingCash", v: s.openingCash },
          { k: "netChange", v: s.netChange },
          { k: "closingCash", v: s.closingCash },
        ].map((x) => (
          <Card key={x.k}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t(x.k)}</div>
              <div className="text-xl font-semibold tabular-nums" style={{ color: x.k === "netChange" ? tone(x.v) : undefined }}>
                {money.format(x.v)}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{t("unreconciled")}</div>
            <div className="text-xl font-semibold tabular-nums">{money.format(s.unreconciled)}</div>
            <div className="text-xs text-muted-foreground">{t("unreconciledHint")}</div>
          </CardContent>
        </Card>
      </div>

      {/* Not a footnote: the two statements disagree about the period, and the
          reader is entitled to see by how much before reading anything else. */}
      {s.resultDisagreement !== null && Math.abs(s.resultDisagreement) > 1 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <Badge variant="destructive">{t("disagreementBadge")}</Badge>
            <p className="text-sm text-muted-foreground">
              {t("disagreement", {
                derived: money.format(s.derivedResult),
                pnl: money.format(s.pnlResult ?? 0),
                diff: money.format(s.resultDisagreement),
              })}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6 space-y-5">
          {section("operating", s.operating.lines, s.operating.total)}
          {section("investing", s.investing.lines, s.investing.total)}
          {section("financing", s.financing.lines, s.financing.total)}
          <div className="flex justify-between border-t pt-3 font-semibold">
            <span>{t("netChange")}</span>
            <span className="tabular-nums" style={{ color: tone(s.netChange) }}>
              {money.format(s.netChange)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

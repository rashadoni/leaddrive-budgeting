"use client"

/**
 * The ratios a finance director looks at first (2026-08-19).
 *
 * 16,357 balance-sheet lines were imported and nothing computed a ratio from
 * them. This does.
 *
 * ## Why it holds no query of its own
 *
 * Both inputs come from the endpoints that already draw the screens they must
 * agree with: the position from `/balance-sheet`, the flows from `/pnl`. A
 * third route re-deriving the balance would have had to reproduce that route's
 * holding-consolidation branch and its archived-row filter — miss the latter
 * and every total doubles on a re-imported plan, which is a measured failure in
 * this codebase, not a hypothetical. Reading the same payloads means there is
 * nothing to drift apart from.
 *
 * ## A balance is a position, not a period
 *
 * The lines are taken at ONE month — the latest with data — never summed
 * across months. Summing is right for a P&L and would multiply every figure
 * here by the number of periods. The working-capital ratios then mix that
 * position with flows over the months leading to it, so the window is stated.
 */

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BUDGET_COLORS } from "@/lib/budget-chart-theme"
import { computeBalanceRatios, type BalanceAccountAmount } from "@/lib/budgeting/balance-ratios"

interface BsLine {
  month: number
  amount: number
  account?: { code: string | null; name: string | null } | null
}
interface BsResponse {
  all: BsLine[]
  meta?: { sourceYear?: number | null; basis?: string; sourcePlanId?: string }
}
interface PnlResponse {
  monthlyActualRevenue?: Record<number, number>
  monthlyActualCogs?: Record<number, number>
}

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

/** Calendar days from 1 January to the end of month `m` (1-based). */
function daysThrough(year: number, m: number): number {
  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year, m, 1)
  return Math.round((end - start) / 86_400_000)
}

const VERDICT_COLOR = {
  good: BUDGET_COLORS.positive,
  watch: BUDGET_COLORS.warning,
  bad: BUDGET_COLORS.negative,
} as const

export function BalanceRatiosPanel({
  planId,
  companyId,
}: {
  planId: string
  companyId?: string | null
}) {
  const t = useTranslations("balanceRatios")

  const bs = useQuery<BsResponse>({
    queryKey: ["balance-sheet", planId, companyId ?? null],
    enabled: Boolean(planId),
    queryFn: async () => {
      const q = new URLSearchParams({ planId })
      if (companyId) q.set("companyId", companyId)
      const res = await fetch(`/api/budgeting/balance-sheet?${q.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  const pnl = useQuery<PnlResponse>({
    queryKey: ["pnl-flows", planId, companyId ?? null],
    enabled: Boolean(planId),
    queryFn: async () => {
      const q = new URLSearchParams({ planId })
      if (companyId) q.set("companyId", companyId)
      const res = await fetch(`/api/budgeting/pnl?${q.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  const model = useMemo(() => {
    const lines = bs.data?.all ?? []
    if (lines.length === 0) return null
    const month = Math.max(...lines.map((l) => l.month))
    const byCode = new Map<string, BalanceAccountAmount>()
    for (const l of lines) {
      if (l.month !== month) continue
      const code = l.account?.code
      if (!code) continue
      const seen = byCode.get(code)
      if (seen) seen.amount += l.amount
      else byCode.set(code, { code, name: l.account?.name ?? code, amount: l.amount })
    }

    const year = bs.data?.meta?.sourceYear ?? new Date().getUTCFullYear()
    const rev = pnl.data?.monthlyActualRevenue ?? {}
    const cogs = pnl.data?.monthlyActualCogs ?? {}
    let revenue = 0
    let cost = 0
    for (let m = 1; m <= month; m++) {
      revenue += rev[m] ?? 0
      cost += cogs[m] ?? 0
    }
    // Days ratios need flows; without them the position ratios still stand and
    // the days simply are not offered, rather than being shown as zero.
    const flows = revenue > 0 || cost > 0 ? { revenue, cogs: cost, days: daysThrough(year, month) } : null

    return { month, year, ratios: computeBalanceRatios([...byCode.values()], flows) }
  }, [bs.data, pnl.data])

  if (!planId) return null
  if (bs.isLoading) return <Card><CardContent className="p-6 text-muted-foreground">{t("loading")}</CardContent></Card>
  if (bs.error) return <Card><CardContent className="p-6 text-muted-foreground">{t("failed")}</CardContent></Card>
  if (!model) return <Card><CardContent className="p-6 text-muted-foreground">{t("empty")}</CardContent></Card>

  const r = model.ratios
  const position = ["current", "quick", "equityRatio", "netDebtToEquity"]
  const days = ["dso", "dio", "dpo", "cashCycle"]
  const shown = (keys: string[]) => r.ratios.filter((x) => keys.includes(x.key))

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 space-y-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="text-xs text-muted-foreground pt-2">
            {t("asOf", { month: model.month, year: model.year })}
          </p>
        </CardContent>
      </Card>

      {/* The imported book must close before any ratio built on it means
          anything. Silence here is the good case. */}
      {Math.abs(r.balanceCheck) > 2 && (
        <Card>
          <CardContent className="p-4">
            <Badge variant="destructive">{t("doesNotBalance")}</Badge>
            <p className="text-sm text-muted-foreground pt-2">
              {t("balanceCheck", { amount: money.format(r.balanceCheck) })}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {shown(position).map((x) => (
          <Card key={x.key}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t(`ratio.${x.key}`)}</div>
              <div
                className="text-xl font-semibold tabular-nums"
                style={{ color: x.verdict ? VERDICT_COLOR[x.verdict] : undefined }}
              >
                {x.value === null ? "—" : x.value.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">{t(`hint.${x.key}`)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-3">
          <h3 className="font-medium">{t("position")}</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <Line label={t("totalAssets")} value={r.totalAssets} />
            <Line label={t("equity")} value={r.equity} />
            <Line label={t("currentLiabilities")} value={r.currentLiabilities} />
            <Line label={t("netDebt")} value={r.netDebt} />
          </div>
          {/* Net cash is not a small net debt, and reads wrong without saying so. */}
          {r.netDebt < 0 && <p className="text-sm text-muted-foreground">{t("netCash")}</p>}
        </CardContent>
      </Card>

      {shown(days).length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <h3 className="font-medium">{t("workingCapital")}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {shown(days).map((x) => (
                <div key={x.key}>
                  <div className="text-xs text-muted-foreground">{t(`ratio.${x.key}`)}</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {x.value === null ? "—" : `${Math.round(x.value)} ${t("daysUnit")}`}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("biologicalNote")}</p>
          </CardContent>
        </Card>
      )}

      {/* An account the map does not know vanishes from every total, and
          nothing about the screen looks wrong. So it is named. */}
      {r.unmapped.length > 0 && (
        <Card>
          <CardContent className="p-6 space-y-2 text-sm">
            <h3 className="font-medium">{t("unmapped")}</h3>
            {r.unmapped.map((a) => (
              <p key={a.code} className="text-muted-foreground">
                {a.name} ({a.code}): {money.format(a.amount)}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{money.format(value)}</div>
    </div>
  )
}

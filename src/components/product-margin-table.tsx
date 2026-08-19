"use client"

/**
 * Gross margin per product — and what it would take to change it (2026-08-19).
 *
 * The owner asked for `(revenue − cogs) / revenue` with wheat, cotton and the
 * rest stated separately, because the group number hides the thing worth
 * knowing: on the client's own 2026 actuals cotton turns over thirty times
 * what wheat does and keeps 1.1% of it.
 *
 * Reading that provokes the next question immediately — how much price would
 * close the gap to the 28% the budget assumed — so the screen answers it.
 * Two sliders rescale price and cost and everything recomputes live; the
 * table states, per product, the price rise or cost cut that would land it on
 * the target line.
 *
 * ## Two things the design refuses to do
 *
 * An unknown margin must LOOK unknown. A product whose cost the workbook never
 * states renders as "—" with the reason beside it, in the base view and under
 * every simulation. A zero substituted for the missing cost would render as a
 * 100% margin, and a reader cannot tell that apart from an excellent result.
 *
 * A simulation must LOOK like a simulation. Simulated figures are labelled,
 * the base value stays visible underneath, and a reset is always one click
 * away. Nothing here is ever written back.
 */

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { RotateCcw, SlidersHorizontal } from "lucide-react"
import { BUDGET_COLORS, GRID_STYLE, AXIS_TICK } from "@/lib/budget-chart-theme"
import type { ProductMargin } from "@/lib/budgeting/product-margin"
import {
  simulateProductMargins, priceUpliftForTarget, costCutForTarget,
  isSimulating, NO_CHANGE, type MarginKnobs,
} from "@/lib/budgeting/product-margin-whatif"

interface ProductMarginResponse {
  success: true
  plan: { id: string; name: string; year: number; kind: string }
  products: ProductMargin[]
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

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

/** A loss is not a small positive and must not read as one. */
function tone(pct: number): string {
  if (pct < 0) return BUDGET_COLORS.negative
  if (pct < 5) return BUDGET_COLORS.warning
  return BUDGET_COLORS.positive
}

/**
 * Chart axes need a label, not a sentence. The client's accounts are named
 * "Revenue from Sale of Cotton"; the prefix is the same on every row and
 * carries nothing. Locales that do not match keep the full name — a chart with
 * long labels beats a chart with wrong ones.
 */
function shortLabel(name: string): string {
  return name.replace(/^revenue\s+from\s+(the\s+)?(sales?\s+of\s+)?/i, "").trim() || name
}

export function ProductMarginTable({
  planId,
  companyId,
}: {
  planId: string
  companyId?: string | null
}) {
  const t = useTranslations("productMargin")
  const [knobs, setKnobs] = useState<MarginKnobs>(NO_CHANGE)
  const [target, setTarget] = useState(30)

  const { data, isLoading, error } = useQuery<ProductMarginResponse>({
    queryKey: ["product-margin", planId, companyId ?? null],
    enabled: Boolean(planId),
    queryFn: async () => {
      const q = new URLSearchParams({ planId })
      if (companyId) q.set("companyId", companyId)
      const res = await fetch(`/api/budgeting/product-margin?${q.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
  })

  const sim = useMemo(
    () => simulateProductMargins(data?.products ?? [], knobs),
    [data?.products, knobs],
  )
  const live = isSimulating(knobs)

  const chartData = useMemo(
    () =>
      sim.products
        .filter((p) => p.marginPct !== null)
        .map((p) => ({
          name: shortLabel(p.productName),
          base: p.marginPct as number,
          value: (p.simMarginPct ?? p.marginPct) as number,
        })),
    [sim.products],
  )

  if (!planId) return null
  if (isLoading) return <Card><CardContent className="p-6 text-muted-foreground">{t("loading")}</CardContent></Card>
  if (error || !data) return <Card><CardContent className="p-6 text-muted-foreground">{t("failed")}</CardContent></Card>
  if (data.products.length === 0) {
    return <Card><CardContent className="p-6 text-muted-foreground">{t("empty")}</CardContent></Card>
  }

  const months = data.monthsCovered
  const period = months.length > 0 ? `${months[0]}–${months[months.length - 1]}` : "—"
  const grossProfit = sim.knownRevenue - sim.knownCost

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

      {/* Headline figures. Under a simulation each tile keeps its real value
          visible underneath, so the reader is never one glance away from
          mistaking a hypothetical for the books. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t("revenue"), sim: sim.knownRevenue, base: data.knownRevenue },
          { label: t("cost"), sim: sim.knownCost, base: data.knownCost },
          { label: t("grossProfit"), sim: grossProfit, base: data.knownRevenue - data.knownCost },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{tile.label}</div>
              <div className="text-xl font-semibold tabular-nums">{money.format(tile.sim)}</div>
              {live && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {t("was", { value: money.format(tile.base) })}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{t("margin")}</div>
            <div
              className="text-xl font-semibold tabular-nums"
              style={{ color: sim.knownMarginPct === null ? undefined : tone(sim.knownMarginPct) }}
            >
              {sim.knownMarginPct === null ? "—" : `${sim.knownMarginPct.toFixed(1)}%`}
            </div>
            {live && data.knownMarginPct !== null && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {t("was", { value: `${data.knownMarginPct.toFixed(1)}%` })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The what-if. Volume is deliberately absent: at a constant price and
          unit cost the margin PERCENT does not move with volume, so a volume
          knob would sit still and teach the reader the screen is broken. */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium">{t("whatIf")}</h3>
              {live && <Badge variant="secondary">{t("simulated")}</Badge>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setKnobs(NO_CHANGE); setTarget(30) }}
              disabled={!live && target === 30}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {t("reset")}
            </Button>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Knob
              label={t("priceKnob")}
              value={knobs.price}
              onChange={(price) => setKnobs((k) => ({ ...k, price }))}
            />
            <Knob
              label={t("costKnob")}
              value={knobs.cost}
              onChange={(cost) => setKnobs((k) => ({ ...k, cost }))}
            />
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("targetKnob")}</span>
                <span className="font-medium tabular-nums">{target}%</span>
              </div>
              <Slider
                value={[target]}
                onValueChange={([v]) => setTarget(v)}
                min={0}
                max={80}
                step={1}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t("whatIfNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="font-medium mb-4">{t("chartTitle")}</h3>
          <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 34)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid {...GRID_STYLE} horizontal={false} vertical />
              <XAxis type="number" tick={AXIS_TICK} unit="%" />
              <YAxis type="category" dataKey="name" width={150} tick={AXIS_TICK} />
              <Tooltip
                formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : String(v ?? ""))}
                contentStyle={{ fontSize: 12 }}
              />
              <ReferenceLine
                x={target}
                stroke={BUDGET_COLORS.planIndigo}
                strokeDasharray="4 4"
                label={{ value: `${target}%`, fontSize: 11, fill: BUDGET_COLORS.planIndigo }}
              />
              {/* The untouched figure stays on screen beneath the simulated
                  one, so a drag reads as a change and not as the truth. */}
              {live && <Bar dataKey="base" fill={BUDGET_COLORS.neutral} fillOpacity={0.25} radius={[0, 3, 3, 0]} />}
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {chartData.map((d) => (
                  <Cell key={d.name} fill={tone(d.value)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
                <th className="p-3 font-medium text-right">{t("margin")}</th>
                <th className="p-3 font-medium text-right">{t("toTarget", { target })}</th>
              </tr>
            </thead>
            <tbody>
              {sim.products.map((p) => {
                const shown = live ? p.simMarginPct : p.marginPct
                const uplift = priceUpliftForTarget(p.revenue, p.cost, target)
                const cut = costCutForTarget(p.revenue, p.cost, target)
                const meets = shown !== null && shown >= target
                return (
                  <tr key={p.productCode} className="border-b last:border-0">
                    <td className="p-3">
                      <div>{p.productName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.productCode}</div>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {money.format(live ? p.simRevenue : p.revenue)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {p.cost === null
                        ? <span className="text-muted-foreground">—</span>
                        : money.format(live ? (p.simCost as number) : p.cost)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {shown === null ? (
                        <Badge variant="outline" className="font-normal">
                          {t(`reason.${p.reason ?? "no_cost_data"}`)}
                        </Badge>
                      ) : (
                        <span style={{ color: tone(shown) }}>{shown.toFixed(1)}%</span>
                      )}
                    </td>
                    <td className="p-3 text-right text-xs">
                      {uplift === null || cut === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : meets ? (
                        <span className="text-muted-foreground">{t("meetsTarget")}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("needs", {
                            price: `${(uplift * 100) >= 0 ? "+" : ""}${(uplift * 100).toFixed(0)}%`,
                            cost: `${(cut * 100).toFixed(0)}%`,
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 bg-muted/20 font-medium">
              <tr>
                <td className="p-3">{t("groupTotal")}</td>
                <td className="p-3 text-right tabular-nums">{money.format(sim.knownRevenue)}</td>
                <td className="p-3 text-right tabular-nums">{money.format(sim.knownCost)}</td>
                <td className="p-3 text-right tabular-nums">
                  {sim.knownMarginPct === null
                    ? "—"
                    : <span style={{ color: tone(sim.knownMarginPct) }}>{sim.knownMarginPct.toFixed(1)}%</span>}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

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

function Knob({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const pct = Math.round(value * 100)
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct >= 0 ? "+" : ""}{pct}%</span>
      </div>
      <Slider
        value={[pct]}
        onValueChange={([v]) => onChange(v / 100)}
        min={-50}
        max={50}
        step={1}
      />
    </div>
  )
}

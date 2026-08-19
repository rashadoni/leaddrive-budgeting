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

interface ComparedSide {
  revenue: number
  cost: number | null
  marginPct: number | null
  reason?: "no_cost_data" | "no_revenue" | "zero_cost"
}

interface BasketTotals {
  revenue: number
  cost: number
  grossProfit: number
  marginPct: number | null
}

interface AnnualRow {
  productCode: string
  productName: string
  planRevenue: number
  planMarginPct: number | null
  actualRevenue: number
  actualMarginPct: number | null
  marginGapPoints: number | null
  revenueProgress: number | null
  plannedLater: boolean
}

interface MixRate {
  products: {
    productCode: string
    productName: string
    budgetShare: number | null
    actualShare: number | null
    ratePoints: number | null
    mixPoints: number | null
  }[]
  ratePoints: number
  mixPoints: number
  unattributedPoints: number
  gapPoints: number | null
}

interface MarginComparison {
  mixRate: MixRate
  products: {
    productCode: string
    productName: string
    budget: ComparedSide | null
    actual: ComparedSide | null
    gapPoints: number | null
  }[]
  budget: { knownMarginPct: number | null }
  actual: { knownMarginPct: number | null }
  gapPoints: number | null
  common: {
    productCodes: string[]
    budget: BasketTotals
    actual: BasketTotals
    gapPoints: number | null
  }
  outsidePlan: BasketTotals & {
    products: { productCode: string; productName: string; revenue: number; marginPct: number | null }[]
  }
  annual: AnnualRow[]
  monthsCompared: number[]
}

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
  comparison: MarginComparison | null
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

/**
 * On a comparison card the plan is a reference, not an achievement, so the
 * delivered figure is coloured against IT and not against an absolute scale.
 * With `tone()` here the client's card painted 25.1% and 21.6% both green: the
 * two numbers being compared read as equally healthy, and only the gap beneath
 * them was red.
 */
function relativeTone(value: number | null, baseline: number | null): string | undefined {
  if (value === null || baseline === null) return undefined
  const d = value - baseline
  if (Math.abs(d) < 0.05) return BUDGET_COLORS.neutral
  return d < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive
}

/**
 * Colour is never allowed to be the only signal. Roughly one man in twelve
 * cannot separate this red from this green, and these cards get printed into
 * board packs in black and white.
 */
function arrow(delta: number): string {
  if (Math.abs(delta) < 0.05) return "="
  return delta < 0 ? "▼" : "▲"
}

/**
 * Two of the client's accounts are both named "Revenue from Sale of Other
 * Products" (PLF.01.99 and PLF.02.99) and shortened to the same label, which
 * put two indistinguishable rows on the chart axis and in the tooltip. Where a
 * label repeats, the account code settles it; where it does not, nothing is
 * added.
 */
function disambiguate<T extends { productCode: string; productName: string }>(
  items: ReadonlyArray<T>,
): Array<T & { label: string }> {
  const count = new Map<string, number>()
  for (const i of items) {
    const l = shortLabel(i.productName)
    count.set(l, (count.get(l) ?? 0) + 1)
  }
  return items.map((i) => {
    const l = shortLabel(i.productName)
    return { ...i, label: (count.get(l) ?? 0) > 1 ? `${l} (${i.productCode})` : l }
  })
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

  /**
   * Every product the screen cannot state a margin for, largest first. These
   * are the rows a reader should chase: on the client's 2025 consolidated
   * actuals they are 1,921,539 of "Other Products", 398,927 of Management
   * Services and 21,774 of land rent — all with no cost account at all.
   */
  const noMargin = disambiguate(
    data.products.filter((p) => p.marginPct === null),
  ).sort((a, b) => Math.abs(b.revenue) - Math.abs(a.revenue))

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

      {/* Budget against actual, on equal months. This is the sentence the
          client asked for and the reason the split exists: cotton was planned
          at 28% and is delivering 1.1%. It sits ABOVE the sliders because it
          is the reading; the sliders are what you do about it. */}
      {data.comparison && <ComparisonCard c={data.comparison} t={t} />}
      {data.comparison && data.comparison.annual.length > 0 && (
        <AnnualCard rows={data.comparison.annual} t={t} />
      )}

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
        data.unpairedCostAccounts.length > 0 ||
        noMargin.length > 0) && (
        <Card>
          <CardContent className="p-6 space-y-2 text-sm">
            <h3 className="font-medium">{t("notCounted")}</h3>

            {/* Named, not just totalled. "1,921,539 of revenue has no cost"
                tells a reader the screen is incomplete; it does not tell them
                where to go. The list does, and the reason says what to look
                for — a missing cost account, a cost posted as zero, or a
                revenue line that nets negative. */}
            {noMargin.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">{t("noCostProducts", { count: noMargin.length })}</p>
                <table className="w-full">
                  <tbody>
                    {noMargin.map((p) => (
                      <tr key={p.productCode}>
                        <td className="py-1 pr-3">{p.label}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                          {money.format(p.revenue)}
                        </td>
                        <td className="py-1 text-right text-xs text-muted-foreground">
                          {t(`reason.${p.reason ?? "no_cost_data"}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

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

function ComparisonCard({
  c,
  t,
}: {
  c: MarginComparison
  t: ReturnType<typeof useTranslations<"productMargin">>
}) {
  const months = c.monthsCompared
  const period = months.length > 0 ? `${months[0]}–${months[months.length - 1]}` : "—"
  /**
   * The headline is the COMMON basket, not each side's own.
   *
   * On the client's January–May the whole-basket reading is 25.1% against
   * 21.6% and was printed as a 3.6-point miss. On the eight products both
   * plans contain it is 25.1% against 25.0%. The missing 3.5 points are crops
   * sold ahead of the season they are budgeted for, which is a phasing fact,
   * not a pricing one — and it now has its own block rather than being folded
   * into a percentage that looks like performance.
   */
  const b = c.common.budget
  const a = c.common.actual
  const gp = a.grossProfit - b.grossProfit
  const gaps = disambiguate(
    c.products.filter((p) => p.gapPoints !== null),
  ).map((p) => ({ name: p.label, gap: p.gapPoints as number }))
  /**
   * Only products that were actually sold. A plan figure with no delivery
   * beside it is not a comparison — it is a number the reader has to guess
   * the meaning of, and the guess is usually "we missed it". What was planned
   * and not yet delivered belongs on the annual card, which is about the plan
   * and says so.
   */
  const rows = disambiguate(c.products.filter((p) => p.actual !== null))

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div>
          <h3 className="font-medium">{t("comparisonTitle")}</h3>
          {/* Never let the window OR the basket be inferred. Five months of
              delivery against twelve months of plan was the first trap; a
              fourteen-product actual against an eight-product plan was the
              second, and it survived the first fix. */}
          <p className="text-xs text-muted-foreground pt-1">
            {t("comparedOn", { period, count: months.length })} ·{" "}
            {t("comparableCount", { count: c.common.productCodes.length })}
          </p>
        </div>

        <div className="flex flex-wrap gap-8 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">{t("budgetSide")}</div>
            {/* The plan is the baseline, so it carries no verdict colour. */}
            <div className="text-lg font-semibold tabular-nums">
              {b.marginPct === null ? "—" : `${b.marginPct.toFixed(1)}%`}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {money.format(b.grossProfit)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("actualSide")}</div>
            <div
              className="text-lg font-semibold tabular-nums"
              style={{ color: relativeTone(a.marginPct, b.marginPct) }}
            >
              {a.marginPct === null ? "—" : `${a.marginPct.toFixed(1)}%`}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {money.format(a.grossProfit)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("gap")}</div>
            <div
              className="text-lg font-semibold tabular-nums"
              style={{
                color:
                  c.common.gapPoints === null
                    ? undefined
                    : Math.abs(c.common.gapPoints) < 0.05
                      ? BUDGET_COLORS.neutral
                      : c.common.gapPoints < 0
                        ? BUDGET_COLORS.negative
                        : BUDGET_COLORS.positive,
              }}
            >
              {c.common.gapPoints === null
                ? "—"
                : `${arrow(c.common.gapPoints)} ${c.common.gapPoints >= 0 ? "+" : ""}${c.common.gapPoints.toFixed(1)} ${t("points")}`}
            </div>
            {/* The card used to show only the rate. Margin fell while gross
                profit rose, and nothing on screen could say so. */}
            <div className="text-xs text-muted-foreground tabular-nums">
              {gp >= 0 ? "+" : ""}
              {money.format(gp)}
            </div>
          </div>
        </div>

        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("nothingDelivered")}</p>
        )}

        {c.outsidePlan.products.length > 0 && (
          <div className="rounded-md border p-3 space-y-1 text-sm">
            <div className="font-medium">{t("outsidePlanTitle")}</div>
            <p className="text-xs text-muted-foreground">{t("outsidePlanNote")}</p>
            <div className="tabular-nums">
              {money.format(c.outsidePlan.revenue)}
              {c.outsidePlan.marginPct !== null && (
                <span className="text-muted-foreground">
                  {" · "}
                  {t("atMargin", { pct: `${c.outsidePlan.marginPct.toFixed(1)}%` })}
                </span>
              )}
            </div>
            <ul className="text-xs text-muted-foreground">
              {disambiguate(c.outsidePlan.products).map((p) => (
                <li key={p.productCode}>
                  {p.label} — {money.format(p.revenue)}
                  {p.marginPct !== null && ` · ${p.marginPct.toFixed(1)}%`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Rates or the basket, within the compared set. */}
        <WhyMoved m={c.mixRate} t={t} />

        {gaps.length > 0 && (
          <ResponsiveContainer width="100%" height={Math.max(180, gaps.length * 30)}>
            <BarChart data={gaps} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid {...GRID_STYLE} horizontal={false} vertical />
              <XAxis type="number" tick={AXIS_TICK} />
              <YAxis type="category" dataKey="name" width={150} tick={AXIS_TICK} />
              <Tooltip
                formatter={(v) =>
                  typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : String(v ?? "")
                }
                contentStyle={{ fontSize: 12 }}
              />
              <ReferenceLine x={0} stroke={BUDGET_COLORS.neutral} />
              <Bar dataKey="gap" radius={[0, 3, 3, 0]}>
                {gaps.map((g) => (
                  <Cell
                    key={g.name}
                    fill={g.gap < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left">
                <th className="py-2 font-medium">{t("product")}</th>
                {/* Without size on the row, cotton at 1,387,524 and farming
                    services at 6,250 carried identical visual weight. */}
                <th className="py-2 font-medium text-right">{t("revenue")}</th>
                {/* Beside every percentage, the cost it came from. A negative
                    margin with no visible cost reads as invented. */}
                <th className="py-2 font-medium text-right">{t("cost")}</th>
                <th className="py-2 font-medium text-right">{t("budgetSide")}</th>
                <th className="py-2 font-medium text-right">{t("actualSide")}</th>
                <th className="py-2 font-medium text-right">{t("gap")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.productCode} className="border-b last:border-0">
                  <td className="py-2">{p.label}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {money.format(p.actual?.revenue ?? 0)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {p.actual?.cost == null ? (
                      <span className="text-xs">{t("noCostData")}</span>
                    ) : (
                      money.format(p.actual.cost)
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Pct value={p.budget?.marginPct ?? null} noData={t("noMarginData")} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Pct value={p.actual?.marginPct ?? null} noData={t("noMarginData")} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.gapPoints === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        style={{
                          color:
                            p.gapPoints < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive,
                        }}
                      >
                        {arrow(p.gapPoints)} {p.gapPoints >= 0 ? "+" : ""}
                        {p.gapPoints.toFixed(1)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * What has been delivered, judged against the ANNUAL plan.
 *
 * The card above compares only months that carry actuals, which is right and
 * which silently removes every crop: cotton and wheat are planned wholly into
 * June–December. This card exists so that "planned at 28%, delivering 1.1%"
 * can be said at all. It compares RATES across unequal windows, which is valid
 * because a margin is a ratio, and it never subtracts revenues across them —
 * delivery is shown as progress against the annual plan, for the reader to
 * weigh against how much of the year has gone.
 */
function AnnualCard({
  rows,
  t,
}: {
  rows: AnnualRow[]
  t: ReturnType<typeof useTranslations<"productMargin">>
}) {
  const labelled = disambiguate(rows)
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div>
          <h3 className="font-medium">{t("annualTitle")}</h3>
          <p className="text-xs text-muted-foreground pt-1">{t("annualNote")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left">
                <th className="py-2 font-medium">{t("product")}</th>
                <th className="py-2 font-medium text-right">{t("annualPlan")}</th>
                <th className="py-2 font-medium text-right">{t("delivered")}</th>
                <th className="py-2 font-medium text-right">{t("progress")}</th>
                <th className="py-2 font-medium text-right">{t("planRate")}</th>
                <th className="py-2 font-medium text-right">{t("deliveredRate")}</th>
                <th className="py-2 font-medium text-right">{t("gap")}</th>
              </tr>
            </thead>
            <tbody>
              {labelled.map((r) => (
                <tr key={r.productCode} className="border-b last:border-0">
                  <td className="py-2">
                    {r.label}
                    {r.plannedLater && (
                      <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                        {t("plannedLater")}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {money.format(r.planRevenue)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money.format(r.actualRevenue)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {r.revenueProgress === null ? "—" : `${(r.revenueProgress * 100).toFixed(0)}%`}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Pct value={r.planMarginPct} noData={t("noMarginData")} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <Pct value={r.actualMarginPct} noData={t("noMarginData")} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.marginGapPoints === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        style={{
                          color:
                            r.marginGapPoints < 0
                              ? BUDGET_COLORS.negative
                              : BUDGET_COLORS.positive,
                        }}
                      >
                        {arrow(r.marginGapPoints)} {r.marginGapPoints >= 0 ? "+" : ""}
                        {r.marginGapPoints.toFixed(1)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function WhyMoved({
  m,
  t,
}: {
  m: MixRate
  t: ReturnType<typeof useTranslations<"productMargin">>
}) {
  if (m.gapPoints === null) return null
  const rate = Math.abs(m.ratePoints)
  const mix = Math.abs(m.mixPoints)
  // Only call a driver when it clearly dominates; a near-tie is its own answer.
  const verdict =
    rate + mix === 0 ? "drivenByNeither" : mix > rate * 2 ? "drivenByMix" : rate > mix * 2 ? "drivenByRate" : "drivenByBoth"
  const movers = [...m.products]
    .filter((p) => p.mixPoints !== null)
    .sort((a, b) => (a.mixPoints as number) - (b.mixPoints as number))
    .slice(0, 3)

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap gap-6">
        <Points label={t("rateEffect")} value={m.ratePoints} t={t} />
        <Points label={t("mixEffect")} value={m.mixPoints} t={t} />
        {/* Shown only when the split genuinely does not cover the gap, so its
            presence always means something. */}
        {Math.abs(m.unattributedPoints) >= 0.05 && (
          <Points label={t("unattributed")} value={m.unattributedPoints} t={t} />
        )}
      </div>
      <p className="text-sm">{t(verdict)}</p>
      {movers.length > 0 && movers[0].mixPoints! < 0 && (
        <ul className="text-xs text-muted-foreground space-y-1">
          {movers
            .filter((p) => (p.mixPoints as number) < 0)
            .map((p) => (
              <li key={p.productCode}>
                {t("shareShift", {
                  product: p.productName,
                  from: `${((p.budgetShare ?? 0) * 100).toFixed(1)}%`,
                  to: `${((p.actualShare ?? 0) * 100).toFixed(1)}%`,
                  points: (p.mixPoints as number).toFixed(2),
                })}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

function Points({
  label,
  value,
  t,
}: {
  label: string
  value: number
  t: ReturnType<typeof useTranslations<"productMargin">>
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="text-lg font-semibold tabular-nums"
        style={{ color: value < 0 ? BUDGET_COLORS.negative : BUDGET_COLORS.positive }}
      >
        {value >= 0 ? "+" : ""}
        {value.toFixed(2)} {t("points")}
      </div>
    </div>
  )
}

function Figure({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="text-lg font-semibold tabular-nums"
        style={{ color: pct === null ? undefined : tone(pct) }}
      >
        {pct === null ? "—" : `${pct.toFixed(1)}%`}
      </div>
    </div>
  )
}

/**
 * A margin that is not known must not render as a number — and must not
 * render as a dash either. A dash reads as "nothing here"; the reader needs
 * to know the ratio was withheld, not that the row is empty.
 */
function Pct({ value, noData }: { value: number | null; noData: string }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs">{noData}</span>
  }
  return <span style={{ color: tone(value) }}>{value.toFixed(1)}%</span>
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

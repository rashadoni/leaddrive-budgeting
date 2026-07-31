"use client"

import { useTranslations } from "next-intl"

interface StackTooltipPayloadEntry {
  dataKey?: string | number
  name?: string | number
  value?: number | string
  color?: string
  fill?: string
}

interface BudgetStackTooltipProps {
  active?: boolean
  label?: string | number
  payload?: StackTooltipPayloadEntry[]
  valueLabel?: string
  maxItems?: number
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function toNumber(value: number | string | undefined): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  return 0
}

export function BudgetStackTooltip({
  active,
  label,
  payload,
  valueLabel = "AZN",
  maxItems = 8,
}: BudgetStackTooltipProps) {
  const t = useTranslations("budgeting")
  if (!active || !payload?.length) return null

  const totalEntry = payload.find((entry) => entry.name === "Total" || entry.dataKey === "Total")
  const totalFromPayload = totalEntry ? toNumber(totalEntry.value) : null
  const items = payload
    .filter((entry) => entry.name !== "Total" && entry.dataKey !== "Total")
    .map((entry) => {
      const name = String(entry.name ?? entry.dataKey ?? "")
      const value = toNumber(entry.value)
      return {
        name,
        value,
        color: entry.color ?? entry.fill ?? "hsl(var(--muted-foreground))",
      }
    })
    .filter((entry) => Math.abs(entry.value) > 0.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const total = totalFromPayload ?? items.reduce((sum, item) => sum + item.value, 0)
  const visibleItems = items.slice(0, maxItems)
  const hiddenCount = Math.max(items.length - visibleItems.length, 0)

  if (items.length === 0 && Math.abs(total) <= 0.5) {
    return (
      <div className="max-w-[280px] rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
        <div className="font-semibold">{label}</div>
        <div className="mt-1 text-muted-foreground">{t("tooltipNoValueThisMonth")}</div>
      </div>
    )
  }

  return (
    <div className="max-w-[320px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      <div className="border-b border-border/70 px-3 py-2">
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 flex items-center justify-between gap-4 text-xs">
          <span className="text-muted-foreground">{t("totalLabel")}</span>
          <span className="font-mono font-semibold tabular-nums">
            {formatAmount(total)} {valueLabel}
          </span>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto px-3 py-2">
        <div className="space-y-1.5">
          {visibleItems.map((item) => (
            <div key={item.name} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="truncate text-muted-foreground" title={item.name}>
                {item.name}
              </span>
              <span className="font-mono font-medium tabular-nums">
                {formatAmount(item.value)}
              </span>
            </div>
          ))}
        </div>
        {hiddenCount > 0 && (
          <div className="mt-2 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
            {t("tooltipMoreLinesHidden", { count: hiddenCount })}
          </div>
        )}
      </div>
    </div>
  )
}

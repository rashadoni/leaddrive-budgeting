"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Coins } from "lucide-react"

interface FxLine {
  currencyCode: string
  originalTotal: number
  convertedTotal: number
  avgRate: number
  lineCount: number
}

interface Props {
  lines: Array<{
    currencyCode?: string | null
    originalAmount?: number | null
    plannedAmount: number
    exchangeRate?: number | null
  }>
  baseCurrency: string
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function BudgetFxSummary({ lines, baseCurrency }: Props) {
  // Group by currency
  const byCurrency = new Map<string, { original: number; converted: number; rates: number[]; count: number }>()

  for (const l of lines) {
    if (!l.currencyCode || !l.originalAmount) continue
    const existing = byCurrency.get(l.currencyCode) || { original: 0, converted: 0, rates: [], count: 0 }
    existing.original += l.originalAmount
    existing.converted += l.plannedAmount
    if (l.exchangeRate) existing.rates.push(l.exchangeRate)
    existing.count++
    byCurrency.set(l.currencyCode, existing)
  }

  if (byCurrency.size === 0) return null

  const fxLines: FxLine[] = []
  for (const [code, data] of byCurrency) {
    fxLines.push({
      currencyCode: code,
      originalTotal: data.original,
      convertedTotal: data.converted,
      avgRate: data.rates.length > 0 ? data.rates.reduce((a, b) => a + b, 0) / data.rates.length : 1,
      lineCount: data.count,
    })
  }

  const totalFxConverted = fxLines.reduce((s, l) => s + l.convertedTotal, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="h-4 w-4" />
          Multi-Currency Summary
          <Badge variant="outline" className="ml-2">{fxLines.length} currencies</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {fxLines.map((fx) => (
            <div key={fx.currencyCode} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div>
                <span className="font-medium text-sm">{fx.currencyCode}</span>
                <span className="text-xs text-muted-foreground ml-2">({fx.lineCount} lines)</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono">
                  {fmt(fx.originalTotal)} {fx.currencyCode}
                </div>
                <div className="text-xs text-muted-foreground">
                  ≈ {fmt(fx.convertedTotal)} {baseCurrency} @ {fx.avgRate.toFixed(4)}
                </div>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-sm font-medium">Total FX in {baseCurrency}</span>
            <span className="text-sm font-mono font-medium">{fmt(totalFxConverted)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

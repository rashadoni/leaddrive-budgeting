"use client"

import { useState } from "react"

interface Currency {
  id: string
  code: string
  name: string
  symbol: string
  exchangeRate: number
  isBase: boolean
}

interface Props {
  currencies: Currency[]
  value: string | null
  onChange: (code: string | null, rate: number | null) => void
  className?: string
}

export function BudgetCurrencySelector({ currencies, value, onChange, className }: Props) {
  const baseCurrency = currencies.find((c) => c.isBase)

  return (
    <select
      value={value || ""}
      onChange={(e) => {
        const code = e.target.value || null
        if (!code) {
          onChange(null, null)
        } else {
          const curr = currencies.find((c) => c.code === code)
          onChange(code, curr?.exchangeRate || 1)
        }
      }}
      className={`h-8 text-xs border rounded px-2 bg-background ${className || ""}`}
    >
      <option value="">{baseCurrency ? `${baseCurrency.code} (base)` : "Base"}</option>
      {currencies
        .filter((c) => !c.isBase)
        .map((c) => (
          <option key={c.id} value={c.code}>
            {c.code} ({c.symbol}) — {c.exchangeRate}
          </option>
        ))}
    </select>
  )
}

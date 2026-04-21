"use client"

import { cn } from "@/lib/utils"
import { type ReactNode, useState, useEffect, useRef } from "react"
import { InfoHint } from "@/components/info-hint"

const colorMap = {
  blue:   { dot: "bg-blue-500",   text: "text-blue-600 dark:text-blue-400",   light: "bg-blue-50 dark:bg-blue-950/20" },
  green:  { dot: "bg-green-500",  text: "text-green-600 dark:text-green-400", light: "bg-green-50 dark:bg-green-950/20" },
  violet: { dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400", light: "bg-violet-50 dark:bg-violet-950/20" },
  orange: { dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400", light: "bg-orange-50 dark:bg-orange-950/20" },
  red:    { dot: "bg-red-500",    text: "text-red-600 dark:text-red-400",     light: "bg-red-50 dark:bg-red-950/20" },
  amber:  { dot: "bg-amber-500",  text: "text-amber-600 dark:text-amber-400", light: "bg-amber-50 dark:bg-amber-950/20" },
  teal:   { dot: "bg-teal-500",   text: "text-teal-600 dark:text-teal-400",   light: "bg-teal-50 dark:bg-teal-950/20" },
  indigo: { dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400", light: "bg-indigo-50 dark:bg-indigo-950/20" },
  slate:  { dot: "bg-muted-foreground/50",  text: "text-muted-foreground", light: "bg-muted/50" },
}

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0)
  const prevTarget = useRef(target)

  useEffect(() => {
    const from = prevTarget.current !== target ? prevTarget.current : 0
    prevTarget.current = target
    if (target === 0 && from === 0) return

    const startTime = performance.now()
    let raf: number

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}

function extractNumber(val: string | number): number | null {
  if (typeof val === "number") return val
  const str = String(val)
  const m = str.match(/([-]?[\d,]+(?:\.\d+)?)\s*([kKMB]?)/)
  if (!m) return null
  const num = parseFloat(m[1].replace(/,/g, ""))
  if (isNaN(num)) return null
  const unit = m[2]
  if (unit === "k" || unit === "K") return num * 1000
  if (unit === "M") return num * 1_000_000
  if (unit === "B") return num * 1_000_000_000
  return num
}

function animateValue(original: string | number, animated: number): string {
  if (typeof original === "number") return String(animated)
  const str = String(original)
  const match = str.match(/^([^0-9-]*)([-]?[\d,]+(?:\.\d+)?)(\s*[kKMB])(.*$)/)
  if (match) {
    const [, prefix, , unitWithSpace, suffix] = match
    const unit = unitWithSpace.trim()
    if (unit === "k" || unit === "K") {
      return prefix + Math.round(animated / 1000).toLocaleString() + unitWithSpace + suffix
    }
    if (unit === "M") {
      return prefix + (animated / 1_000_000).toFixed(1) + unitWithSpace + suffix
    }
    if (unit === "B") {
      return prefix + (animated / 1_000_000_000).toFixed(1) + unitWithSpace + suffix
    }
  }
  const stdMatch = str.match(/^([^0-9-]*)([-]?[\d,]+)(.*$)/)
  if (!stdMatch) return str
  const [, stdPrefix, , stdSuffix] = stdMatch
  return stdPrefix + animated.toLocaleString() + stdSuffix
}

interface ColorStatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  color?: keyof typeof colorMap
  className?: string
  bgClass?: string
  subValue?: string
  lines?: { label: string; value: string }[]
  hint?: string
  animate?: boolean
}

export function ColorStatCard({
  label,
  value,
  icon,
  color = "blue",
  className,
  bgClass,
  subValue,
  lines,
  hint,
  animate = false,
}: ColorStatCardProps) {
  const colors = colorMap[color]
  const numericTarget = extractNumber(value)
  const animatedNum = useCountUp(animate && numericTarget !== null ? numericTarget : 0, 900)
  const displayValue = animate && numericTarget !== null ? animateValue(value, animatedNum) : value

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card p-5 flex flex-col gap-2 transition-all duration-200 hover:shadow-md shadow-[0_1px_3px_rgba(0,0,0,0.05)]",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", colors.dot)} />
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          {hint && <InfoHint text={hint} size={12} />}
        </div>
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", colors.light)}>
          <span className={colors.text}>{icon}</span>
        </div>
      </div>
      <span className={cn("text-2xl font-bold leading-tight tracking-tight text-foreground")}>
        {displayValue}
      </span>
      {subValue && (
        <span className="text-xs text-muted-foreground">{subValue}</span>
      )}
      {lines && lines.length > 0 && (
        <div className="mt-1 space-y-0.5 border-t border-border pt-1.5">
          {lines.map((line, i) => (
            <div key={i} className="flex justify-between text-xs text-muted-foreground">
              <span>{line.label}</span>
              <span className="font-medium text-foreground">{line.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

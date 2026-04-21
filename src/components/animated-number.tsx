"use client"

import { useEffect, useRef, useState } from "react"

interface AnimatedNumberProps {
  value: number
  duration?: number // ms, default 800
  formatter?: (n: number) => string
  className?: string
  /** Trigger animation on mount or when value changes */
  trigger?: "mount" | "always"
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

export function AnimatedNumber({
  value,
  duration = 800,
  formatter,
  className,
  trigger = "always",
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(trigger === "mount" ? 0 : value)
  const prevValue = useRef(trigger === "mount" ? 0 : value)
  const rafRef = useRef<number>(0)

  const fmt = formatter ?? ((n: number) => Math.round(n).toLocaleString() + " ₼")

  useEffect(() => {
    const from = prevValue.current
    const to = value

    if (from === to) return

    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutExpo(progress)
      const current = from + (to - from) * easedProgress

      setDisplay(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        prevValue.current = to
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  return <span className={className}>{fmt(display)}</span>
}

/** Format number with ₼ suffix */
export const fmtManat = (n: number) => Math.round(n).toLocaleString() + " ₼"

/** Format as percentage */
export const fmtPct = (n: number) => n.toFixed(1) + "%"

/** Format as integer percentage */
export const fmtPctInt = (n: number) => Math.round(n) + "%"

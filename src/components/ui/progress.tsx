"use client"

import * as React from "react"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className = "", value = 0, max = 100, indicatorClassName = "", ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100))
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={`relative h-2 w-full overflow-hidden rounded-full bg-muted ${className}`}
        {...props}
      >
        <div
          className={`h-full rounded-full transition-all ${indicatorClassName || "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  }
)
Progress.displayName = "Progress"

export { Progress }

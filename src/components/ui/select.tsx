"use client"

import * as React from "react"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, children, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && <label className="text-sm font-medium">{label}</label>}
        <select
          ref={ref}
          className={`flex h-10 w-full rounded-lg border border-border/70 bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/40 ${className}`}
          {...props}
        >
          {children}
        </select>
      </div>
    )
  }
)
Select.displayName = "Select"

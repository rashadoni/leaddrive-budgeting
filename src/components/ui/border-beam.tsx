"use client"

import { cn } from "@/lib/utils"

interface BorderBeamProps {
  className?: string
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  borderWidth?: number
}

export function BorderBeam({
  className,
  size = 200,
  duration = 12,
  delay = 0,
  colorFrom = "#7c3aed",
  colorTo = "#06b6d4",
  borderWidth = 1.5,
}: BorderBeamProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit]",
        className
      )}
      style={{
        borderWidth,
        borderStyle: "solid",
        borderColor: "transparent",
        WebkitMask: "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
        backgroundImage: `conic-gradient(from calc(var(--border-beam-angle, 0deg)), transparent 0%, ${colorFrom} 10%, ${colorTo} 20%, transparent 30%)`,
        backgroundOrigin: "border-box",
        backgroundClip: "border-box",
        animation: `border-beam-spin ${duration}s linear infinite`,
        animationDelay: `${delay}s`,
      }}
    />
  )
}

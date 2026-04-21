"use client"

import { cn } from "@/lib/utils"

interface MeteorsProps {
  number?: number
  className?: string
}

export function Meteors({ number = 20, className }: MeteorsProps) {
  const meteors = Array.from({ length: number }, (_, i) => i)

  return (
    <>
      {meteors.map((_, i) => (
        <span
          key={i}
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-0.5 rotate-[215deg] animate-meteor rounded-full bg-muted-foreground/50 shadow-[0_0_0_1px_#ffffff10]",
            className
          )}
          style={{
            top: Math.floor(Math.random() * 100) + "%",
            left: Math.floor(Math.random() * 100) + "%",
            animationDelay: `${Math.random() * 1 + 0.2}s`,
            animationDuration: `${Math.floor(Math.random() * 8 + 2)}s`,
          }}
        >
          <span className="absolute top-1/2 -z-10 h-px w-[50px] -translate-y-1/2 bg-gradient-to-r from-muted-foreground/50 to-transparent" />
        </span>
      ))}
    </>
  )
}

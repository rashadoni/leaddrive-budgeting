"use client"

import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface InfoHintProps {
  text: string
  side?: "top" | "right" | "bottom" | "left"
  className?: string
  size?: number
}

export function InfoHint({ text, side = "top", className = "", size = 14 }: InfoHintProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center cursor-help ${className}`}>
            <Info className="text-muted-foreground/50 hover:text-muted-foreground transition-colors" style={{ width: size, height: size }} />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[300px] text-xs leading-relaxed bg-popover text-popover-foreground border border-border shadow-lg"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

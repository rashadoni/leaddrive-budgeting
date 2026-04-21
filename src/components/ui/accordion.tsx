"use client"

import { useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

interface AccordionItemProps {
  title: string
  icon?: ReactNode
  count?: number
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

export function AccordionItem({
  title,
  icon,
  count,
  defaultOpen = false,
  children,
  className,
}: AccordionItemProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn("border-b border-border last:border-0", className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 py-3 px-1 text-left hover:bg-muted/30 rounded-lg transition-colors group"
      >
        <motion.div
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </motion.div>
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="text-sm font-medium flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-[24px] text-center">
            {count}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pb-3 px-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

"use client"

import { motion, AnimatePresence, type HTMLMotionProps } from "framer-motion"
import { forwardRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

// ── Fade-in card with optional delay ──
export const MotionCard = forwardRef<
  HTMLDivElement,
  HTMLMotionProps<"div"> & { delay?: number }
>(({ delay = 0, className, children, ...props }, ref) => (
  <motion.div
    ref={ref}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 8 }}
    transition={{ duration: 0.25, delay, ease: "easeOut" }}
    className={className}
    {...props}
  >
    {children}
  </motion.div>
))
MotionCard.displayName = "MotionCard"

// ── Staggered list container ──
export function MotionList({
  children,
  className,
  staggerDelay = 0.05,
}: {
  children: ReactNode
  className?: string
  staggerDelay?: number
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: staggerDelay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Individual stagger item ──
export function MotionItem({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Page transition wrapper ──
export function MotionPage({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Tab content crossfade ──
export function MotionTab({
  children,
  activeKey,
  className,
}: {
  children: ReactNode
  activeKey: string
  className?: string
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeKey}
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

// ── Collapsible section (accordion) with smooth height ──
export function MotionCollapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Hover lift effect for cards ──
export function MotionHoverCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Slide in from right (for notifications / toasts) ──
export function MotionSlideIn({
  children,
  className,
  direction = "right",
}: {
  children: ReactNode
  className?: string
  direction?: "left" | "right" | "up" | "down"
}) {
  const offsets = {
    left: { x: -24, y: 0 },
    right: { x: 24, y: 0 },
    up: { x: 0, y: -24 },
    down: { x: 0, y: 24 },
  }

  return (
    <motion.div
      initial={{ opacity: 0, ...offsets[direction] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, ...offsets[direction] }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export { AnimatePresence }

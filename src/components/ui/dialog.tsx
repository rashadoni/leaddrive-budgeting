"use client"

import * as React from "react"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="relative bg-background rounded-lg shadow-lg w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col [&>form]:flex [&>form]:flex-col [&>form]:flex-1 [&>form]:min-h-0 [&>form]:overflow-hidden" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function DialogContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 overflow-y-auto flex-1 ${className}`}>{children}</div>
}

export function DialogHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 pt-6 pb-2 ${className}`}>{children}</div>
}

export function DialogTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>
}

export function DialogDescription({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm text-muted-foreground mt-1 ${className}`}>{children}</p>
}

export function DialogFooter({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 pb-6 pt-3 flex justify-end gap-2 border-t flex-shrink-0 ${className}`}>{children}</div>
}

"use client"

/**
 * Phase 7.F (Turn 13) — `AUD GO` audit-log overlay for Risk Terminal.
 *
 * Bloomberg-style modal: opens on the `terminal:open-audit` window
 * event (fired by `CommandBar.dispatch` for the `aud` parsed command),
 * closes on Escape OR backdrop click. Embeds the same `AuditFeed`
 * component the standalone `/budgeting/audit` page renders, so the
 * modal and the page share filtering / pagination logic 1:1.
 *
 * Why a modal (and not a 5th panel): the audit log is an
 * occasionally-checked meta-tool, not a perpetual workspace. Adding a
 * 5th panel would force every user into a 5-pane grid even when not
 * looking at audit data. The overlay opens on demand, dismisses on
 * Escape, and never disturbs the underlying 4-panel layout.
 *
 * Manager+ role gating happens server-side at the `/api/audit/events`
 * endpoint (`requireRole('manager')` returns 403 for viewers); this
 * component renders the modal regardless of role and lets the API
 * surface the auth error in the feed's existing `role=alert` chip.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AuditFeed } from "@/features/audit/components/AuditFeed"

export function AuditModal() {
  const t = useTranslations("terminal")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener("terminal:open-audit", onOpen)
    return () => window.removeEventListener("terminal:open-audit", onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("auditModal.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        // Backdrop click (target === currentTarget) closes; clicks
        // inside the panel propagate but don't close because they
        // don't reach this handler with target===currentTarget.
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="relative w-full max-w-6xl max-h-[90vh] overflow-y-auto rounded-lg border border-input bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("auditModal.title")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("auditModal.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("auditModal.closeAriaLabel")}
            className="rounded border border-input px-3 py-1 text-sm hover:bg-muted/50"
          >
            {t("auditModal.close")}
          </button>
        </header>
        <div className="px-6 py-4">
          <AuditFeed />
        </div>
      </div>
    </div>
  )
}

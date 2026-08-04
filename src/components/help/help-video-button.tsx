"use client"

/**
 * src/components/help/help-video-button.tsx
 * =====================================================================
 * Header trigger that re-opens this section's guide video.
 *
 * WHY THIS EXISTS: `help-video-launcher.tsx` renders an in-flow card whose ✕
 * writes `thumbnailDismissed: true` into localStorage, and its own comment said
 * the card "can be reopened from the Help button". That button was never built
 * — nothing in the codebase dispatched `budgetpro:open-help-video` — so a single
 * ✕ removed a section's guide permanently, per browser, with no way back. Found
 * on 2026-08-03 on production: the Statement Controls card was gone and the
 * stored state read {"expandedSeen":true,"thumbnailDismissed":true}.
 *
 * The launcher registers its `budgetpro:open-help-video` listener before its
 * `mode === "hidden"` early-return, so the event reaches it even while the card
 * is dismissed; handling it sets session mode to "expanded" and the modal opens.
 *
 * Renders nothing on routes with no mapped video, so it never becomes a dead
 * control.
 * =====================================================================
 */
import { useMemo } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getHelpVideoForPath } from "@/content/help/video-assets"

export function HelpVideoButton() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchKey = searchParams.toString()
  const entry = useMemo(
    () => getHelpVideoForPath(pathname, searchKey),
    [pathname, searchKey],
  )
  const t = useTranslations("helpVideo")

  if (!entry) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="help-video-button"
      title={t("play")}
      aria-label={t("play")}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("budgetpro:open-help-video", { detail: { slug: entry.slug } }),
        )
      }
    >
      <Video className="h-4 w-4" />
    </Button>
  )
}

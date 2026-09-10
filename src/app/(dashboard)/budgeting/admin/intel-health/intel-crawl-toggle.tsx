"use client"

/**
 * Тумблер расписания платного intel-обхода.
 *
 * Обход тратит деньги сам по себе: один round-trip модели плюс до пяти
 * `web_search` на организацию каждый день, независимо от того, заходил ли
 * кто-нибудь в приложение. По счёту видно только «списано», а не «кто просил»,
 * поэтому расписание выключено по умолчанию и включается отсюда.
 *
 * Тумблер управляет ТОЛЬКО расписанием. Ручной запуск обхода админом
 * (`POST /api/intel/refresh`) продолжает работать при выключенном расписании:
 * человек, нажавший кнопку, знает, что тратит.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function IntelCrawlToggle({
  enabled,
  canEdit,
}: {
  enabled: boolean
  canEdit: boolean
}) {
  const t = useTranslations("adminIntelHealth")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const busy = saving || pending

  async function toggle() {
    if (busy || !canEdit) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/organizations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intelCrawlEnabled: !enabled }),
      })
      if (!res.ok) {
        // Текст ошибки сервера не показываем: он англоязычный и техничный.
        // Пользователю нужно знать, что не сохранилось, — а подробности в логе.
        setError(t("crawlSchedule.saveFailed"))
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError(t("crawlSchedule.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("crawlSchedule.label")}
          disabled={!canEdit || busy}
          onClick={toggle}
          data-testid="intel-crawl-schedule-toggle"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-emerald-600" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className="text-sm font-medium">
          {enabled ? t("crawlSchedule.on") : t("crawlSchedule.off")}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {enabled ? t("crawlSchedule.hintOn") : t("crawlSchedule.hintOff")}
      </p>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">{t("crawlSchedule.adminOnly")}</p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

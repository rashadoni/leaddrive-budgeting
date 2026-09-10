"use client"

/**
 * Главный выключатель платных ИИ-функций организации.
 *
 * Стоит на странице ключей, потому что вопрос тут один и тот же: за чей счёт
 * и по чьему согласию идёт платная работа. Наличие ключа согласия не заменяет
 * — если организация свой ключ не завела, берётся общий ключ развёртывания,
 * то есть счёт владельца продукта, и «ключ есть» становится правдой само
 * собой. Поэтому согласие — отдельный тумблер, и по умолчанию он выключен.
 *
 * Выключено — все ИИ-функции показывают свой обычный экран «недоступно»:
 * это состояние в продукте уже есть и уже протестировано, отдельного
 * «выключенного» вида изобретать не пришлось.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function AiFeaturesToggle({ enabled }: { enabled: boolean }) {
  const t = useTranslations("adminApiKeys")
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || pending

  async function toggle() {
    if (busy) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/organizations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiEnabled: !enabled }),
      })
      if (!res.ok) {
        setError(t("aiFeatures.saveFailed"))
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError(t("aiFeatures.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t("aiFeatures.title")}</h2>
          <p className="text-xs text-muted-foreground max-w-prose">
            {enabled ? t("aiFeatures.hintOn") : t("aiFeatures.hintOff")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("aiFeatures.title")}
          disabled={busy}
          onClick={toggle}
          data-testid="ai-features-toggle"
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
      </div>
      <p className="text-xs font-medium">
        {enabled ? t("aiFeatures.on") : t("aiFeatures.off")}
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

"use client"
/**
 * The gate. Reason, permanent-loss acknowledgements, typed token, red button.
 *
 * Nothing here is weaker than what the old panel asked for. What changed is
 * that the token now says something — at Tier 1 it is the company's own code,
 * so typing it is a statement about WHICH company, which "ALL" never was.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"
import { canSubmit, WIDEST_TOKEN, type GateSpec } from "@/features/admin/lib/delete-data/tier"
import { buildLedger } from "@/features/admin/lib/delete-data/categories"

export function ConfirmStrip({
  gate,
  breakdown,
  reason,
  onReason,
  token,
  onToken,
  armedAt,
  running,
  hardStop,
  stale,
  submitLabel,
  onSubmit,
}: {
  gate: GateSpec
  breakdown: Record<string, number>
  reason: string
  onReason: (v: string) => void
  token: string
  onToken: (v: string) => void
  armedAt: number | null
  running: boolean
  hardStop: boolean
  stale: boolean
  submitLabel: string
  onSubmit: () => void
}) {
  const t = useTranslations("adminDataDelete")
  const ledger = buildLedger(breakdown)
  const permanentLines = ledger.groups.find((g) => g.fate === "permanent")?.lines ?? []
  const [acks, setAcks] = useState<Record<string, boolean>>({})
  const [now, setNow] = useState(() => Date.now())

  // Tick only while the arm delay is still running.
  useEffect(() => {
    if (gate.armMs <= 0 || armedAt == null) return
    if (Date.now() - armedAt >= gate.armMs) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [gate.armMs, armedAt])

  const secondsLeft =
    gate.armMs > 0 && armedAt != null
      ? Math.max(0, Math.ceil((gate.armMs - (now - armedAt)) / 1000))
      : 0

  const enabled = canSubmit({
    gate,
    typedToken: token,
    reason,
    previewRows: ledger.rows + ledger.items,
    previewStale: stale,
    armedAt,
    now,
    permanentAcks: acks,
    permanentKeys: permanentLines.map((l) => l.key),
    running,
    hardStop,
  })

  // Why the red button is dead. Only said when the answer really is "you have
  // not finished filling this in" — a stale preview, the hard stop and the arm
  // countdown all have their own visible messages, and repeating this one
  // under them would send the operator to fix the wrong thing.
  const blockedOnEntry =
    !enabled &&
    !running &&
    !stale &&
    !hardStop &&
    secondsLeft === 0 &&
    (token !== gate.token || reason.trim().length < gate.minReason)

  return (
    <div data-testid="confirm-strip" className="mt-5 space-y-4 border-t border-border pt-5">
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">{t("reason.label")}</span>
        <textarea
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t("reason.placeholder")}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </label>
      {gate.reasonChips && (
        <div className="flex flex-wrap gap-1.5">
          {(["wrongFile", "duplicate", "freshYear"] as const).map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onReason(t(`reason.chip.${chip}`))}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              {t(`reason.chip.${chip}`)}
            </button>
          ))}
        </div>
      )}
      {reason.trim().length > 0 && reason.trim().length < gate.minReason && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t("reason.tooShort")}</p>
      )}

      {permanentLines.length > 0 && (
        <div className="space-y-1.5 rounded border border-red-300 bg-red-50 p-3 dark:border-red-500/40 dark:bg-red-500/10">
          {permanentLines.map((line) => (
            <label
              key={line.key}
              className="flex items-start gap-2 text-sm text-red-900 dark:text-red-200"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acks[line.key] ?? false}
                onChange={(e) => setAcks((prev) => ({ ...prev, [line.key]: e.target.checked }))}
              />
              <span>
                {/* `{count}` used to print bare — "(12)" in a red box, 12 of
                    what. It goes through the unit the ledger recorded, so
                    records read as records and rows as rows. */}
                {t("confirm.permanentTick", {
                  label: t(`category.${line.labelKey}`),
                  count:
                    line.unit === "items"
                      ? t("unit.items", { count: line.count })
                      : t("unit.rows", { count: line.count }),
                })}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="text-sm font-semibold">
            {t("confirm.tokenLabel", { code: gate.token })}
          </span>
          <input
            value={token}
            onChange={(e) => onToken(e.target.value)}
            placeholder={gate.token}
            spellCheck={false}
            autoComplete="off"
            className="h-10 w-full rounded border border-border bg-background px-3 font-mono text-sm"
          />
          <span className="block text-xs text-muted-foreground">
            {/* Keyed off the TOKEN, not the tier: a Tier 2 single-company
                scope asks for that company's code, and telling the operator
                "this covers more than one company" while the box wants
                "ACME" is the same class of lie the gate itself had. */}
            {gate.token === WIDEST_TOKEN
              ? t("confirm.tokenHintAll")
              : t("confirm.tokenHintCompany")}
          </span>
          {blockedOnEntry && (
            <span className="block text-xs text-muted-foreground">
              {t("confirm.blocked", { code: gate.token })}
            </span>
          )}
        </label>
        <div className="space-y-1">
          <button
            type="button"
            data-testid="confirm-submit"
            disabled={!enabled}
            onClick={onSubmit}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {running ? t("submit.running") : submitLabel}
          </button>
          {secondsLeft > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {t("confirm.arming", { seconds: secondsLeft })}
            </p>
          )}
        </div>
      </div>
      {running && (
        <p className="text-xs text-muted-foreground">{t("submit.runningNote")}</p>
      )}
    </div>
  )
}

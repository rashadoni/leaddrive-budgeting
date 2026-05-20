"use client"
/**
 * Phase 7.M Step 4d (2026-05-18) — admin archive form (client side).
 *
 * Drives `POST /api/admin/data-archive`. Built deliberately simple —
 * a finance user should be able to use this without training:
 *
 *   1. Pick entity kind (radio buttons with plain-language labels).
 *   2. Pick scope (company picker + year + optional period).
 *   3. Type confirmation code (the company code, or "ALL" for org-wide).
 *   4. Add reason (free text, lives in audit log).
 *   5. Click Archive (or Restore).
 *
 * The Archive button stays disabled until the confirm field matches —
 * impossible to fat-finger a destructive action.
 */
import { useState } from "react"

interface CompanyOption {
  code: string
  name: string
}

type EntityKind =
  | "BudgetLine"
  | "BalanceSheetLine"
  | "CashFlowEntry"
  | "Counterparty"

const ENTITY_KIND_LABELS: Record<
  EntityKind,
  { ru: string; description: string }
> = {
  BudgetLine: {
    ru: "Бюджетные строки (P&L)",
    description:
      "Revenue / COGS / OPEX. Архивирование уберёт их из расчёта индикаторов и HeatMap.",
  },
  BalanceSheetLine: {
    ru: "Balance Sheet строки",
    description:
      "Assets / Liabilities / Equity. Архивирование уберёт из баланса. Скоуп — год, не компания.",
  },
  CashFlowEntry: {
    ru: "Cash Flow entries",
    description:
      "Притоки/оттоки денег. Скоуп — год (org-уровень), компания не применяется.",
  },
  Counterparty: {
    ru: "Контрагенты (клиенты/поставщики)",
    description:
      "Top-N клиенты и поставщики. Влияет на HHI-концентрацию и customer-supplier risk.",
  },
}

export function DataArchiveForm({
  companies,
}: {
  companies: ReadonlyArray<CompanyOption>
}) {
  const [mode, setMode] = useState<"archive" | "restore">("archive")
  const [entityKind, setEntityKind] = useState<EntityKind>("BudgetLine")
  const [companyCode, setCompanyCode] = useState<string>("")
  const [year, setYear] = useState<string>("")
  const [period, setPeriod] = useState<string>("")
  const [reason, setReason] = useState<string>("")
  const [confirmCode, setConfirmCode] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<
    | { ok: true; mode: string; rowsAffected: number }
    | { ok: false; error: string }
    | null
  >(null)

  // companyCode required for BudgetLine + Counterparty; for BS+CF
  // the schema doesn't surface companyId so we hide the picker.
  const needsCompany =
    entityKind === "BudgetLine" || entityKind === "Counterparty"
  const needsYear = entityKind !== "Counterparty"
  const needsPeriod = entityKind === "Counterparty"

  const expectedConfirm = companyCode || "ALL"
  const canSubmit =
    confirmCode === expectedConfirm &&
    (!needsCompany || companyCode.length > 0) &&
    (!needsYear || year.length > 0) &&
    (!needsPeriod || period.length > 0) &&
    !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/admin/data-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          entityKind,
          companyCode: needsCompany ? companyCode : undefined,
          year: needsYear && year ? parseInt(year, 10) : undefined,
          period: needsPeriod ? period : undefined,
          reason: reason || undefined,
          confirmCode,
        }),
      })
      const data = (await res.json()) as
        | { ok: true; mode: string; rowsAffected: number }
        | { error: string }
      if (!res.ok || !("ok" in data && data.ok)) {
        setResult({
          ok: false,
          error: "error" in data ? data.error : "Unknown error",
        })
      } else {
        setResult({
          ok: true,
          mode: data.mode,
          rowsAffected: data.rowsAffected,
        })
        // Refresh recent-events table by reloading the page after
        // a successful action — server component re-fetches the
        // AuditEvent list.
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border rounded p-5 space-y-5 bg-card"
    >
      {/* Mode picker */}
      <div>
        <label className="block text-sm font-semibold mb-2">Действие</label>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="archive"
              checked={mode === "archive"}
              onChange={() => setMode("archive")}
            />
            <span>Архивировать (скрыть из расчётов)</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="restore"
              checked={mode === "restore"}
              onChange={() => setMode("restore")}
            />
            <span>Восстановить (вернуть скрытые)</span>
          </label>
        </div>
      </div>

      {/* Entity kind */}
      <div>
        <label className="block text-sm font-semibold mb-2">Тип данных</label>
        <select
          value={entityKind}
          onChange={(e) => setEntityKind(e.target.value as EntityKind)}
          className="w-full border rounded px-3 py-2 text-sm bg-background"
        >
          {(Object.keys(ENTITY_KIND_LABELS) as EntityKind[]).map((k) => (
            <option key={k} value={k}>
              {ENTITY_KIND_LABELS[k].ru}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {ENTITY_KIND_LABELS[entityKind].description}
        </p>
      </div>

      {/* Scope: company */}
      {needsCompany && (
        <div>
          <label className="block text-sm font-semibold mb-2">Компания</label>
          <select
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background"
          >
            <option value="">— выберите —</option>
            {companies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Scope: year */}
      {needsYear && (
        <div>
          <label className="block text-sm font-semibold mb-2">Год</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2026"
            className="w-32 border rounded px-3 py-2 text-sm bg-background"
            min={2000}
            max={2100}
          />
        </div>
      )}

      {/* Scope: period (counterparty only) */}
      {needsPeriod && (
        <div>
          <label className="block text-sm font-semibold mb-2">
            Период (например, 2026 или 2026-Q1)
          </label>
          <input
            type="text"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026"
            className="w-32 border rounded px-3 py-2 text-sm bg-background"
          />
        </div>
      )}

      {/* Reason */}
      <div>
        <label className="block text-sm font-semibold mb-2">
          Причина (для audit trail)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например: ошибочно импортированные строки 2025 года, заменяем актуалами"
          className="w-full border rounded px-3 py-2 text-sm bg-background"
          rows={2}
          maxLength={500}
        />
      </div>

      {/* Confirm field — visual safety */}
      <div className="border-t pt-4">
        <label className="block text-sm font-semibold mb-2">
          Введите {expectedConfirm === "ALL" ? '"ALL"' : `"${expectedConfirm}"`}{" "}
          для подтверждения
        </label>
        <input
          type="text"
          value={confirmCode}
          onChange={(e) => setConfirmCode(e.target.value)}
          placeholder={expectedConfirm}
          className="w-full border rounded px-3 py-2 text-sm bg-background font-mono"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`w-full py-2.5 px-4 rounded text-sm font-semibold transition-colors ${
          canSubmit
            ? mode === "archive"
              ? "bg-amber-600 hover:bg-amber-700 text-white"
              : "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-muted text-muted-foreground cursor-not-allowed"
        }`}
      >
        {submitting
          ? "Выполняется…"
          : mode === "archive"
            ? "Архивировать"
            : "Восстановить"}
      </button>

      {/* Result */}
      {result && (
        <div
          className={`rounded p-3 text-sm ${
            result.ok
              ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              : "bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300"
          }`}
        >
          {result.ok ? (
            <>
              ✓ Готово. {result.mode === "archive" ? "Архивировано" : "Восстановлено"}{" "}
              <strong>{result.rowsAffected}</strong> строк. Страница обновится…
            </>
          ) : (
            <>✗ Ошибка: {result.error}</>
          )}
        </div>
      )}
    </form>
  )
}

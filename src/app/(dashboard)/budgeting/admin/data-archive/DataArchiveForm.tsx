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
import { useTranslations } from "next-intl"

interface CompanyOption {
  code: string
  name: string
}

type EntityKind =
  | "BudgetLine"
  | "BalanceSheetLine"
  | "CashFlowEntry"
  | "Counterparty"
  | "AllImportData"

const ENTITY_KIND_KEYS: EntityKind[] = [
  "BudgetLine",
  "BalanceSheetLine",
  "CashFlowEntry",
  "Counterparty",
  "AllImportData",
]

export function DataArchiveForm({
  companies,
}: {
  companies: ReadonlyArray<CompanyOption>
}) {
  const t = useTranslations("adminDataArchive.form")
  const [mode, setMode] = useState<"archive" | "restore">("archive")
  const [entityKind, setEntityKind] = useState<EntityKind>("BudgetLine")
  const [companyCode, setCompanyCode] = useState<string>("")
  const [year, setYear] = useState<string>("")
  const [period, setPeriod] = useState<string>("")
  const [reason, setReason] = useState<string>("")
  const [confirmCode, setConfirmCode] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<
    | {
        ok: true
        mode: string
        rowsAffected: number
        unattributableCfRows?: number
        breakdown?: Record<string, number>
        recomputed?: number
      }
    | { ok: false; error: string }
    | null
  >(null)

  // companyCode REQUIRED for BudgetLine + Counterparty (they have a
  // companyId FK). For BS+CF it is OPTIONAL (2026-06-20 fix): blank =
  // deliberate org-wide-per-year archive; a selected company narrows the
  // archive to that entity only — BS via its companyId column, CF via the
  // "<code>::" sourceId prefix. Previously BS/CF hid the picker and always
  // wiped every company's rows for the year.
  const isReset = entityKind === "AllImportData"
  const needsCompany =
    entityKind === "BudgetLine" || entityKind === "Counterparty" || isReset
  const allowsCompany =
    needsCompany ||
    entityKind === "BalanceSheetLine" ||
    entityKind === "CashFlowEntry"
  // Reset: year is OPTIONAL (blank = all years) — shown but not required.
  const needsYear = entityKind !== "Counterparty" && !isReset
  const allowsYear = needsYear || isReset
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
          companyCode: companyCode.length > 0 ? companyCode : undefined,
          year: needsYear && year ? parseInt(year, 10) : undefined,
          period: needsPeriod ? period : undefined,
          reason: reason || undefined,
          confirmCode,
        }),
      })
      const data = (await res.json()) as
        | {
            ok: true
            mode: string
            rowsAffected: number
            unattributableCfRows?: number
            breakdown?: Record<string, number>
            recomputed?: number
          }
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
          unattributableCfRows: data.unattributableCfRows,
          breakdown: data.breakdown,
          recomputed: data.recomputed,
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
        <label className="block text-sm font-semibold mb-2">{t("modeLabel")}</label>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="archive"
              checked={mode === "archive"}
              onChange={() => setMode("archive")}
            />
            <span>{t("modeArchive")}</span>
          </label>
          <label
            className={`flex items-center gap-2 text-sm ${
              isReset ? "opacity-40 cursor-not-allowed" : ""
            }`}
          >
            <input
              type="radio"
              name="mode"
              value="restore"
              checked={mode === "restore"}
              onChange={() => setMode("restore")}
              disabled={isReset}
            />
            <span>{t("modeRestore")}</span>
          </label>
        </div>
        {isReset && (
          <p className="text-xs text-muted-foreground mt-1">
            {t("resetRestoreNote")}
          </p>
        )}
      </div>

      {/* Entity kind */}
      <div>
        <label className="block text-sm font-semibold mb-2">{t("entityKindLabel")}</label>
        <select
          value={entityKind}
          onChange={(e) => {
            const next = e.target.value as EntityKind
            setEntityKind(next)
            if (next === "AllImportData") setMode("archive") // reset is archive-only
          }}
          className="w-full border rounded px-3 py-2 text-sm bg-background"
        >
          {ENTITY_KIND_KEYS.map((k) => (
            <option key={k} value={k}>
              {k === "AllImportData" ? t("resetLabel") : t(`entityKind.${k}.label`)}
            </option>
          ))}
        </select>
        <p
          className={`text-xs mt-1 leading-relaxed ${
            isReset ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
          }`}
        >
          {isReset ? t("resetDesc") : t(`entityKind.${entityKind}.description`)}
        </p>
      </div>

      {/* Scope: company */}
      {allowsCompany && (
        <div>
          <label className="block text-sm font-semibold mb-2">
            {t("companyLabel")}
            {!needsCompany && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t("companyOptionalOrgYear")}
              </span>
            )}
          </label>
          <select
            value={companyCode}
            onChange={(e) => setCompanyCode(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background"
          >
            <option value="">
              {needsCompany ? t("companyPickerPlaceholder") : t("orgWideOption")}
            </option>
            {companies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Scope: year */}
      {allowsYear && (
        <div>
          <label className="block text-sm font-semibold mb-2">
            {t("yearLabel")}
            {isReset && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t("yearOptionalAllYears")}
              </span>
            )}
          </label>
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
            {t("periodLabel")}
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
          {t("reasonLabel")}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("reasonPlaceholder")}
          className="w-full border rounded px-3 py-2 text-sm bg-background"
          rows={2}
          maxLength={500}
        />
      </div>

      {/* Confirm field — visual safety */}
      <div className="border-t pt-4">
        <label className="block text-sm font-semibold mb-2">
          {t("confirmLabel", { value: expectedConfirm })}
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
          ? t("submitRunning")
          : mode === "archive"
            ? t("submitArchive")
            : t("submitRestore")}
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
              {result.mode === "reset" ? (
                <>
                  ✓ {t("resultReset", { rows: result.rowsAffected })}
                  {result.breakdown && (
                    <div className="mt-2 text-xs font-mono space-y-0.5">
                      {Object.entries(result.breakdown).map(([k, v]) => (
                        <div key={k}>
                          {k}: {v}
                        </div>
                      ))}
                      {result.recomputed != null && (
                        <div className="mt-1">{t("breakdownRecomputed", { n: result.recomputed })}</div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  ✓{" "}
                  {t("resultOk", {
                    action:
                      result.mode === "archive"
                        ? t("resultArchived")
                        : t("resultRestored"),
                    rows: result.rowsAffected,
                  })}
                </>
              )}
              {result.unattributableCfRows != null &&
                result.unattributableCfRows > 0 && (
                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {t("cfUnattributableNote", { count: result.unattributableCfRows })}
                  </div>
                )}
            </>
          ) : (
            <>✗ {t("resultError", { msg: result.error })}</>
          )}
        </div>
      )}
    </form>
  )
}

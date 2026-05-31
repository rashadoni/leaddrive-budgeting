"use client"

/**
 * Phase 7.I — inline OperationalFact entry pop-out for agro/food companies.
 *
 * Compact form for adding a single OperationalFact row (yield_per_ha,
 * sugar_content_pct, water_use_m3_per_ha, fertilizer_kg_per_ha,
 * extraction_rate_pct, harvest_tons, area_hectares).
 *
 * Reuses existing POST /api/operational-facts endpoint — same validation
 * + audit chain as the admin /budgeting/admin/data-entry UI but accessible
 * directly from the terminal without leaving the workspace.
 */

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { useTerminalStore } from "../store/terminalStore"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save, AlertCircle, Check, Sprout } from "lucide-react"

const AGRO_METRICS = [
  { key: "yield_per_ha", labelKey: "metricYield", unit: "tons/ha" },
  { key: "sugar_content_pct", labelKey: "metricSugarContent", unit: "%" },
  { key: "water_use_m3_per_ha", labelKey: "metricWaterUse", unit: "m³/ha" },
  { key: "fertilizer_kg_per_ha", labelKey: "metricFertilizer", unit: "kg/ha" },
  { key: "extraction_rate_pct", labelKey: "metricExtractionRate", unit: "%" },
  { key: "harvest_tons", labelKey: "metricHarvest", unit: "tons" },
  { key: "area_hectares", labelKey: "metricAreaPlanted", unit: "hectares" },
] as const

type MetricKey = (typeof AGRO_METRICS)[number]["key"]

export function AgronomyEntryPanel() {
  const t = useTranslations("terminal")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const userRole = session?.user?.role
  const canEdit = userRole === "admin" || userRole === "manager"
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode)
  const queryClient = useQueryClient()

  const { data: companies } = useQuery({
    queryKey: ["agro-entry-companies", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch("/api/companies", {
        headers: { "x-organization-id": orgId ?? "" },
      })
      if (!res.ok) return []
      const body = await res.json()
      return Array.isArray(body) ? body : (body.rows ?? body.companies ?? [])
    },
  })
  const activeCompany = useMemo(
    () => (companies ?? []).find((c: any) => c.code === activeCompanyCode),
    [companies, activeCompanyCode],
  )

  const [metric, setMetric] = useState<MetricKey>("yield_per_ha")
  const [value, setValue] = useState("")
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState("")
  const [warningsMode, setWarningsMode] = useState<"first" | "confirm">("first")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<string[] | null>(null)

  const selectedMetric = AGRO_METRICS.find((m) => m.key === metric)!

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!activeCompany?.id) throw new Error(t("agronomyEntry.errSelectCompany"))
      const numericValue = Number(value)
      if (!Number.isFinite(numericValue)) throw new Error(t("agronomyEntry.errValueNotFinite"))
      const iso = `${dateStr}T00:00:00.000Z`
      const res = await fetch("/api/operational-facts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: activeCompany.id,
          metric,
          date: iso,
          value: numericValue,
          unit: selectedMetric.unit,
          sourceNote: note.trim() ? note.trim() : undefined,
          forceConfirm: warningsMode === "confirm",
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Wrap typical 400 envelope shapes into a single error string.
        const errMsg =
          body?.error ??
          body?.errors?.[0] ??
          body?.warnings?.[0] ??
          `HTTP ${res.status}`
        throw new Error(errMsg)
      }
      // 200 with `requiresConfirm` means soft-bound warning — surface
      // to user and let them tap "Save anyway".
      if (body?.requiresConfirm) {
        return { needsConfirm: true, warnings: body.warnings ?? [], body }
      }
      return { needsConfirm: false, body }
    },
    onSuccess: (result) => {
      if (result.needsConfirm) {
        setWarnings(result.warnings)
        setWarningsMode("confirm")
        setErrorMsg(null)
        return
      }
      setSavedAt(Date.now())
      setErrorMsg(null)
      setWarnings(null)
      setWarningsMode("first")
      setValue("")
      setNote("")
      // Refresh the agro dashboard widget if it's open.
      queryClient.invalidateQueries({ queryKey: ["agro-facts"] })
    },
    onError: (err: Error) => {
      setErrorMsg(err.message)
    },
  })

  if (!activeCompanyCode) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        {t("agronomyEntry.emptyState")}
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-2 px-1">
        <Sprout className="h-4 w-4 text-emerald-500" />
        <h2 className="text-base font-bold">{t("agronomyEntry.title")}</h2>
        <Badge variant="outline" className="text-[10px] ml-2">
          {activeCompany?.code ?? activeCompanyCode}
        </Badge>
        {!canEdit && (
          <Badge variant="secondary" className="text-[10px]">
            {t("agronomyEntry.readOnlyBadge")}
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="agro-metric">{t("agronomyEntry.metricLabel")}</Label>
            <select
              id="agro-metric"
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value as MetricKey)
                setWarnings(null)
                setWarningsMode("first")
              }}
              disabled={!canEdit}
            >
              {AGRO_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {t(`agronomyEntry.${m.labelKey}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="agro-value">{t("agronomyEntry.valueLabel")}</Label>
              <Input
                id="agro-value"
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                disabled={!canEdit}
              />
              <div className="text-[10px] text-gray-500">{selectedMetric.unit}</div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="agro-date">{t("agronomyEntry.dateLabel")}</Label>
              <Input
                id="agro-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="agro-note">{t("agronomyEntry.noteLabel")}</Label>
            <Input
              id="agro-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder={t("agronomyEntry.notePlaceholder")}
              disabled={!canEdit}
            />
            <div className="text-[10px] text-gray-500 text-right">{note.length}/500</div>
          </div>

          {warnings && warnings.length > 0 && (
            <div className="rounded border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <div className="font-semibold">{t("agronomyEntry.softWarningsHeading")}</div>
              <ul className="list-disc pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <div className="text-[10px] mt-1">
                {t("agronomyEntry.softWarningsHint", {
                  action: t("agronomyEntry.saveAnyway"),
                })}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {savedAt && !errorMsg && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="h-3 w-3" /> {t("agronomyEntry.saved")}
            </div>
          )}

          {canEdit && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending || !value.trim()}
                className="flex-1"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-2" />
                ) : (
                  <Save className="h-3 w-3 mr-2" />
                )}
                {warningsMode === "confirm"
                  ? t("agronomyEntry.saveAnyway")
                  : t("agronomyEntry.saveEntry")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-[10px] text-gray-500 px-1">
        {t.rich("agronomyEntry.bulkTip", {
          code: () => (
            <code className="bg-muted px-1 rounded">/budgeting/admin/data-entry</code>
          ),
        })}
      </div>
    </div>
  )
}

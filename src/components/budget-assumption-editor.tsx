"use client"

/**
 * Phase 7.Q (2026-08-06) — create / edit / delete one budget assumption.
 *
 * The Fərziyyələr tab has been read-only since the model was created, and the
 * only writer was `POST /api/budgeting/assumptions` with no caller. The empty
 * state pointed at AI Auto Import, which does not classify an assumptions sheet
 * and therefore could never fill the tab — so the tab stayed empty and the
 * button that promised to fill it was untrue.
 *
 * Scope is the load-bearing field here, not the number. A row with no company
 * is the PLAN-LEVEL DEFAULT for every company in the plan; picking a company
 * makes it that company's OVERRIDE. See `assumption-resolver.ts` for the
 * precedence this form writes into.
 */

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Trash2, Loader2 } from "lucide-react"
import { CATEGORY_META } from "@/lib/budgeting/assumption-categories"
import { ASSUMPTION_PERIODS } from "@/lib/budgeting/assumption-input"

/** One row as the tab holds it — mirrors the API response, kept narrow. */
export interface EditableAssumption {
  id: string
  category: string
  key: string
  label: string
  value: number
  unit: string | null
  period: string | null
  notes: string | null
  sortOrder: number
  companyId: string | null
}

/** `/api/companies` returns a tree; the picker wants a flat list. */
interface CompanyNode {
  id: string
  name: string
  code?: string | null
  children?: CompanyNode[]
}

/**
 * Depth-first flatten, preserving tree order and carrying depth so the option
 * label can be indented. A holding of ~60 companies is three levels deep and a
 * flat alphabetical list makes siblings impossible to find.
 */
function flattenCompanies(nodes: CompanyNode[], depth = 0): Array<CompanyNode & { depth: number }> {
  const out: Array<CompanyNode & { depth: number }> = []
  for (const n of nodes) {
    out.push({ ...n, depth })
    if (n.children?.length) out.push(...flattenCompanies(n.children, depth + 1))
  }
  return out
}

interface FormState {
  category: string
  key: string
  label: string
  value: string
  unit: string
  period: string
  companyId: string
  notes: string
}

const BLANK: FormState = {
  category: "operations",
  key: "",
  label: "",
  value: "",
  unit: "",
  period: "annual",
  companyId: "",
  notes: "",
}

function toForm(row: EditableAssumption): FormState {
  return {
    category: row.category,
    key: row.key,
    label: row.label,
    // String, not number: an empty field must stay empty rather than becoming
    // 0, which is a meaningful driver value and must be typed deliberately.
    value: String(row.value),
    unit: row.unit ?? "",
    period: row.period ?? "",
    companyId: row.companyId ?? "",
    notes: row.notes ?? "",
  }
}

export function BudgetAssumptionEditor({
  planId,
  open,
  existing,
  onOpenChange,
  onSaved,
}: {
  planId: string
  open: boolean
  /** `null` opens the form in create mode. */
  existing: EditableAssumption | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const t = useTranslations("budgeting")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId

  const [form, setForm] = useState<FormState>(BLANK)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset whenever the dialog opens, so a cancelled edit never bleeds into the
  // next one. Keyed on `open` as well as `existing` because reopening on the
  // SAME row after a cancel must also restore the stored values.
  useEffect(() => {
    if (!open) return
    setForm(existing ? toForm(existing) : BLANK)
    setError(null)
    setBusy(false)
  }, [open, existing])

  const { data: companyTree } = useQuery<CompanyNode[]>({
    queryKey: ["companies", "assumption-editor"],
    queryFn: async () => {
      const res = await fetch("/api/companies", { headers: { "x-organization-id": orgId || "" } })
      if (!res.ok) return []
      return res.json()
    },
    enabled: open && !!orgId,
  })

  const companies = useMemo(
    () => flattenCompanies(Array.isArray(companyTree) ? companyTree : []),
    [companyTree],
  )

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    setError(null)
    const trimmedKey = form.key.trim()
    if (!trimmedKey) {
      setError(t("assumptionErrorKeyRequired"))
      return
    }
    // Validated here as well as on the server: the server is the boundary that
    // matters, but a round-trip to be told "not a number" is a worse form.
    if (form.value.trim() === "" || !Number.isFinite(Number(form.value))) {
      setError(t("assumptionErrorValueNumber"))
      return
    }

    const payload = {
      category: form.category,
      key: trimmedKey,
      label: form.label.trim() || trimmedKey,
      value: Number(form.value),
      unit: form.unit.trim() || null,
      period: form.period || null,
      companyId: form.companyId || null,
      notes: form.notes.trim() || null,
    }

    setBusy(true)
    try {
      const res = existing
        ? await fetch(`/api/budgeting/assumptions/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-organization-id": orgId || "" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/budgeting/assumptions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-organization-id": orgId || "" },
            body: JSON.stringify({ ...payload, planId }),
          })
      if (!res.ok) {
        // Surface the server's own words — a 423 says which period is locked
        // and a 404 says which company was not found, and both are actionable.
        const body = await res.json().catch(() => null)
        setError(body?.error ?? t("assumptionErrorSaveFailed", { status: res.status }))
        return
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!existing) return
    if (!window.confirm(t("assumptionDeleteConfirm", { label: existing.label }))) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/budgeting/assumptions/${existing.id}`, {
        method: "DELETE",
        headers: { "x-organization-id": orgId || "" },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? t("assumptionErrorSaveFailed", { status: res.status }))
        return
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="assumption-editor">
        <DialogHeader>
          <DialogTitle>{existing ? t("assumptionEditTitle") : t("assumptionAddTitle")}</DialogTitle>
          <DialogDescription>{t("assumptionEditorDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t("assumptionFieldCategory")}
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {Object.keys(CATEGORY_META).map((code) => (
                <option key={code} value={code}>
                  {CATEGORY_META[code].icon} {CATEGORY_META[code].label}
                </option>
              ))}
            </Select>
            <Select
              label={t("assumptionFieldPeriod")}
              value={form.period}
              onChange={(e) => set("period", e.target.value)}
            >
              <option value="">—</option>
              {ASSUMPTION_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`assumptionPeriod.${p}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">{t("assumptionFieldKey")}</label>
            <Input
              data-testid="assumption-field-key"
              value={form.key}
              onChange={(e) => set("key", e.target.value)}
              placeholder="import_share"
            />
            {/* The key, not the label, is what a formula or scenario looks up. */}
            <p className="text-[10px] text-muted-foreground">{t("assumptionFieldKeyHint")}</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">{t("assumptionFieldLabel")}</label>
            <Input
              data-testid="assumption-field-label"
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder={form.key || t("assumptionFieldLabelPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("assumptionFieldValue")}</label>
              <Input
                data-testid="assumption-field-value"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                inputMode="decimal"
                placeholder="0.7"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("assumptionFieldUnit")}</label>
              <Input
                data-testid="assumption-field-unit"
                value={form.unit}
                onChange={(e) => set("unit", e.target.value)}
                placeholder="%, AZN, ton"
              />
            </div>
          </div>

          <Select
            data-testid="assumption-field-scope"
            label={t("assumptionFieldScope")}
            value={form.companyId}
            onChange={(e) => set("companyId", e.target.value)}
          >
            <option value="">{t("assumptionScopePlanDefault")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {" ".repeat(c.depth * 3)}
                {c.name}
                {c.code ? ` (${c.code})` : ""}
              </option>
            ))}
          </Select>
          <p className="text-[10px] text-muted-foreground -mt-2">
            {form.companyId ? t("assumptionScopeCompanyHint") : t("assumptionScopePlanHint")}
          </p>

          <div className="space-y-1">
            <label className="text-sm font-medium">{t("fieldNotes")}</label>
            <Input
              data-testid="assumption-field-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={t("assumptionFieldNotesPlaceholder")}
            />
            {/* Why this number, not what it is. The reason is the part a board
                question actually asks for, and nothing else in the product
                records it. */}
            <p className="text-[10px] text-muted-foreground">{t("assumptionFieldNotesHint")}</p>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          {existing && (
            <Button variant="ghost" onClick={remove} disabled={busy} className="mr-auto text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4 mr-1" /> {t("assumptionDelete")}
            </Button>
          )}
          <Button variant="outline" data-testid="assumption-cancel" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("btnCancel")}
          </Button>
          <Button data-testid="assumption-save" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t("btnSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

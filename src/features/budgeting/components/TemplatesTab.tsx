// TemplatesTab — extracted from `src/app/(dashboard)/budgeting/page.tsx`
// Turn LXXXX (Phase 3.1 cleanup batch slice 2; TemplatesTab ~165 LOC).
// Pure refactor — zero functional change. Manages BudgetDirectionTemplate
// CRUD inside the "config" tab.
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Plus, CheckCircle, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InfoHint } from "@/components/info-hint"
import {
  useBudgetTemplates, useCreateBudgetTemplate, useUpdateBudgetTemplate,
  useDeleteBudgetTemplate,
} from "@/lib/budgeting/hooks"
import { type BudgetDirectionTemplate } from "@/lib/budgeting/types"
import { DataBoundary } from "@/components/ui/data-boundary"

// Local fmt — duplicated from page.tsx::fmt (CARRYOVER M6 dedup deferred).
function fmt(n: number): string {
  return Math.round(n).toLocaleString() + " ₼"
}

export function TemplatesTab() {
  const t = useTranslations("budgeting")
  const { data: templates = [], isLoading } = useBudgetTemplates()
  const createTemplate = useCreateBudgetTemplate()
  const updateTemplate = useUpdateBudgetTemplate()
  const deleteTemplate = useDeleteBudgetTemplate()

  const [adding, setAdding] = useState(false)
  const [newTpl, setNewTpl] = useState({ name: "", lineType: "expense" as "revenue" | "expense" | "cogs", lineSubtype: "service", defaultAmount: "" })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!newTpl.name) return
    await createTemplate.mutateAsync({
      name: newTpl.name,
      lineType: newTpl.lineType,
      lineSubtype: newTpl.lineSubtype,
      defaultAmount: Number(newTpl.defaultAmount) || 0,
    })
    setNewTpl({ name: "", lineType: "expense", lineSubtype: "service", defaultAmount: "" })
    setAdding(false)
  }

  const toggleActive = async (tpl: BudgetDirectionTemplate) => {
    await updateTemplate.mutateAsync({ id: tpl.id, isActive: !tpl.isActive })
  }

  const handleDelete = async (id: string) => {
    await deleteTemplate.mutateAsync(id)
    setConfirmDelete(null)
  }

  if (isLoading) return <DataBoundary loading>{null}</DataBoundary>

  const subtypeLabel = (s: string | null | undefined) => {
    if (s === "service") return t("subtypeService")
    if (s === "product") return t("subtypeProduct")
    if (s === "cogs") return t("subtypeCogs")
    return s || "—"
  }

  const typeLabel = (lt: string) => {
    if (lt === "revenue") return t("revenue")
    if (lt === "cogs") return "COGS"
    return t("expense")
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("templatesTitle")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{t("templatesDescription")}</p>
            </div>
            {!adding && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("btnAddTemplate")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1a3050] border-b-2 border-white/10">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90"><span className="inline-flex items-center gap-1.5">{t("templateName")} <InfoHint text={t("hintTemplateName")} size={12} /></span></th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("templateType")}</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70">{t("templateSubtype")}</th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300">{t("templateAmount")}</th>
                  <th className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-white/70"><span className="inline-flex items-center gap-1.5 justify-center">{t("templateActive")} <InfoHint text={t("hintTemplateActive")} size={12} /></span></th>
                  <th className="px-2 py-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {adding && (
                  <tr className="border-b border-border/50 bg-green-50 dark:bg-green-900/10">
                    <td className="px-2 py-1">
                      <Input className="h-7 text-xs" placeholder={t("templateName")} value={newTpl.name}
                        onChange={e => setNewTpl(d => ({ ...d, name: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && handleAdd()} autoFocus />
                    </td>
                    <td className="px-2 py-1">
                      <select value={newTpl.lineType} onChange={e => setNewTpl(d => ({ ...d, lineType: e.target.value as "revenue" | "expense" | "cogs" }))}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs">
                        <option value="expense">{t("expense")}</option>
                        <option value="revenue">{t("revenue")}</option>
                        <option value="cogs">COGS</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select value={newTpl.lineSubtype} onChange={e => setNewTpl(d => ({ ...d, lineSubtype: e.target.value }))}
                        className="h-7 w-full rounded-md border border-input bg-background px-1 text-xs">
                        <option value="service">{t("subtypeService")}</option>
                        <option value="product">{t("subtypeProduct")}</option>
                        <option value="cogs">{t("subtypeCogs")}</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <Input type="number" className="h-7 text-xs text-right" placeholder="0" value={newTpl.defaultAmount}
                        onChange={e => setNewTpl(d => ({ ...d, defaultAmount: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && handleAdd()} />
                    </td>
                    <td />
                    <td className="px-2 py-1 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleAdd} disabled={createTemplate.isPending}>
                          {createTemplate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>{t("btnCancel")}</Button>
                      </div>
                    </td>
                  </tr>
                )}
                {templates.map((tpl: BudgetDirectionTemplate) => (
                  <tr key={tpl.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-1.5 text-xs font-medium">{tpl.name}</td>
                    <td className="px-2 py-1.5 text-xs">
                      <Badge variant="outline" className="text-[10px]">{typeLabel(tpl.lineType)}</Badge>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{subtypeLabel(tpl.lineSubtype)}</td>
                    <td className="px-2 py-1.5 text-xs text-right font-mono">{fmt(tpl.defaultAmount)}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => toggleActive(tpl)} className={`inline-block w-8 h-4 rounded-full transition-colors ${tpl.isActive ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                        <span className={`block w-3 h-3 rounded-full bg-white transition-transform mx-0.5 ${tpl.isActive ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {confirmDelete === tpl.id ? (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="destructive" className="h-6 text-[10px] px-2" onClick={() => handleDelete(tpl.id)}>
                            {deleteTemplate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Trash2 className="h-3 w-3 mr-0.5" /> {t("btnOk")}</>}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setConfirmDelete(null)}>{t("btnCancel")}</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setConfirmDelete(tpl.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {templates.length === 0 && !adding && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground text-xs">{t("emptyNoLines")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

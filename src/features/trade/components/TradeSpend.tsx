"use client";

// Phase 9.6 — spend ledger: Plan/Accrued/Actual/Control summary per
// spend type, manual posting form, recent entries with void.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ReceiptText } from "lucide-react";

interface SpendType {
  id: string;
  key: string;
  label: string;
  accrualMethod: string;
}

interface Entry {
  id: string;
  entryKind: "plan" | "accrued" | "actual";
  entryDate: string;
  amount: number;
  sourceDocument: string | null;
  spendType: SpendType;
}

interface Summary {
  byType: {
    spendTypeId: string;
    label: string;
    plan: number;
    accrued: number;
    actual: number;
    control: number;
  }[];
  totals: { plan: number; accrued: number; actual: number; control: number };
}

const fmt = (n: number) => n.toLocaleString("az-AZ", { maximumFractionDigits: 0 });

const EMPTY_FORM = { entryKind: "actual", spendTypeId: "", entryDate: "", amount: "", note: "" };

export function TradeSpend() {
  const t = useTranslations("trade.spend");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [types, setTypes] = useState<SpendType[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [spend, overview] = await Promise.all([
        fetch("/api/trade/spend").then((r) => r.json()),
        fetch("/api/trade/overview").then((r) => r.json()),
      ]);
      setEntries(spend.entries as Entry[]);
      setSummary(spend.summary as Summary);
      setTypes((overview.spendTypes as SpendType[]).filter((s: SpendType & { isActive?: boolean }) => s.isActive !== false));
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trade/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryKind: form.entryKind,
          spendTypeId: form.spendTypeId,
          entryDate: form.entryDate,
          amount: Number(form.amount),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(String(data.error ?? res.status));
        return;
      }
      setForm(EMPTY_FORM);
      void load();
    } finally {
      setBusy(false);
    }
  }, [form, load]);

  const voidEntry = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/trade/spend/${id}/void`, { method: "POST" });
        void load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ReceiptText className="h-4 w-4" /> {t("title")}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("hint")}</p>

      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["plan", "accrued", "actual", "control"] as const).map((k) => (
            <div key={k} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{t(`totals.${k}`)}</div>
              <div className="font-semibold tabular-nums">{fmt(summary.totals[k])} AZN</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-3">
        <label className="flex flex-col gap-1 text-xs">
          {t("fieldKind")}
          <select
            value={form.entryKind}
            onChange={(e) => setForm({ ...form, entryKind: e.target.value })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="plan">{t("kind.plan")}</option>
            <option value="accrued">{t("kind.accrued")}</option>
            <option value="actual">{t("kind.actual")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("fieldType")}
          <select
            value={form.spendTypeId}
            onChange={(e) => setForm({ ...form, spendTypeId: e.target.value })}
            className="min-w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {types.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("fieldDate")}
          <input
            type="date"
            value={form.entryDate}
            onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {t("fieldAmount")}
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs">
          {t("fieldNote")}
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={busy || !form.spendTypeId || !form.entryDate || !form.amount}
          onClick={() => void post()}
          className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? t("busy") : t("add")}
        </button>
      </div>

      {summary && summary.byType.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">{t("colType")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("totals.plan")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("totals.accrued")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("totals.actual")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("totals.control")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.byType.map((r) => (
                <tr key={r.spendTypeId} className="border-b last:border-0">
                  <td className="py-1 pr-3">{r.label}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(r.plan)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(r.accrued)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(r.actual)}</td>
                  <td className="py-1 pr-3 text-right font-medium tabular-nums">{fmt(r.control)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries && entries.length > 0 && (
        <ul className="space-y-1">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {e.entryDate.slice(0, 10)} · {t(`kind.${e.entryKind}`)} · {e.spendType.label}
                {e.sourceDocument && <span className="text-muted-foreground"> · {e.sourceDocument}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums font-medium">{fmt(e.amount)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void voidEntry(e.id)}
                  className="rounded border px-1.5 py-0.5 text-[10px] text-destructive disabled:opacity-50"
                >
                  {t("void")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

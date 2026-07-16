"use client";

// Phase 9.3 — monthly trade budget pools: derive from the revenue plan,
// tune % or override the amount per month. ASSUMPTION A3: budget = % of
// sales plan (default 5%) — editable, pending Mars Overseas confirmation.

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Wallet } from "lucide-react";
import { formatApiError } from "../lib/status-error";
import { SkeletonBlock } from "./SkeletonBlock";

interface Pool {
  id: string;
  month: number;
  salesPlanAmount: number;
  budgetPct: number;
  budgetAmount: number;
  isManualAmount: boolean;
  currencyCode: string;
}

const fmt = (n: number) => n.toLocaleString("az-AZ", { maximumFractionDigits: 0 });

export function TradeBudget() {
  const t = useTranslations("trade.budget");
  const tErr = useTranslations("trade.errors");
  const locale = useLocale();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [defaultPct, setDefaultPct] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; field: "pct" | "amount"; value: string } | null>(null);
  // T9 — channel split editor state (current month by default).
  const [splitMonth, setSplitMonth] = useState(now.getUTCMonth() + 1);
  const [showSplit, setShowSplit] = useState(false);
  const [channels, setChannelsList] = useState<{ id: string; name: string }[]>([]);
  const [split, setSplit] = useState<Record<string, string>>({});
  const [splitInfo, setSplitInfo] = useState<{ orgBudget: number; allocated: number; unallocated: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trade/budget?year=${year}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setPools(data.pools as Pool[]);
    } catch {
      setError(t("loadFailed"));
    }
  }, [year, t, setPools, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSplit = useCallback(async () => {
    try {
      const [alloc, overview] = await Promise.all([
        fetch(`/api/trade/budget/allocations?year=${year}&month=${splitMonth}`).then((r) => r.json()),
        fetch("/api/trade/overview").then((r) => r.json()),
      ]);
      setChannelsList((overview.channels ?? []) as { id: string; name: string }[]);
      const next: Record<string, string> = {};
      for (const p of alloc.pools ?? []) {
        const channelId = String(p.grainKey).replace("channel:", "");
        next[channelId] = String(p.budgetPct);
      }
      setSplit(next);
      setSplitInfo({ orgBudget: alloc.orgBudget, allocated: alloc.allocated, unallocated: alloc.unallocated });
    } catch {
      setSplitInfo(null);
    }
  }, [year, splitMonth]);

  useEffect(() => {
    if (showSplit) void loadSplit();
  }, [showSplit, loadSplit]);

  const saveSplit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const allocations = Object.entries(split)
        .map(([channelId, pct]) => ({ channelId, allocationPct: Number(pct) || 0 }))
        .filter((a) => a.allocationPct > 0);
      const res = await fetch("/api/trade/budget/allocations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month: splitMonth, allocations }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(formatApiError(tErr, res.status, data.error ? String(data.error) : null));
        return;
      }
      void loadSplit();
    } finally {
      setBusy(false);
    }
  }, [split, year, splitMonth, loadSplit]);

  const derive = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trade/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, defaultPct: Number(defaultPct) || 5 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(formatApiError(tErr, res.status, data.error ? String(data.error) : null));
        return;
      }
      setPools(data.pools as Pool[]);
    } finally {
      setBusy(false);
    }
  }, [year, defaultPct]);

  const savePatch = useCallback(
    async (id: string, patch: { budgetPct?: number; budgetAmount?: number }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/trade/budget/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(formatApiError(tErr, res.status, data.error ? String(data.error) : null));
          return;
        }
        void load();
      } finally {
        setBusy(false);
        setEdit(null);
      }
    },
    [load],
  );

  const commitEdit = () => {
    if (!edit) return;
    const value = Number(edit.value);
    if (!Number.isFinite(value) || value < 0) {
      setEdit(null);
      return;
    }
    void savePatch(edit.id, edit.field === "pct" ? { budgetPct: value } : { budgetAmount: value });
  };

  const totals = pools?.reduce(
    (acc, p) => ({ sales: acc.sales + p.salesPlanAmount, budget: acc.budget + p.budgetAmount }),
    { sales: 0, budget: 0 },
  );

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="h-4 w-4" /> {t("title")}
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <a
            href={`/api/trade/budget/export?year=${year}&lang=${locale}`}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          >
            <Download className="h-3 w-3" /> XLSX
          </a>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {[year - 1, year, year + 1]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            {t("defaultPct")}
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={defaultPct}
              onChange={(e) => setDefaultPct(e.target.value)}
              className="w-16 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void derive()}
            className="rounded-md border bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
          >
            {busy ? t("busy") : t("derive")}
          </button>
          <button
            type="button"
            onClick={() => setShowSplit((v) => !v)}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            {t("split.toggle")}
          </button>
        </div>
      </div>

      {showSplit && (
        <div className="mb-4 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">{t("split.title")}</span>
            <select
              value={splitMonth}
              onChange={(e) => setSplitMonth(Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
            {splitInfo && (
              <span className="text-muted-foreground">
                {t("split.orgBudget")}: <span className="font-medium tabular-nums">{fmt(splitInfo.orgBudget)}</span> ·{" "}
                {t("split.allocated")}: <span className="font-medium tabular-nums">{fmt(splitInfo.allocated)}</span> ·{" "}
                {t("split.unallocated")}:{" "}
                <span className={`font-medium tabular-nums ${splitInfo.unallocated < 0 ? "text-rose-600" : ""}`}>
                  {fmt(splitInfo.unallocated)}
                </span>
              </span>
            )}
          </div>
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("split.noChannels")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {channels.map((c) => (
                <label key={c.id} className="flex flex-col gap-1 text-xs">
                  {c.name}
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={split[c.id] ?? ""}
                      onChange={(e) => setSplit({ ...split, [c.id]: e.target.value })}
                      className="w-20 rounded-md border bg-background px-2 py-1 text-right text-sm"
                    />
                    %
                  </span>
                </label>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveSplit()}
                className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                {busy ? t("busy") : t("split.save")}
              </button>
            </div>
          )}
        </div>
      )}
      <p className="mb-3 text-xs text-muted-foreground">{t("hint")}</p>

      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}

      {pools === null ? (
        <SkeletonBlock lines={5} />
      ) : pools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{t("colMonth")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("colSalesPlan")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">%</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("colBudget")}</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{String(p.month).padStart(2, "0")}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(p.salesPlanAmount)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {edit?.id === p.id && edit.field === "pct" ? (
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        defaultValue={p.budgetPct}
                        onChange={(e) => setEdit({ id: p.id, field: "pct", value: e.target.value })}
                        onBlur={commitEdit}
                        onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                        className="w-16 rounded-md border bg-background px-1 py-0.5 text-right"
                      />
                    ) : (
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-2"
                        onClick={() => setEdit({ id: p.id, field: "pct", value: String(p.budgetPct) })}
                        title={t("editPct")}
                      >
                        {p.budgetPct}%
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {edit?.id === p.id && edit.field === "amount" ? (
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        defaultValue={p.budgetAmount}
                        onChange={(e) => setEdit({ id: p.id, field: "amount", value: e.target.value })}
                        onBlur={commitEdit}
                        onKeyDown={(e) => e.key === "Enter" && commitEdit()}
                        className="w-28 rounded-md border bg-background px-1 py-0.5 text-right"
                      />
                    ) : (
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-2"
                        onClick={() =>
                          setEdit({ id: p.id, field: "amount", value: String(p.budgetAmount) })
                        }
                        title={t("editAmount")}
                      >
                        {fmt(p.budgetAmount)}
                        {p.isManualAmount && <span className="ml-1 text-[10px] text-amber-600">✎</span>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {totals && (
                <tr className="font-semibold">
                  <td className="py-1.5 pr-3">{t("total")}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(totals.sales)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {totals.sales > 0 ? `${Math.round((totals.budget / totals.sales) * 1000) / 10}%` : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(totals.budget)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

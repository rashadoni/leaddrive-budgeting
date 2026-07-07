"use client";

// Phase 9.4 — Trade campaign cards: list + create draft + submit for
// approval. Reviewer decisions happen in the existing Approvals admin
// (ApprovalRequestsAdmin) via requestType=trade_campaign_activate.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Megaphone, Plus } from "lucide-react";
import { SkeletonBlock } from "./SkeletonBlock";
import { TradeCalendar } from "./TradeCalendar";

interface CampaignScope {
  id: string;
  scopeType: string;
  scopeId: string | null;
  scopeValue: string | null;
  include: boolean;
}

interface Campaign {
  id: string;
  code: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: string;
  plannedBudgetAmount: number;
  expectedSalesUpliftAmount: number | null;
  expectedSalesUpliftPct: number | null;
  currencyCode: string;
  scopes: CampaignScope[];
  spend: { committed: number; accrued: number; actual: number; control: number; remaining: number };
}

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  paused: "bg-muted text-muted-foreground",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const EMPTY_FORM = {
  name: "",
  startDate: "",
  endDate: "",
  plannedBudgetAmount: "",
  expectedSalesUpliftPct: "",
  goal: "",
  scopeChannel: "",
  scopeBrand: "",
};

export function TradeCampaigns() {
  const t = useTranslations("trade.campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trade/campaigns");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCampaigns(data.campaigns as Campaign[]);
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCampaign = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const scopes: { scopeType: string; scopeValue: string }[] = [];
      if (form.scopeChannel.trim())
        scopes.push({ scopeType: "channel", scopeValue: form.scopeChannel.trim() });
      if (form.scopeBrand.trim())
        scopes.push({ scopeType: "brand", scopeValue: form.scopeBrand.trim() });
      const res = await fetch("/api/trade/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          plannedBudgetAmount: Number(form.plannedBudgetAmount || 0),
          ...(form.expectedSalesUpliftPct
            ? { expectedSalesUpliftPct: Number(form.expectedSalesUpliftPct) }
            : {}),
          ...(form.goal.trim() ? { goal: form.goal.trim() } : {}),
          scopes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(String(data.error ?? res.status));
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      void load();
    } finally {
      setBusy(false);
    }
  }, [form, load]);

  const act = useCallback(
    async (campaign: Campaign, action: "submit" | "delete") => {
      setBusy(true);
      setError(null);
      try {
        const res =
          action === "submit"
            ? await fetch(`/api/trade/campaigns/${campaign.id}/submit`, { method: "POST" })
            : await fetch(`/api/trade/campaigns/${campaign.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(String(data.error ?? res.status));
          return;
        }
        void load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const fmtDate = (iso: string) => iso.slice(0, 10);
  const fmtAmount = (n: number, cur: string) =>
    `${n.toLocaleString("az-AZ", { maximumFractionDigits: 0 })} ${cur}`;

  return (
    <>
    <TradeCalendar campaigns={campaigns} />
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4" /> {t("title")}
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
        >
          <Plus className="h-4 w-4" /> {t("newCampaign")}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {showForm && (
        <div className="mb-4 grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldName")}
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldStart")}
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldEnd")}
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldBudget")}
            <input
              type="number"
              min="0"
              value={form.plannedBudgetAmount}
              onChange={(e) => setForm({ ...form, plannedBudgetAmount: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldUpliftPct")}
            <input
              type="number"
              min="0"
              value={form.expectedSalesUpliftPct}
              onChange={(e) => setForm({ ...form, expectedSalesUpliftPct: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldChannel")}
            <input
              value={form.scopeChannel}
              onChange={(e) => setForm({ ...form, scopeChannel: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t("fieldBrand")}
            <input
              value={form.scopeBrand}
              onChange={(e) => setForm({ ...form, scopeBrand: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            {t("fieldGoal")}
            <input
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={busy || !form.name || !form.startDate || !form.endDate}
              onClick={() => void createCampaign()}
              className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busy ? t("busy") : t("create")}
            </button>
          </div>
        </div>
      )}

      {campaigns === null ? (
        <SkeletonBlock lines={3} />
      ) : campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <div key={c.id} className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold" title={c.name}>
                  {c.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_CLASSES[c.status] ?? "bg-muted"}`}
                >
                  {t(`status.${c.status}`)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {c.code} · {fmtDate(c.startDate)} → {fmtDate(c.endDate)}
              </div>
              <div className="mt-2 text-sm font-medium tabular-nums">
                {fmtAmount(c.plannedBudgetAmount, c.currencyCode)}
                {c.expectedSalesUpliftPct != null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    +{c.expectedSalesUpliftPct}% {t("uplift")}
                  </span>
                )}
              </div>
              {c.plannedBudgetAmount > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>
                      {t("spent")}: <span className="font-medium tabular-nums">{fmtAmount(c.spend.control, c.currencyCode)}</span>
                    </span>
                    <span>
                      {c.spend.remaining >= 0 ? (
                        <>
                          {t("remaining")}: <span className="font-medium tabular-nums">{fmtAmount(c.spend.remaining, c.currencyCode)}</span>
                        </>
                      ) : (
                        <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">
                          {t("overBudget", { amount: fmtAmount(-c.spend.remaining, c.currencyCode) })}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-1.5 rounded-full ${c.spend.control > c.plannedBudgetAmount ? "bg-rose-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min((c.spend.control / c.plannedBudgetAmount) * 100, 100)}%` }}
                    />
                  </div>
                  {c.spend.committed > 0 && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {t("committed")}: <span className="tabular-nums">{fmtAmount(c.spend.committed, c.currencyCode)}</span>
                    </div>
                  )}
                </div>
              )}
              {c.goal && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.goal}</p>}
              {c.scopes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.scopes.map((s) => (
                    <span key={s.id} className="rounded-full border px-2 py-0.5 text-[10px]">
                      {t(`scope.${s.scopeType}`)}: {s.scopeValue ?? s.scopeId}
                    </span>
                  ))}
                </div>
              )}
              {(c.status === "draft" || c.status === "rejected") && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(c, "submit")}
                    className="rounded-md border bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                  >
                    {t("submit")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(c, "delete")}
                    className="rounded-md border px-2 py-1 text-xs text-destructive disabled:opacity-50"
                  >
                    {t("delete")}
                  </button>
                </div>
              )}
              {c.status === "pending_approval" && (
                <p className="mt-2 text-xs text-amber-700">{t("awaitingApproval")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
    </>
  );
}

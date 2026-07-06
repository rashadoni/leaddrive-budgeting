"use client";

// Phase 9.2 — Trade Spend Control Tower: master-data dashboard + import.
// Counts for the 5 dimensions + spend-type dictionary (with one-click
// default seed) + preview→apply xlsx import against
// /api/trade/master-import. Campaign/pacing panels arrive in 9.3–9.7.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload } from "lucide-react";

type MasterKind = "master_outlets" | "master_skus" | "master_reps";

interface Overview {
  counts: {
    regions: number;
    channels: number;
    reps: number;
    outlets: number;
    skus: number;
    spendTypes: number;
  };
  spendTypes: { id: string; key: string; label: string; accrualMethod: string; isActive: boolean }[];
  batches: {
    id: string;
    kind: string;
    sourceFile: string;
    status: string;
    rowCount: number;
    createdAt: string;
  }[];
}

interface PreviewResult {
  rowCount: number;
  sample: Record<string, string>[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  canApply: boolean;
}

interface ApplyResult {
  alreadyImported?: boolean;
  rowCount?: number;
  counts?: { created: number; updated: number };
}

export function TradeMasterData() {
  const t = useTranslations("trade");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [kind, setKind] = useState<MasterKind>("master_outlets");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/trade/overview");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Overview & { ok: boolean };
      setOverview(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const postImport = useCallback(
    async (mode: "preview" | "apply") => {
      if (!file) return;
      setBusy(true);
      setActionError(null);
      if (mode === "preview") {
        setPreview(null);
        setApplied(null);
      }
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("kind", kind);
        form.set("mode", mode);
        const res = await fetch("/api/trade/master-import", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok && !data.errors) {
          setActionError(String(data.error ?? res.status));
          return;
        }
        if (mode === "preview" || data.errors) {
          setPreview(data as PreviewResult);
        } else {
          setApplied(data as ApplyResult);
          setPreview(null);
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          void loadOverview();
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [file, kind, loadOverview],
  );

  const seedDefaults = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/trade/spend-types/seed", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(String(data.error ?? res.status));
        return;
      }
      void loadOverview();
    } finally {
      setBusy(false);
    }
  }, [loadOverview]);

  if (loadError) {
    return <p className="text-sm text-destructive">{t("loadFailed")}</p>;
  }

  const countCards: { key: keyof Overview["counts"]; label: string }[] = [
    { key: "regions", label: t("regions") },
    { key: "channels", label: t("channels") },
    { key: "reps", label: t("reps") },
    { key: "outlets", label: t("outlets") },
    { key: "skus", label: t("skus") },
    { key: "spendTypes", label: t("spendTypesTitle") },
  ];
  const sampleColumns = preview?.sample?.[0] ? Object.keys(preview.sample[0]) : [];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {countCards.map((c) => (
          <div key={c.key} className="rounded-lg border p-4">
            <div className="text-2xl font-semibold tabular-nums">
              {overview ? overview.counts[c.key] : "—"}
            </div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("spendTypesTitle")}</h2>
        {overview && overview.spendTypes.length === 0 ? (
          <button
            type="button"
            onClick={() => void seedDefaults()}
            disabled={busy}
            className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? t("busy") : t("seedDefaults")}
          </button>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {overview?.spendTypes.map((st) => (
              <li
                key={st.id}
                className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
              >
                <span>{st.label}</span>
                <span className="text-muted-foreground">{t(`accrual.${st.accrualMethod}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Upload className="h-4 w-4" /> {t("importTitle")}
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">{t("importHint")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as MasterKind);
              setPreview(null);
              setApplied(null);
            }}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="master_outlets">{t("kindOutlets")}</option>
            <option value="master_skus">{t("kindSkus")}</option>
            <option value="master_reps">{t("kindReps")}</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setApplied(null);
            }}
            className="text-sm"
            aria-label={t("chooseFile")}
          />
          <button
            type="button"
            onClick={() => void postImport("preview")}
            disabled={!file || busy}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("preview")}
          </button>
          {preview?.canApply && (
            <button
              type="button"
              onClick={() => void postImport("apply")}
              disabled={busy}
              className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {t("apply")}
            </button>
          )}
        </div>

        {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}

        {applied && (
          <p className="mt-3 text-sm text-emerald-600">
            {applied.alreadyImported
              ? t("alreadyImported")
              : t("applied", {
                  created: applied.counts?.created ?? 0,
                  updated: applied.counts?.updated ?? 0,
                })}
          </p>
        )}

        {preview && (
          <div className="mt-4 space-y-3">
            <p className="text-sm">{t("rowsParsed", { count: preview.rowCount })}</p>
            {preview.errors.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-3">
                <h3 className="mb-1 text-xs font-semibold text-destructive">{t("errorsTitle")}</h3>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      #{e.row}: {e.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">{t("applyBlocked")}</p>
              </div>
            )}
            {preview.sample.length > 0 && (
              <div className="overflow-x-auto">
                <h3 className="mb-1 text-xs font-semibold">
                  {t("sampleTitle", { count: preview.sample.length })}
                </h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      {sampleColumns.map((col) => (
                        <th key={col} className="py-1 pr-3 font-medium">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {sampleColumns.map((col) => (
                          <td key={col} className="py-1 pr-3">
                            {row[col] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {overview && overview.batches.length > 0 && (
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-semibold">{t("recentBatches")}</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">{t("batchKind")}</th>
                <th className="py-1 pr-3 font-medium">{t("batchFile")}</th>
                <th className="py-1 pr-3 font-medium">{t("batchStatus")}</th>
                <th className="py-1 pr-3 font-medium">{t("batchRows")}</th>
                <th className="py-1 pr-3 font-medium">{t("batchDate")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.batches.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="py-1 pr-3">{b.kind}</td>
                  <td className="py-1 pr-3">{b.sourceFile}</td>
                  <td className="py-1 pr-3">{b.status}</td>
                  <td className="py-1 pr-3 tabular-nums">{b.rowCount}</td>
                  <td className="py-1 pr-3">{new Date(b.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

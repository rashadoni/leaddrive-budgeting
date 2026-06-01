"use client";

/**
 * Phase 7.N — ScenarioFormModal
 *
 * Create or edit a scenario. Wraps the Bloomberg-style CRUD API:
 *   POST   /api/scenarios          — create (admin-only)
 *   PATCH  /api/scenarios/[id]     — update (admin-only)
 *
 * The overrides block is edited as a JSON textarea — this surfaces the
 * adjustments[] format directly so power users can craft precise shocks
 * without deploying seed-scenarios.ts. A compact schema hint is shown
 * below the textarea so the user knows the expected shape.
 *
 * Fields:
 *   code       – UPPERCASE_SNAKE (read-only on edit)
 *   nameEn     – English display name
 *   nameRu     – Russian display name (optional)
 *   description – freeform prose
 *   overrides  – JSON (adjustments[])
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Save, AlertCircle, CheckCircle } from "lucide-react";
import { hasShock } from "@/lib/risk/scenario-shock";

// ─── Friendly editor metadata ──────────────────────────────────────────────────
// Maps a live-feed metric → a human label key + display unit, so a non-technical
// user edits "Brent target ($/bbl): 120" instead of raw JSON. Unknown metrics
// fall back to showing the raw metric key with no unit.
const METRIC_META: Record<string, { labelKey: string; unit: string }> = {
  AZN_USD: { labelKey: "metricAznUsd", unit: "AZN/USD" },
  BRENT_USD_BBL: { labelKey: "metricBrent", unit: "$/bbl" },
  FAO_SUGAR_INDEX: { labelKey: "metricFaoSugar", unit: "index" },
};

// Shock transmission paths → plain-language label keys.
const DRIVES = ["inputCostShock", "fxShock", "priceShock"] as const;
const DRIVE_LABEL_KEY: Record<(typeof DRIVES)[number], string> = {
  inputCostShock: "driveInputCost",
  fxShock: "driveFx",
  priceShock: "drivePrice",
};

// Direct P&L levers (fractions, shown as %) → plain-language label keys. These
// are the `shock.*` keys used by lever-style scenarios (e.g. PRICE_DROP_40 →
// { shock: { priceShock: -0.4 } }) that carry no `target`.
const SHOCK_LEVERS = ["revenueShock", "priceShock", "inputCostShock", "fxShock", "yieldShock"] as const;
const LEVER_LABEL_KEY: Record<(typeof SHOCK_LEVERS)[number], string> = {
  revenueShock: "leverRevenue",
  priceShock: "leverPrice",
  inputCostShock: "leverInputCost",
  fxShock: "leverFx",
  yieldShock: "leverYield",
};
// Round a fraction↔percent conversion cleanly (avoids -0.4*100 = -40.0000001).
const toPct = (frac: number) => Number((frac * 100).toFixed(2));
const fromPct = (pct: number) => Number((pct / 100).toFixed(4));

// Shared dark input styling for the friendly editor.
const NUM_INPUT =
  "w-28 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-sm font-mono text-right text-gray-100 focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50";
const SELECT_INPUT =
  "rounded border border-white/10 bg-[#0E1430] px-2 py-1 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioFormValues {
  id?: string;
  code: string;
  nameEn: string;
  nameRu: string;
  description: string;
  overrides: string; // JSON string
}

interface Props {
  /** Pass undefined to create; pass the scenario object to edit. */
  initial?: ScenarioFormValues;
  onClose: () => void;
  onSaved: (scenario: { id: string; code: string; nameEn: string }) => void;
}

// ─── Default overrides template shown on create ───────────────────────────────

const OVERRIDES_TEMPLATE = JSON.stringify(
  {
    adjustments: [
      {
        codes: ["INDICATOR_CODE"],
        multiply: 0.8,
        note: "brief explanation",
      },
    ],
  },
  null,
  2,
);

// ─── Component ────────────────────────────────────────────────────────────────

export function ScenarioFormModal({ initial, onClose, onSaved }: Props) {
  const t = useTranslations("terminal");
  const isEdit = Boolean(initial?.id);

  const [code, setCode] = useState(initial?.code ?? "");
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? "");
  const [nameRu, setNameRu] = useState(initial?.nameRu ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [overridesJson, setOverridesJson] = useState(
    initial?.overrides ?? OVERRIDES_TEMPLATE,
  );

  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const validateJson = useCallback((text: string) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        setJsonError(t("scenarioForm.errJsonNoAdjustments"));
        return false;
      }
      // Accept EITHER the legacy multiplier format (`adjustments[]`) OR the
      // Phase-2 driver format (`shock{...}`). The crisis catalog scenarios
      // (BRENT_TO_140, AZN_DEVAL_*, DROUGHT_2026, …) all use `shock` — the
      // old validator only knew `adjustments`, so editing any of them silently
      // disabled Save (the "I can't change the price" bug, 2026-06-01).
      const adj = (parsed as { adjustments?: unknown }).adjustments;
      const okAdjustments = Array.isArray(adj) && adj.length > 0;
      const okShock = hasShock(parsed);
      if (!okAdjustments && !okShock) {
        setJsonError(t("scenarioForm.errJsonNoAdjustments"));
        return false;
      }
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError(t("scenarioForm.errJsonParse", { message: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }, [t]);

  // Friendly editor — parse the current JSON into a structured `shock` view so a
  // non-technical user edits labeled inputs instead of raw JSON. Covers BOTH a
  // feed-anchored `target` (Brent → $140) AND direct P&L levers (price -40%).
  // Hides automatically mid-edit (invalid JSON) and for legacy `adjustments[]`.
  const shockView = useMemo(() => {
    try {
      const parsed = JSON.parse(overridesJson) as {
        shock?: Record<string, unknown> & {
          target?: { metric?: unknown; value?: unknown; drives?: unknown };
        };
      };
      const s = parsed?.shock;
      if (!s || typeof s !== "object") return null;
      const tgt = s.target;
      const target =
        tgt &&
        typeof tgt.metric === "string" &&
        typeof tgt.value === "number" &&
        Number.isFinite(tgt.value) &&
        typeof tgt.drives === "string"
          ? { metric: tgt.metric, value: tgt.value, drives: tgt.drives }
          : null;
      const levers = SHOCK_LEVERS.filter(
        (k) => typeof s[k] === "number" && Number.isFinite(s[k] as number),
      ).map((k) => ({ key: k, value: s[k] as number }));
      const costRigidity = typeof s.costRigidity === "number" ? s.costRigidity : null;
      const assumedImportShare = typeof s.assumedImportShare === "number" ? s.assumedImportShare : null;
      if (!target && levers.length === 0 && costRigidity === null) return null;
      return { target, levers, costRigidity, assumedImportShare };
    } catch {
      /* mid-edit invalid JSON — friendly editor hides until valid again */
      return null;
    }
  }, [overridesJson]);

  // Mutate the parsed `shock` object and re-serialize into the JSON textarea
  // (the JSON stays the single source of truth; the friendly inputs are a view).
  const patchShock = useCallback(
    (mutate: (shock: Record<string, unknown>) => void) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(overridesJson) as Record<string, unknown>;
      } catch {
        return;
      }
      const shock = { ...((parsed.shock as Record<string, unknown>) ?? {}) };
      mutate(shock);
      parsed.shock = shock;
      const next = JSON.stringify(parsed, null, 2);
      setOverridesJson(next);
      validateJson(next);
    },
    [overridesJson, validateJson],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!code.trim() || !nameEn.trim()) {
      setError(t("scenarioForm.errCodeNameRequired"));
      return;
    }
    if (!/^[A-Z0-9_]+$/.test(code)) {
      setError(t("scenarioForm.errCodeFormat"));
      return;
    }
    if (!validateJson(overridesJson)) return;

    setSubmitting(true);
    try {
      const parsed = JSON.parse(overridesJson) as Record<string, unknown>;

      const url = isEdit
        ? `/api/scenarios/${initial!.id}`
        : "/api/scenarios";
      const method = isEdit ? "PATCH" : "POST";

      const body = isEdit
        ? {
            nameEn: nameEn.trim(),
            nameRu: nameRu.trim() || null,
            description: description.trim() || null,
            overrides: parsed,
          }
        : {
            code: code.trim(),
            nameEn: nameEn.trim(),
            nameRu: nameRu.trim() || undefined,
            description: description.trim() || undefined,
            overrides: parsed,
            isActive: true,
          };

      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 403) {
        setError(t("scenarioForm.errAdminRequired"));
        return;
      }
      if (res.status === 409) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? t("scenarioForm.errCodeExists"));
        return;
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; details?: unknown };
        setError(data.error ?? t("scenarioForm.errServer", { status: res.status }));
        return;
      }

      const saved = (await res.json()) as { id: string; code: string; nameEn: string };
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("scenarioForm.errNetwork"));
    } finally {
      setSubmitting(false);
    }
  }, [code, nameEn, nameRu, description, overridesJson, isEdit, initial, validateJson, onSaved, onClose, t]);

  // The raw-JSON editor (label + textarea + validity hint + codes help). Shared
  // between the bare layout (legacy scenarios) and the collapsed "Advanced"
  // layout (shock scenarios get the friendly editor above instead).
  const jsonInner = (
    <>
      <label className="block text-xs font-mono uppercase tracking-wider text-gray-400 mb-1">
        {t("scenarioForm.overridesLabel")}
      </label>
      <textarea
        value={overridesJson}
        onChange={(e) => {
          setOverridesJson(e.target.value);
          validateJson(e.target.value);
        }}
        rows={10}
        spellCheck={false}
        data-testid="overrides-json"
        className={`w-full rounded border ${jsonError ? "border-red-500/60" : "border-white/10"} bg-white/[0.03] px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50`}
      />
      {jsonError ? (
        <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
          <AlertCircle size={10} />
          {jsonError}
        </p>
      ) : (
        <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1">
          <CheckCircle size={10} className="text-emerald-500" />
          {t.rich("scenarioForm.structureValid", {
            m: (c) => <span className="font-mono">{c}</span>,
          })}
        </p>
      )}
      <details className="mt-2">
        <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-100">
          {t("scenarioForm.codesHelpSummary")}
        </summary>
        <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
          {t("scenarioForm.codesHelpPrefix")}{" "}
          <span className="font-mono text-[#FFB800]">AGRO_SUGAR_PRICE_TREND</span>,{" "}
          <span className="font-mono text-[#FFB800]">FX_IMPORTED_INPUT</span>,{" "}
          <span className="font-mono text-[#FFB800]">IND_EBITDA_MARGIN</span>,{" "}
          <span className="font-mono text-[#FFB800]">AGRO_YIELD</span>.{" "}
          {t("scenarioForm.codesHelpSuffix")}
        </p>
      </details>
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0A0E27] text-gray-200 shadow-2xl shadow-black/60 ring-1 ring-white/5">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-[#0E1430] to-[#0A0E27] px-6 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-50 font-mono">
            {isEdit ? t("scenarioForm.editTitle", { code: initial!.code }) : t("scenarioForm.createTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("scenarioForm.closeAria")}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Code — read-only on edit */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-gray-400 mb-1">
              {t("scenarioForm.codeLabel")}
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              readOnly={isEdit}
              placeholder={"SUGAR_DROP_20"}
              className={`w-full rounded border ${isEdit ? "border-white/10 bg-white/[0.05] text-gray-400 cursor-not-allowed" : "border-white/10 bg-white/[0.03]"} px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50`}
            />
            {!isEdit && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                {t("scenarioForm.codeHint")}
              </p>
            )}
          </div>

          {/* nameEn */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-gray-400 mb-1">
              {t("scenarioForm.nameEnLabel")}
            </label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder={"Sugar price drops 20%"}
              className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* nameRu */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-gray-400 mb-1">
              {t("scenarioForm.nameRuLabel")}
            </label>
            <input
              type="text"
              value={nameRu}
              onChange={(e) => setNameRu(e.target.value)}
              placeholder={t("scenarioForm.nameRuPlaceholder")}
              className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* description */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-gray-400 mb-1">
              {t("scenarioForm.descLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t("scenarioForm.descPlaceholder")}
              className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* Friendly shock editor — labeled inputs for shock scenarios so the
              numbers + effect are editable without raw JSON. Covers a feed-
              anchored target (Brent → $140) AND direct P&L levers (price −40%).
              Closes the "что за коды / can't change the price" feedback. */}
          {shockView && (
            <div
              className="rounded-md border border-[#FFB800]/30 bg-[#FFB800]/[0.06] p-3.5 space-y-3"
              data-testid="shock-editor"
            >
              <p className="text-xs font-mono uppercase tracking-wider text-[#FFB800]">
                {t("scenarioForm.shockEditorTitle")}
              </p>

              {/* Feed-anchored target (e.g. Brent → $140/bbl) */}
              {shockView.target && (
                <>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 flex-1" htmlFor="shock-value">
                      {METRIC_META[shockView.target.metric]
                        ? t(`scenarioForm.${METRIC_META[shockView.target.metric].labelKey}`)
                        : shockView.target.metric}
                    </label>
                    <input
                      id="shock-value"
                      type="number"
                      step="any"
                      value={shockView.target.value}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) patchShock((s) => { s.target = { ...(s.target as Record<string, unknown>), value: n }; });
                      }}
                      className={NUM_INPUT}
                      data-testid="shock-value-input"
                    />
                    <span className="text-xs text-gray-500 w-16">
                      {METRIC_META[shockView.target.metric]?.unit ?? ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 flex-1" htmlFor="shock-drives">
                      {t("scenarioForm.shockEffectLabel")}
                    </label>
                    <select
                      id="shock-drives"
                      value={shockView.target.drives}
                      onChange={(e) => patchShock((s) => { s.target = { ...(s.target as Record<string, unknown>), drives: e.target.value }; })}
                      className={SELECT_INPUT}
                      data-testid="shock-drives-select"
                    >
                      {DRIVES.map((d) => (
                        <option key={d} value={d}>
                          {t(`scenarioForm.${DRIVE_LABEL_KEY[d]}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Direct P&L levers (e.g. price −40%) — edited as a percentage */}
              {shockView.levers.map((lev) => (
                <div className="flex items-center gap-2" key={lev.key}>
                  <label className="text-xs text-gray-400 flex-1" htmlFor={`shock-lever-${lev.key}`}>
                    {t(`scenarioForm.${LEVER_LABEL_KEY[lev.key]}`)}
                  </label>
                  <input
                    id={`shock-lever-${lev.key}`}
                    type="number"
                    step="any"
                    value={toPct(lev.value)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patchShock((s) => { s[lev.key] = fromPct(n); });
                    }}
                    className={NUM_INPUT}
                    data-testid={`shock-lever-${lev.key}`}
                  />
                  <span className="text-xs text-gray-500 w-16">%</span>
                </div>
              ))}

              {/* Cost rigidity — share of costs already sunk (0–1) */}
              {shockView.costRigidity !== null && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 flex-1" htmlFor="shock-cost-rigidity">
                    {t("scenarioForm.costRigidityLabel")}
                  </label>
                  <input
                    id="shock-cost-rigidity"
                    type="number"
                    step="any"
                    min={0}
                    max={1}
                    value={shockView.costRigidity}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patchShock((s) => { s.costRigidity = n; });
                    }}
                    className={NUM_INPUT}
                    data-testid="shock-cost-rigidity"
                  />
                  <span className="text-xs text-gray-500 w-16">0–1</span>
                </div>
              )}

              {/* Imported-input share (0–1) */}
              {shockView.assumedImportShare !== null && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 flex-1" htmlFor="shock-import-share">
                    {t("scenarioForm.shockImportShareLabel")}
                  </label>
                  <input
                    id="shock-import-share"
                    type="number"
                    step="any"
                    min={0}
                    max={1}
                    value={shockView.assumedImportShare}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patchShock((s) => { s.assumedImportShare = n; });
                    }}
                    className={NUM_INPUT}
                    data-testid="shock-import-share"
                  />
                  <span className="text-xs text-gray-500 w-16">0–1</span>
                </div>
              )}

              <p className="text-[10px] text-gray-500 leading-relaxed">
                {t("scenarioForm.shockEditorHint")}
              </p>
            </div>
          )}

          {/* overrides — raw JSON. Collapsed under "Advanced" when the friendly
              editor above is shown; bare for legacy adjustments[] scenarios. */}
          {shockView ? (
            <details className="rounded-md border border-white/10 px-3 py-2">
              <summary className="text-[10px] uppercase tracking-wider text-gray-400 cursor-pointer hover:text-gray-100">
                {t("scenarioForm.advancedJsonSummary")}
              </summary>
              <div className="mt-2">{jsonInner}</div>
            </details>
          ) : (
            <div>{jsonInner}</div>
          )}

          {/* Submit error */}
          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertCircle size={13} />
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-white/10 bg-[#0A0E27]/95 px-6 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/15 px-4 py-1.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-gray-100"
          >
            {t("scenarioForm.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || Boolean(jsonError)}
            className="flex items-center gap-1.5 rounded border border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800] px-4 py-1.5 text-sm font-medium hover:bg-[#FFB800]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="scenario-form-save"
          >
            <Save size={13} />
            {submitting ? t("scenarioForm.saving") : isEdit ? t("scenarioForm.update") : t("scenarioForm.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

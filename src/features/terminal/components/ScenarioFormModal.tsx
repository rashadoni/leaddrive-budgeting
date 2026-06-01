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

  // Friendly editor — parse the current JSON into a `shock.target` when valid,
  // so a non-technical user can change the headline number + effect with labeled
  // inputs instead of editing raw JSON. Hides automatically mid-edit (invalid
  // JSON) and for legacy `adjustments[]` scenarios (no shock target).
  const shockTarget = useMemo(() => {
    try {
      const parsed = JSON.parse(overridesJson) as {
        shock?: { target?: { metric?: unknown; value?: unknown; drives?: unknown }; assumedImportShare?: unknown };
      };
      const tgt = parsed?.shock?.target;
      if (
        tgt &&
        typeof tgt.metric === "string" &&
        typeof tgt.value === "number" &&
        Number.isFinite(tgt.value) &&
        typeof tgt.drives === "string"
      ) {
        return {
          metric: tgt.metric,
          value: tgt.value,
          drives: tgt.drives,
          assumedImportShare:
            typeof parsed.shock?.assumedImportShare === "number" ? parsed.shock.assumedImportShare : null,
        };
      }
    } catch {
      /* mid-edit invalid JSON — friendly editor hides until valid again */
    }
    return null;
  }, [overridesJson]);

  // Patch the parsed shock and re-serialize back into the JSON textarea (the
  // JSON stays the single source of truth; the friendly inputs are a view).
  const patchShock = useCallback(
    (patch: { value?: number; drives?: string; assumedImportShare?: number }) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(overridesJson) as Record<string, unknown>;
      } catch {
        return;
      }
      const shock = { ...((parsed.shock as Record<string, unknown>) ?? {}) };
      const target = { ...((shock.target as Record<string, unknown>) ?? {}) };
      if (patch.value !== undefined) target.value = patch.value;
      if (patch.drives !== undefined) target.drives = patch.drives;
      shock.target = target;
      if (patch.assumedImportShare !== undefined) shock.assumedImportShare = patch.assumedImportShare;
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
      <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
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
        className={`w-full rounded border ${jsonError ? "border-red-500/60" : "border-input"} bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50`}
      />
      {jsonError ? (
        <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
          <AlertCircle size={10} />
          {jsonError}
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
          <CheckCircle size={10} className="text-emerald-500" />
          {t.rich("scenarioForm.structureValid", {
            m: (c) => <span className="font-mono">{c}</span>,
          })}
        </p>
      )}
      <details className="mt-2">
        <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
          {t("scenarioForm.codesHelpSummary")}
        </summary>
        <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
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
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-input bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <h2 className="text-base font-semibold">
            {isEdit ? t("scenarioForm.editTitle", { code: initial!.code }) : t("scenarioForm.createTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("scenarioForm.closeAria")}
            className="rounded border border-input px-2 py-1 text-sm hover:bg-muted/50"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Code — read-only on edit */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              {t("scenarioForm.codeLabel")}
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              readOnly={isEdit}
              placeholder={"SUGAR_DROP_20"}
              className={`w-full rounded border ${isEdit ? "border-border bg-muted/30 text-muted-foreground cursor-not-allowed" : "border-input bg-background"} px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50`}
            />
            {!isEdit && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t("scenarioForm.codeHint")}
              </p>
            )}
          </div>

          {/* nameEn */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              {t("scenarioForm.nameEnLabel")}
            </label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder={"Sugar price drops 20%"}
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* nameRu */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              {t("scenarioForm.nameRuLabel")}
            </label>
            <input
              type="text"
              value={nameRu}
              onChange={(e) => setNameRu(e.target.value)}
              placeholder={t("scenarioForm.nameRuPlaceholder")}
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* description */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              {t("scenarioForm.descLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t("scenarioForm.descPlaceholder")}
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* Friendly shock editor — labeled inputs for crisis/shock scenarios
              so the headline number + effect are editable without raw JSON.
              Closes the "что за коды / can't change the price" feedback. */}
          {shockTarget && (
            <div
              className="rounded border border-[#FFB800]/30 bg-[#FFB800]/5 p-3 space-y-3"
              data-testid="shock-editor"
            >
              <p className="text-xs font-mono uppercase tracking-wider text-[#FFB800]">
                {t("scenarioForm.shockEditorTitle")}
              </p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground flex-1" htmlFor="shock-value">
                  {METRIC_META[shockTarget.metric]
                    ? t(`scenarioForm.${METRIC_META[shockTarget.metric].labelKey}`)
                    : shockTarget.metric}
                </label>
                <input
                  id="shock-value"
                  type="number"
                  step="any"
                  value={shockTarget.value}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) patchShock({ value: n });
                  }}
                  className="w-28 rounded border border-input bg-background px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
                  data-testid="shock-value-input"
                />
                <span className="text-xs text-muted-foreground w-16">
                  {METRIC_META[shockTarget.metric]?.unit ?? ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground flex-1" htmlFor="shock-drives">
                  {t("scenarioForm.shockEffectLabel")}
                </label>
                <select
                  id="shock-drives"
                  value={shockTarget.drives}
                  onChange={(e) => patchShock({ drives: e.target.value })}
                  className="rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
                  data-testid="shock-drives-select"
                >
                  {DRIVES.map((d) => (
                    <option key={d} value={d}>
                      {t(`scenarioForm.${DRIVE_LABEL_KEY[d]}`)}
                    </option>
                  ))}
                </select>
              </div>
              {shockTarget.assumedImportShare !== null && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground flex-1" htmlFor="shock-import-share">
                    {t("scenarioForm.shockImportShareLabel")}
                  </label>
                  <input
                    id="shock-import-share"
                    type="number"
                    step="any"
                    min={0}
                    max={1}
                    value={shockTarget.assumedImportShare}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patchShock({ assumedImportShare: n });
                    }}
                    className="w-28 rounded border border-input bg-background px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
                  />
                  <span className="text-xs text-muted-foreground w-16">0–1</span>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {t("scenarioForm.shockEditorHint")}
              </p>
            </div>
          )}

          {/* overrides — raw JSON. Collapsed under "Advanced" when the friendly
              editor above is shown; bare for legacy adjustments[] scenarios. */}
          {shockTarget ? (
            <details className="rounded border border-input/60 px-3 py-2">
              <summary className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground">
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
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-input px-4 py-1.5 text-sm hover:bg-muted/50"
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

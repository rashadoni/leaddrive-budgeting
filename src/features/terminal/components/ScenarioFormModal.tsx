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

import { useCallback, useEffect, useState } from "react";
import { X, Save, AlertCircle, CheckCircle } from "lucide-react";

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
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("adjustments" in parsed) ||
        !Array.isArray((parsed as { adjustments: unknown }).adjustments) ||
        (parsed as { adjustments: unknown[] }).adjustments.length === 0
      ) {
        setJsonError('Must have { "adjustments": [ ... ] } with at least one entry');
        return false;
      }
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!code.trim() || !nameEn.trim()) {
      setError("Code and English name are required");
      return;
    }
    if (!/^[A-Z0-9_]+$/.test(code)) {
      setError("Code must be UPPERCASE letters, digits, and underscores only");
      return;
    }
    if (!validateJson(overridesJson)) return;

    setSubmitting(true);
    try {
      const parsed = JSON.parse(overridesJson) as { adjustments: unknown[] };

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
        setError("Admin role required to manage scenarios");
        return;
      }
      if (res.status === 409) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Scenario code already exists");
        return;
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; details?: unknown };
        setError(data.error ?? `Server error ${res.status}`);
        return;
      }

      const saved = (await res.json()) as { id: string; code: string; nameEn: string };
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [code, nameEn, nameRu, description, overridesJson, isEdit, initial, validateJson, onSaved, onClose]);

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
            {isEdit ? `Редактировать: ${initial!.code}` : "Новый сценарий"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть форму"
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
              Код сценария *
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
                Только UPPERCASE буквы, цифры и подчёркивания. Нельзя изменить после создания.
              </p>
            )}
          </div>

          {/* nameEn */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Название (EN) *
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
              Название (RU)
            </label>
            <input
              type="text"
              value={nameRu}
              onChange={(e) => setNameRu(e.target.value)}
              placeholder="Цена сахара −20%"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* description */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Описание
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Краткое описание шока и предпосылок"
              className="w-full rounded border border-input bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#FFB800]/50"
            />
          </div>

          {/* overrides JSON */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Overrides (JSON) *
            </label>
            <textarea
              value={overridesJson}
              onChange={(e) => {
                setOverridesJson(e.target.value);
                validateJson(e.target.value);
              }}
              rows={10}
              spellCheck={false}
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
                Структура корректна.{" "}
                <span className="font-mono">multiply</span> и{" "}
                <span className="font-mono">delta</span> — взаимозаменяемы.
              </p>
            )}
            <details className="mt-2">
              <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                Справка: допустимые коды индикаторов
              </summary>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                Примеры:{" "}
                <span className="font-mono text-[#FFB800]">AGRO_SUGAR_PRICE_TREND</span>,{" "}
                <span className="font-mono text-[#FFB800]">FX_IMPORTED_INPUT</span>,{" "}
                <span className="font-mono text-[#FFB800]">IND_GROSS_MARGIN</span>,{" "}
                <span className="font-mono text-[#FFB800]">AGRO_YIELD</span>.
                Полный список — в матрице индикаторов (HOLD GO → индикаторы).
              </p>
            </details>
          </div>

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
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || Boolean(jsonError)}
            className="flex items-center gap-1.5 rounded border border-[#FFB800] bg-[#FFB800]/10 text-[#FFB800] px-4 py-1.5 text-sm font-medium hover:bg-[#FFB800]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="scenario-form-save"
          >
            <Save size={13} />
            {submitting ? "Сохранение…" : isEdit ? "Обновить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

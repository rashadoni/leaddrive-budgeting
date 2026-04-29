"use client";

/**
 * Phase 7.D — saveable named-layouts menu.
 *
 * Sits in the top-right corner of PanelGrid. Two paths:
 *   • Save current — names the current splitter sizes; persists to
 *     `/api/terminal/layouts` (upsert by name).
 *   • Load — replays sizes via the imperative `setLayout` on each Group.
 *   • Delete — removes a named layout. Idempotent UI: name disappears
 *     from the dropdown immediately on success.
 *
 * The user's last-used sizes are independently saved to localStorage
 * by `useDefaultLayout` integration in PanelGrid — named layouts are
 * the explicit "remembered presets" layer on top of that baseline.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BUILT_IN_PRESETS,
  validateLayoutName,
  validateLayoutSizes,
  type LayoutSizes,
} from "../lib/layout-sizes";

interface LayoutListItem {
  id: string;
  name: string;
  sizes: unknown; // validated client-side via validateLayoutSizes
  updatedAt: string;
}

interface Props {
  /** Read the current splitter percentages from PanelGrid's groupRefs. */
  readCurrent: () => LayoutSizes;
  /** Push a layout into the live UI (used by Load). */
  applyLayout: (sizes: LayoutSizes) => void;
}

export function LayoutMenu({ readCurrent, applyLayout }: Props) {
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);
  const [layouts, setLayouts] = useState<LayoutListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Sub-27 cont'd Round-9 — replace native confirm() with a locale-aware
  // inline confirmation row. Storing the pending-delete item in state
  // means the dropdown stays open while the user reads the warning;
  // also blocks accidental double-confirm via repeated × clicks.
  const [pendingDelete, setPendingDelete] = useState<LayoutListItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/terminal/layouts");
      if (!res.ok) {
        // 401 = not signed in; 403 = no org. Either way, the menu is
        // useless — surface a quiet error.
        setLayouts([]);
        if (res.status !== 401 && res.status !== 403) {
          setError(`Failed to load layouts (HTTP ${res.status})`);
        }
        return;
      }
      const body = await res.json();
      setLayouts(Array.isArray(body.layouts) ? body.layouts : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleSave = async () => {
    const name = validateLayoutName(saveName);
    if (!name) {
      setError(t("layoutMenu.errorInvalidName"));
      return;
    }
    const sizes = readCurrent();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/terminal/layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sizes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setSaveName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = (item: LayoutListItem) => {
    const sizes = validateLayoutSizes(item.sizes);
    if (!sizes) {
      setError(t("layoutMenu.errorInvalidLayout", { name: item.name }));
      return;
    }
    applyLayout(sizes);
    setOpen(false);
  };

  const handleDeleteRequest = (item: LayoutListItem) => {
    // Two-stage delete: first click stages the item, second click confirms.
    // No native confirm() — that dialog is OS-locale only and bypasses our
    // i18n. Architect Round-9 closure.
    setPendingDelete(item);
  };

  const handleDeleteCancel = () => {
    setPendingDelete(null);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    const item = pendingDelete;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/terminal/layouts/${encodeURIComponent(item.name)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute top-2 right-2 z-30 font-mono text-[10px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-0.5 rounded border border-gray-800 bg-[#0A0E27] text-gray-400 hover:text-white hover:border-[#00D4AA]/60"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("layoutMenu.title")}
      >
        ▢ {t("layoutMenu.label")}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("layoutMenu.label")}
          className="absolute top-full right-0 mt-1 w-72 bg-[#050814] border border-gray-800 rounded shadow-xl p-2 space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between gap-2">
            <span className="text-gray-500 uppercase tracking-wider">{t("layoutMenu.label")}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-600 hover:text-gray-300"
              aria-label={t("layoutMenu.closeMenuAriaLabel")}
            >
              ×
            </button>
          </header>

          {/* Pending delete confirmation banner — sits at top of dropdown
              so user sees it before any other content. Replaces native
              confirm() for full locale awareness. */}
          {pendingDelete && (
            <div
              role="alertdialog"
              aria-label={t("layoutMenu.confirmDeleteTitle")}
              className="border border-[#FF4757]/40 bg-[#FF4757]/10 rounded p-2 space-y-1"
            >
              <div className="text-[#FF4757] uppercase tracking-wider text-[9px] font-semibold">
                {t("layoutMenu.confirmDeleteTitle")}
              </div>
              <div className="text-gray-200 text-[10px]">
                {t("layoutMenu.confirmDeleteBody", { name: pendingDelete.name })}
              </div>
              <div className="flex items-center justify-end gap-1 pt-1">
                <button
                  type="button"
                  onClick={handleDeleteCancel}
                  disabled={loading}
                  className="px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500"
                >
                  {t("layoutMenu.confirmDeleteCancel")}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={loading}
                  className="px-2 py-0.5 rounded bg-[#FF4757] text-white font-semibold uppercase tracking-wider disabled:bg-gray-800 disabled:text-gray-600"
                >
                  {t("layoutMenu.confirmDeleteConfirm")}
                </button>
              </div>
            </div>
          )}

          {/* Save current */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            className="flex items-center gap-1"
          >
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("layoutMenu.namePlaceholder")}
              maxLength={50}
              disabled={loading}
              className="flex-1 bg-[#0A0E27] border border-gray-800 rounded px-1.5 py-0.5 text-gray-200 placeholder-gray-700 focus:border-[#00D4AA] focus:outline-none"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={loading || saveName.trim() === ""}
              className="px-2 py-0.5 rounded bg-[#00D4AA] text-[#050814] font-semibold uppercase tracking-wider disabled:bg-gray-800 disabled:text-gray-600"
            >
              {t("layoutMenu.save")}
            </button>
          </form>

          {error && (
            <div className="text-[#FF4757] text-[10px]">{error}</div>
          )}

          {/* Phase B8 — built-in presets section. Sits between Save form
              and user-saved list so preset application doesn't require
              scrolling past saved names. */}
          <div className="border-t border-gray-800/60 pt-1">
            <div className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">
              {t("layoutMenu.presets")}
            </div>
            <ul className="space-y-0.5">
              {Object.entries(BUILT_IN_PRESETS).map(([key, preset]) => {
                // Locale-aware label via i18n; English fallback baked into
                // preset.label for backward-compat with collision filter.
                const localizedLabel = t(
                  `layoutMenu.presetLabel.${preset.labelKey}` as never,
                );
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => {
                        applyLayout(preset.sizes);
                        setOpen(false);
                      }}
                      className="w-full text-left text-gray-300 hover:text-[#00D4AA] hover:bg-gray-800/40 rounded px-1 py-0.5"
                      title={t("layoutMenu.applyPresetTitle", {
                        label: localizedLabel,
                      })}
                    >
                      {localizedLabel}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Saved layouts list. Filter out any user-saved layouts whose
              name collides with a built-in preset label so the dropdown
              never shows two "Bloomberg" entries (architect Round-1 ⚠️
              closure: name-collision guard). API-side reservation is
              tracked as a separate 🔄 — for now, hide on read.
              The collision filter uses preset.label (English) since
              the API stores layout names verbatim and the user can save
              "Bloomberg" in any locale; comparing to the canonical English
              label prevents locale-dependent dedup behavior. */}
          <div className="border-t border-gray-800/60 pt-1">
            <div className="text-gray-600 uppercase tracking-wider text-[9px] mb-0.5">
              {t("layoutMenu.saved")}
            </div>
            {(() => {
              const presetLabels = new Set(
                Object.values(BUILT_IN_PRESETS).map((p) => p.label),
              );
              const visibleSaved = layouts.filter(
                (l) => !presetLabels.has(l.name),
              );
              if (loading && visibleSaved.length === 0) {
                return <div className="text-gray-700">{t("layoutMenu.loading")}</div>;
              }
              if (visibleSaved.length === 0) {
                return <div className="text-gray-700">{t("layoutMenu.noSaved")}</div>;
              }
              return (
                <ul className="space-y-0.5 max-h-48 overflow-auto">
                  {visibleSaved.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-1 py-0.5 hover:bg-gray-800/40 rounded"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoad(item)}
                      className="flex-1 text-left text-gray-300 hover:text-[#00D4AA] truncate"
                      title={t("layoutMenu.loadTitle", {
                        name: item.name,
                        time: new Date(item.updatedAt).toLocaleString(),
                      })}
                    >
                      {item.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRequest(item)}
                      className="text-gray-700 hover:text-[#FF4757]"
                      aria-label={t("layoutMenu.deleteAriaLabel", { name: item.name })}
                      title={t("layoutMenu.deleteTitle")}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

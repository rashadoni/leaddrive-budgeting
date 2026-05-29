"use client";

/**
 * HeatMap inline AI-commentary cache + hook — extracted from HeatMap.tsx
 * (Phase 8 D1 2026-05-29). Module-level cache keyed by IndicatorValue.id ×
 * locale (cap 200) + hover-debounced fetch of the per-IV explain summary +
 * the `useAISummary` subscription hook. Pure data/effect logic (no JSX), so
 * it can't affect the HeatMap visual baseline. HeatMapCellTd consumes
 * `useAISummary` + `fetchAISummary`; the main HeatMap component + tests use
 * `clearAISummaryCache` (re-exported from HeatMap.tsx for the existing
 * import path).
 */

import React, { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Sub-27 cont'd Round-7 M3 — inline AI commentary on red/amber cells.
//
// Module-level cache keyed by IndicatorValue.id × locale so a user who
// sweeps the matrix scanning red cells reuses prior fetches across cell
// remounts (PanelGrid re-renders, locale switches, SSE refetches that
// rebuild rows). Cap at 200 entries — older drops on overflow.
//
// Hover-debounce 500ms ensures we only fire when the user genuinely
// paused on a cell, not during a sweep. Single in-flight per ivId so
// rapid hover→leave→re-hover doesn't double-fire.
// ─────────────────────────────────────────────────────────────────────────
type AISummaryEntry =
  | { kind: 'pending' }
  | { kind: 'ok'; sentence: string }
  | { kind: 'error' };

const AI_SUMMARY_CACHE = new Map<string, AISummaryEntry>();
const AI_SUMMARY_INFLIGHT = new Set<string>();
const AI_SUMMARY_LIMIT = 200;
type AISummaryListener = (key: string, entry: AISummaryEntry) => void;
const AI_SUMMARY_LISTENERS = new Set<AISummaryListener>();

function notifyAiSummary(key: string, entry: AISummaryEntry) {
  AI_SUMMARY_CACHE.set(key, entry);
  if (AI_SUMMARY_CACHE.size > AI_SUMMARY_LIMIT) {
    // FIFO eviction — Map iterates insertion-order; drop oldest.
    const first = AI_SUMMARY_CACHE.keys().next().value;
    if (first !== undefined) AI_SUMMARY_CACHE.delete(first);
  }
  for (const listener of AI_SUMMARY_LISTENERS) listener(key, entry);
}

function extractFirstSentence(narrative: string): string {
  // Split on `.`/`!`/`?` followed by space or end-of-string. Stop at
  // first hit; keep the trailing punctuation. Truncate at 180 chars
  // safety (LLM occasionally emits run-on first sentence).
  const trimmed = narrative.trim();
  const match = trimmed.match(/^[^.!?]+[.!?]/);
  const first = match ? match[0] : trimmed.split('\n')[0];
  return first.length > 180 ? first.slice(0, 177) + '…' : first;
}

export async function fetchAISummary(ivId: string, locale: string): Promise<void> {
  const key = `${ivId}:${locale}`;
  if (AI_SUMMARY_CACHE.has(key) || AI_SUMMARY_INFLIGHT.has(key)) return;
  AI_SUMMARY_INFLIGHT.add(key);
  notifyAiSummary(key, { kind: 'pending' });
  try {
    const res = await fetch(`/api/indicators/values/${ivId}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: locale }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const sentence = extractFirstSentence(body.narrative ?? '');
    notifyAiSummary(key, sentence ? { kind: 'ok', sentence } : { kind: 'error' });
  } catch {
    notifyAiSummary(key, { kind: 'error' });
  } finally {
    AI_SUMMARY_INFLIGHT.delete(key);
  }
}

/**
 * Round-7 architect closure: clear all cached narratives. Called by SSE
 * `onIndicatorChanged` so a period switch / data refresh doesn't leave
 * stale narratives attached to ivIds whose underlying values have moved.
 * IndicatorValue.id is stable across recompute (upserted by composite
 * key), so without this clear, hovering a cell after data change would
 * show the prior period's narrative.
 */
export function clearAISummaryCache(): void {
  AI_SUMMARY_CACHE.clear();
  AI_SUMMARY_INFLIGHT.clear();
  for (const listener of AI_SUMMARY_LISTENERS) {
    // Notify all live cells so they drop their stale entry. Pass empty
    // string as key + a synthetic 'error' to force re-fetch on next hover.
    listener('', { kind: 'error' });
  }
}

export function useAISummary(ivId: string | undefined, locale: string): AISummaryEntry | null {
  const key = ivId ? `${ivId}:${locale}` : null;
  const [entry, setEntry] = useState<AISummaryEntry | null>(() =>
    key ? AI_SUMMARY_CACHE.get(key) ?? null : null,
  );
  useEffect(() => {
    if (!key) {
      setEntry(null);
      return;
    }
    setEntry(AI_SUMMARY_CACHE.get(key) ?? null);
    const listener: AISummaryListener = (k, e) => {
      if (k === key) setEntry(e);
    };
    AI_SUMMARY_LISTENERS.add(listener);
    return () => {
      AI_SUMMARY_LISTENERS.delete(listener);
    };
  }, [key]);
  return entry;
}

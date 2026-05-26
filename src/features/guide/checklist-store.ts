"use client";

/**
 * Per-language checklist store backed by `localStorage`.
 *
 * Why a module-level store instead of React state in the parent:
 *   - Re-rendering the whole markdown tree on every checkbox toggle
 *     blows away the memoization that keeps screenshots / TOC stable.
 *     Each task-list item gets its own `useChecklistItem(lang, line)`
 *     subscription, so toggling one item re-renders only THAT button.
 *   - `useSyncExternalStore` with an explicit server snapshot of
 *     `false` makes initial render match SSR exactly → no hydration
 *     mismatch warnings (which is what the dev-mode "N Issues" badge
 *     was complaining about).
 *
 * Per-language isolation: each lang has its own `Set<number>` keyed
 * under `guide:checks:<lang>` in localStorage. Switching language
 * (RU → EN → AZ) loads a fresh state.
 */

import { useSyncExternalStore } from "react";

interface ChecklistStore {
  has(line: number): boolean;
  toggle(line: number): void;
  size(): number;
  reset(): void;
  subscribe(fn: () => void): () => void;
}

const stores = new Map<string, ChecklistStore>();

function createStore(lang: string): ChecklistStore {
  const storageKey = `guide:checks:${lang}`;
  let state = new Set<number>();
  const listeners = new Set<() => void>();

  // Hydrate from localStorage on first access. Skipped on server.
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) state = new Set(parsed);
      }
    } catch {
      /* localStorage disabled or JSON corrupted — start fresh */
    }
  }

  const notify = () => listeners.forEach((fn) => fn());

  const persist = () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...state]));
    } catch {
      /* silent — quota / private mode */
    }
  };

  return {
    has: (line) => state.has(line),
    size: () => state.size,
    toggle(line) {
      const next = new Set(state);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      state = next;
      persist();
      notify();
    },
    reset() {
      state = new Set();
      persist();
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

function getStore(lang: string): ChecklistStore {
  let cached = stores.get(lang);
  if (!cached) {
    cached = createStore(lang);
    stores.set(lang, cached);
  }
  return cached;
}

/** Per-item subscription — re-renders ONLY the button whose `line`
 *  toggles (because React compares snapshots with `Object.is` and
 *  `store.has(line)` returns the same bool for unrelated changes). */
export function useChecklistItem(
  lang: string,
  line: number,
): { isChecked: boolean; toggle: () => void } {
  const store = getStore(lang);
  const isChecked = useSyncExternalStore(
    store.subscribe,
    () => store.has(line),
    () => false, // SSR snapshot — always unchecked on first paint
  );
  return { isChecked, toggle: () => store.toggle(line) };
}

/** Header counter subscription — fires on any toggle. */
export function useChecklistCount(lang: string): {
  count: number;
  reset: () => void;
} {
  const store = getStore(lang);
  const count = useSyncExternalStore(
    store.subscribe,
    () => store.size(),
    () => 0,
  );
  return { count, reset: () => store.reset() };
}

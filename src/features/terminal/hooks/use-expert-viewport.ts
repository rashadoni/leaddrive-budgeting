"use client";

import { useSyncExternalStore } from "react";

export const EXPERT_VIEWPORT_QUERY = "(min-width: 768px)";

function subscribeToViewport(onStoreChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const mediaQuery = window.matchMedia(EXPERT_VIEWPORT_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getViewportSnapshot() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.(EXPERT_VIEWPORT_QUERY).matches)
  );
}

function getServerViewportSnapshot() {
  return false;
}

/** Reactive mirror of the desktop-only Expert breakpoint. */
export function useExpertViewport(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getServerViewportSnapshot,
  );
}

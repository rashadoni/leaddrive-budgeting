"use client";

/**
 * Phase 7.H Bloomberg-multi-window — minimal layout for popped-out
 * terminal panels. NO sidebar, NO global header — just the panel +
 * the providers it needs (QueryClient for SWR-style data fetching,
 * SessionProvider already inherited from app/layout.tsx).
 *
 * Opened from PanelGrid via window.open() — user can drag this
 * window to a separate monitor for true multi-display Bloomberg
 * setup.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function TerminalPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark h-screen w-screen bg-[#050814] overflow-hidden">{children}</div>
    </QueryClientProvider>
  );
}

"use client";

/**
 * App Router GLOBAL error boundary — catches errors thrown in the root layout
 * itself (where the normal `error.tsx` boundary can't reach). It replaces the
 * entire document, so it must render its own <html>/<body> and cannot rely on
 * the app's providers (next-intl, theme) or CSS chunks being loaded — hence
 * plain English copy + inline styles (robust even when a CSS chunk is what
 * failed).
 *
 * Phase 8 G2 (2026-05-29) — reports the error to Sentry. `captureException` is
 * a no-op until `NEXT_PUBLIC_SENTRY_DSN` is set, so this is safe pre-DSN; once
 * a DSN exists, root-layout crashes start flowing to Sentry with no further
 * change. This is the only behavior change visible without a DSN: a catastrophic
 * root error now shows this minimal page instead of Next's default.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050814",
          color: "#e5e7eb",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.75rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#6b7280",
              margin: "0 0 0.75rem",
            }}
          >
            BudgetPro
          </p>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#9ca3af", lineHeight: 1.6, margin: "0 0 1.5rem" }}>
            An unexpected error interrupted the page. The issue has been logged.
            Reloading usually resolves it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              appearance: "none",
              border: "1px solid #1f2937",
              background: "#0A0E27",
              color: "#e5e7eb",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
          {error.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.6875rem",
                color: "#4b5563",
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}

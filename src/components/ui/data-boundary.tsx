"use client"

/**
 * Phase 7.G Turn CXV (Phase 3.2 — unified loading/error component) —
 * `<DataBoundary>` shared shell.
 *
 * Replaces ad-hoc `isLoading ? <Loader/> : error ? <Error/> : ...` patterns
 * scattered across the codebase. Three branches:
 *
 *   - `loading=true`  → renders `loadingFallback` (default: 4-row skeleton)
 *   - `error` truthy  → renders `errorFallback` (default: alert UI; optional
 *                       Retry button when `onRetry` is supplied)
 *   - otherwise       → renders `children`
 *
 * Loading wins over error: when both are set, the spinner displays so the
 * UI doesn't flicker between error → loading → loaded during retry cycles.
 *
 * **Migration note:** consumers migrate incrementally — this turn ships the
 * canonical component + tests; replacing existing ad-hoc patterns is
 * grunt work for separate per-tab turns.
 *
 * **Why no Sentry/LogRocket integration:** that's a separate Phase 3.2 ⬜
 * item; keeping this component pure-render makes it trivially testable
 * + framework-agnostic.
 */

import * as React from "react"
import { useTranslations } from "next-intl"

export interface DataBoundaryProps {
  /** When true, renders loading fallback regardless of error state. */
  loading?: boolean
  /** Error message OR Error object. Falsy → no error. Loading takes precedence. */
  error?: string | Error | null
  /** When supplied AND error is set, renders Retry button alongside the alert. */
  onRetry?: () => void
  /** Override default 4-row skeleton. */
  loadingFallback?: React.ReactNode
  /** Override default alert UI. Receives the error message + retry handler. */
  errorFallback?: (
    message: string,
    retry: (() => void) | undefined,
  ) => React.ReactNode
  /** Wrapped content rendered when loading=false and error is falsy. */
  children: React.ReactNode
}

function DefaultSkeleton() {
  const t = useTranslations("common")
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="data-boundary-skeleton"
      className="space-y-2"
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-4 w-full animate-pulse rounded bg-muted/60"
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">{t("loading")}</span>
    </div>
  )
}

function DefaultErrorAlert({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  const t = useTranslations("common")
  return (
    <div
      role="alert"
      data-testid="data-boundary-error"
      className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400"
    >
      <p className="font-medium">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="data-boundary-retry"
          className="mt-2 rounded border border-red-500/40 px-2 py-1 text-xs hover:bg-red-500/10"
        >
          {t("retry")}
        </button>
      )}
    </div>
  )
}

export function DataBoundary({
  loading = false,
  error = null,
  onRetry,
  loadingFallback,
  errorFallback,
  children,
}: DataBoundaryProps) {
  if (loading) {
    return <>{loadingFallback ?? <DefaultSkeleton />}</>
  }
  if (error) {
    const message = error instanceof Error ? error.message : error
    if (errorFallback) {
      return <>{errorFallback(message, onRetry)}</>
    }
    return <DefaultErrorAlert message={message} onRetry={onRetry} />
  }
  return <>{children}</>
}

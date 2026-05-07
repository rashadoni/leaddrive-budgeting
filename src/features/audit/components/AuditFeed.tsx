"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import type { AuditAction } from "@prisma/client"
import { summarizeAuditEvent } from "@/lib/audit/compact-summary"

// All AuditAction enum members — must include every value emitted by
// `src/lib/audit/log.ts` so the action-filter dropdown surfaces them.
// Pre-Turn-X this list was 9 of 12 (missing `ai_variance_explainer_run`,
// `ai_forecast_explainer_run`, `alert_thresholds_update`) — operators
// couldn't filter to the most-frequent prod actions. Compile-time
// bidirectional sync against Prisma's enum below — adding a new enum
// member fails tsc until it's added here too.
const ALL_ACTIONS = [
  "company_role_change",
  "budget_plan_create",
  "budget_plan_approve",
  "import_budget_create",
  "import_staging_apply",
  "import_staging_expired",
  "indicator_override_create",
  "indicator_override_update",
  "indicator_override_delete",
  "ai_variance_explainer_run",
  "ai_forecast_explainer_run",
  "alert_thresholds_update",
  "intel_crawl_run",
] as const satisfies readonly AuditAction[]
// Superset check: any Prisma AuditAction missing from ALL_ACTIONS makes
// `Exclude` non-empty → assignment fails tsc. Closes Turn-W ⚠️ #2.
type _Coverage =
  Exclude<AuditAction, (typeof ALL_ACTIONS)[number]> extends never ? true : false
const _coverage: _Coverage = true
void _coverage

interface AuditEvent {
  id: string
  action: AuditAction
  entityType: string
  entityId: string | null
  metadata: Record<string, unknown>
  context: Record<string, unknown> | null
  actor: { id: string; name: string; email: string } | null
  createdAt: string
}

interface FetchResponse {
  events: AuditEvent[]
  nextCursor: string | null
  hasMore: boolean
}

interface Filters {
  action: AuditAction | ""
  entityType: string
  from: string
  to: string
  actorUserId: string
}

const EMPTY_FILTERS: Filters = {
  action: "",
  entityType: "",
  from: "",
  to: "",
  actorUserId: "",
}

function buildSearchParams(filters: Filters, cursor: string | null, limit: number): string {
  const sp = new URLSearchParams()
  if (filters.action) sp.set("action", filters.action)
  if (filters.entityType) sp.set("entityType", filters.entityType)
  if (filters.actorUserId) sp.set("actorUserId", filters.actorUserId)
  if (filters.from) sp.set("from", new Date(filters.from).toISOString())
  if (filters.to) sp.set("to", new Date(filters.to).toISOString())
  if (cursor) sp.set("cursor", cursor)
  sp.set("limit", String(limit))
  return sp.toString()
}

export function AuditFeed() {
  // `filters` is the FORM state (controlled inputs the user is editing).
  // `appliedFilters` is what the most recent fetch actually used — Load
  // More must reuse `appliedFilters` so the cursor stays in sync with
  // the query that produced it. Without this split, typing into a
  // filter input without clicking Apply, then clicking Load More, sent
  // a mismatched (new filter + old cursor) request to the server.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Single-flight controller for the currently-active fetch. Every entry
  // point (initial mount, Apply, Reset, Load More) aborts the previous
  // in-flight request before starting a new one. Without this, a rapid
  // double-click on "Load More" produced two concurrent fetches whose
  // `setEvents((prev) => [...prev, ...data.events])` callbacks both ran,
  // duplicating rows in the table.
  const inflightRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    async (
      filtersForFetch: Filters,
      cursorForFetch: string | null,
      append: boolean,
    ) => {
      // Abort any prior in-flight fetch BEFORE creating the new one.
      // Strict-mode double-mount in dev, double-click on Apply / Load
      // More, or rapid filter Apply→Reset all converge on this guard.
      inflightRef.current?.abort()
      const controller = new AbortController()
      inflightRef.current = controller
      const { signal } = controller

      setLoading(true)
      setError(null)
      try {
        const qs = buildSearchParams(filtersForFetch, cursorForFetch, 50)
        const res = await fetch(`/api/audit/events?${qs}`, { signal })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const data: FetchResponse = await res.json()
        setEvents((prev) => (append ? [...prev, ...data.events] : data.events))
        setCursor(data.nextCursor)
        setHasMore(data.hasMore)
      } catch (err) {
        // AbortError = a newer fetchPage has superseded this one. Skip
        // setError so the user doesn't see "AbortError" flash in the
        // alert chip; the new fetch will own the loading + error state.
        if (err instanceof DOMException && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        // Only the LATEST fetch owns the loading flag. A superseded
        // fetch's finally must NOT clobber the newer fetch's
        // `setLoading(true)`. Using the ref-identity check (rather than
        // `signal.aborted`) handles the race correctly even when the
        // newer fetch hasn't yet thrown AbortError on the older one.
        if (inflightRef.current === controller) {
          setLoading(false)
        }
      }
    },
    [],
  )

  // Initial load on mount.
  useEffect(() => {
    fetchPage(EMPTY_FILTERS, null, false)
    return () => {
      inflightRef.current?.abort()
    }
  }, [fetchPage])

  const onApplyFilters = (e: React.FormEvent) => {
    e.preventDefault()
    setAppliedFilters(filters)
    setEvents([])
    setCursor(null)
    fetchPage(filters, null, false)
  }

  const onResetFilters = () => {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setEvents([])
    setCursor(null)
    fetchPage(EMPTY_FILTERS, null, false)
  }

  const onLoadMore = () => {
    // Use `appliedFilters` (the query that produced `cursor`), NOT
    // `filters` (which the user may have edited without re-applying).
    fetchPage(appliedFilters, cursor, true)
  }

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={onApplyFilters}
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 rounded-md border bg-card p-4"
      >
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Action</span>
          <select
            value={filters.action}
            onChange={(e) =>
              setFilters((f) => ({ ...f, action: e.target.value as AuditAction | "" }))
            }
            className="w-full rounded border bg-background px-2 py-1.5"
          >
            <option value="">— any —</option>
            {ALL_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Entity type</span>
          <input
            type="text"
            value={filters.entityType}
            onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
            placeholder="Company, BudgetPlan, …"
            className="w-full rounded border bg-background px-2 py-1.5"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="w-full rounded border bg-background px-2 py-1.5"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="w-full rounded border bg-background px-2 py-1.5"
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onResetFilters}
            disabled={loading}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2 w-[40%]">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No events match the current filters.
                </td>
              </tr>
            )}
            {events.map((e) => {
              const isOpen = expanded.has(e.id)
              return (
                <tr
                  key={e.id}
                  className="hover:bg-muted/20 cursor-pointer align-top"
                  onClick={() => toggleRow(e.id)}
                >
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {formatTimestamp(e.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    {e.actor ? (
                      <span title={e.actor.email}>{e.actor.name}</span>
                    ) : (
                      <span className="text-muted-foreground italic">system</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="font-medium">{e.entityType}</span>
                    {e.entityId && (
                      <span className="text-muted-foreground"> · {e.entityId}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {isOpen ? (
                      <pre className="max-w-full whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px]">
                        {JSON.stringify(
                          { metadata: e.metadata, context: e.context },
                          null,
                          2,
                        )}
                      </pre>
                    ) : (
                      <span className="text-muted-foreground">
                        {summarizeAuditEvent({
                          action: e.action,
                          entityType: e.entityType,
                          metadata: e.metadata,
                        }).verbose}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {events.length} event{events.length === 1 ? "" : "s"} loaded
          {hasMore && " · more available"}
        </div>
        <button
          type="button"
          disabled={!hasMore || loading}
          onClick={onLoadMore}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {loading ? "Loading…" : hasMore ? "Load more" : "No more"}
        </button>
      </div>
    </div>
  )
}

function formatTimestamp(iso: string): string {
  // Compact local format that fits in a narrow column without truncation.
  // Browser-local TZ — audit-log readers are humans, not servers.
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}


"use client"

/**
 * Phase 7.K Phase 5a — Client-side API key form.
 *
 * One row per known source. User can:
 *  - Type a new key in the input → click "Save" → PATCH the route
 *  - Click "Clear" → PATCH with null → key removed
 *
 * No reveal of stored keys (server returns redacted preview only).
 * Inline status messages per row.
 */
import { useState, useTransition } from "react"
import type { ApiKeySource } from "@/lib/intel/api-keys"

interface SourceDoc {
  name: string
  signupUrl: string
  notes: string
  sectors: string[]
}

interface InitialRow {
  source: ApiKeySource
  configured: boolean
  preview: string
  doc: SourceDoc | undefined
}

interface ApiKeysFormProps {
  initial: InitialRow[]
}

type RowState = "idle" | "saving" | "saved" | "error"

export function ApiKeysForm({ initial }: ApiKeysFormProps) {
  const [rows, setRows] = useState(
    initial.map((r) => ({
      ...r,
      input: "",
      state: "idle" as RowState,
      message: "" as string,
    })),
  )
  const [, startTransition] = useTransition()

  const updateRow = (
    idx: number,
    patch: Partial<(typeof rows)[number]>,
  ) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const submitOne = async (idx: number, source: ApiKeySource, value: string | null) => {
    updateRow(idx, { state: "saving", message: "" })
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: { [source]: value } }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        details?: string[]
        updated?: string[]
        cleared?: string[]
      }
      if (!res.ok) {
        updateRow(idx, {
          state: "error",
          message: data.details?.join("; ") ?? data.error ?? `HTTP ${res.status}`,
        })
        return
      }
      const wasCleared = data.cleared?.includes(source)
      updateRow(idx, {
        state: "saved",
        message: wasCleared ? "Cleared." : "Saved.",
        input: "",
        configured: !wasCleared,
        preview: wasCleared ? "***" : "(saved — reload page to see preview)",
      })
    } catch (e) {
      updateRow(idx, {
        state: "error",
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((row, idx) => (
        <div
          key={row.source}
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
            <div>
              <h3 className="text-base font-semibold">
                {row.doc?.name ?? row.source}{" "}
                <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {row.source}
                </code>
              </h3>
              {row.doc && (
                <p className="text-sm text-slate-600 dark:text-slate-300">{row.doc.notes}</p>
              )}
              {row.doc?.sectors && row.doc.sectors.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Sectors: {row.doc.sectors.join(", ")}
                </p>
              )}
              {row.doc?.signupUrl && (
                <p className="mt-1 text-xs">
                  <a
                    href={row.doc.signupUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-blue-600 underline hover:text-blue-700"
                  >
                    Get a key →
                  </a>
                </p>
              )}
            </div>
            <div className="text-right">
              {row.configured ? (
                <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-500/40">
                  Configured · {row.preview}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-500/40">
                  No key
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <input
              type="password"
              autoComplete="off"
              placeholder="Paste new key (≥8 chars)"
              value={row.input}
              onChange={(e) => updateRow(idx, { input: e.target.value })}
              className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800"
              disabled={row.state === "saving"}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  startTransition(() => submitOne(idx, row.source, row.input))
                }
                disabled={row.state === "saving" || row.input.trim().length === 0}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {row.state === "saving" ? "Saving…" : "Save"}
              </button>
              {row.configured && (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(() => submitOne(idx, row.source, null))
                  }
                  disabled={row.state === "saving"}
                  className="rounded-md border border-rose-300 px-4 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:hover:bg-rose-950"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {row.message && (
            <p
              className={`mt-2 text-sm ${
                row.state === "error"
                  ? "text-rose-700 dark:text-rose-400"
                  : "text-emerald-700 dark:text-emerald-400"
              }`}
            >
              {row.message}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

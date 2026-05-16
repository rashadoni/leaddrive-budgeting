"use client";
/**
 * Financial-truth-infra L4 — registry editor UI.
 *
 * Replaces the manual edit of `data/onboarding-source-registry.json`
 * with an admin page where the watchdog operator can add / edit /
 * remove company → xlsx mappings without filesystem access.
 *
 * One table row per entry: companyCode, xlsx path, sheet name (or
 * `(none)`), period. Edit-in-place via the form below. Removal via
 * the trash icon. Saves are PUT/DELETE against
 * `/api/admin/source-registry`.
 */
import React from "react";
import { Loader2, Plus, Trash2, Save } from "lucide-react";

interface Entry {
  xlsx: string;
  sheet: string | null;
  period: string;
}

export function SourceRegistryAdmin() {
  const [entries, setEntries] = React.useState<Record<string, Entry>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<{
    companyCode: string;
    xlsx: string;
    sheet: string;
    period: string;
  }>({ companyCode: "", xlsx: "", sheet: "", period: "2026" });

  const fetchEntries = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/source-registry");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setEntries(body.entries ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/source-registry", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyCode: form.companyCode.trim(),
          xlsx: form.xlsx.trim(),
          sheet: form.sheet.trim() || null,
          period: form.period.trim() || "2026",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setForm({ companyCode: "", xlsx: "", sheet: "", period: "2026" });
      await fetchEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (companyCode: string) => {
    if (!confirm(`Remove registry entry for ${companyCode}?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/source-registry?companyCode=${encodeURIComponent(companyCode)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await fetchEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (companyCode: string, entry: Entry) => {
    setForm({
      companyCode,
      xlsx: entry.xlsx,
      sheet: entry.sheet ?? "",
      period: entry.period,
    });
  };

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Drift Watchdog Source Registry</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Maps each company to its authoritative xlsx file for the nightly
          drift-watchdog. Edits write atomically to{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
            data/onboarding-source-registry.json
          </code>
          .
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Entries</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="animate-spin h-4 w-4" /> Loading…
          </div>
        ) : Object.keys(entries).length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No entries yet. Add one below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 px-2 font-medium">Company Code</th>
                  <th className="py-2 px-2 font-medium">xlsx Path</th>
                  <th className="py-2 px-2 font-medium">Sheet</th>
                  <th className="py-2 px-2 font-medium">Period</th>
                  <th className="py-2 px-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(entries)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([code, entry]) => (
                    <tr key={code} className="border-b border-border/40 hover:bg-accent/30">
                      <td className="py-2 px-2 font-mono font-semibold">{code}</td>
                      <td className="py-2 px-2 font-mono text-xs text-muted-foreground truncate max-w-[400px]" title={entry.xlsx}>
                        {entry.xlsx}
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">
                        {entry.sheet ?? <span className="italic text-muted-foreground">(none)</span>}
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">{entry.period}</td>
                      <td className="py-2 px-2 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => handleEdit(code, entry)}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(code)}
                          disabled={saving}
                          className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-600 hover:bg-red-500/10"
                          aria-label={`Remove ${code}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Plus size={16} />
          {entries[form.companyCode] ? "Edit entry" : "Add entry"}
        </h2>
        <form onSubmit={handleSave} className="space-y-3 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-code" className="text-xs uppercase tracking-wider text-muted-foreground">
                Company Code *
              </label>
              <input
                id="reg-code"
                type="text"
                value={form.companyCode}
                onChange={(e) => setForm({ ...form, companyCode: e.target.value })}
                placeholder="AZSEKER-EDEN"
                required
                className="w-full px-2 py-1.5 rounded border border-border bg-background font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="reg-period" className="text-xs uppercase tracking-wider text-muted-foreground">
                Period *
              </label>
              <input
                id="reg-period"
                type="text"
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="2026"
                required
                className="w-full px-2 py-1.5 rounded border border-border bg-background font-mono text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="reg-xlsx" className="text-xs uppercase tracking-wider text-muted-foreground">
              xlsx Path (absolute or repo-relative) *
            </label>
            <input
              id="reg-xlsx"
              type="text"
              value={form.xlsx}
              onChange={(e) => setForm({ ...form, xlsx: e.target.value })}
              placeholder="/path/to/budget.xlsx"
              required
              className="w-full px-2 py-1.5 rounded border border-border bg-background font-mono text-sm"
            />
          </div>
          <div>
            <label htmlFor="reg-sheet" className="text-xs uppercase tracking-wider text-muted-foreground">
              Sheet name (optional — leave blank for single-sheet xlsx)
            </label>
            <input
              id="reg-sheet"
              type="text"
              value={form.sheet}
              onChange={(e) => setForm({ ...form, sheet: e.target.value })}
              placeholder="PL_EDEN"
              className="w-full px-2 py-1.5 rounded border border-border bg-background font-mono text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 text-sm"
            >
              {saving ? <Loader2 className="animate-spin h-3 w-3" /> : <Save size={14} />}
              {entries[form.companyCode] ? "Save edit" : "Add entry"}
            </button>
            <button
              type="button"
              onClick={() => setForm({ companyCode: "", xlsx: "", sheet: "", period: "2026" })}
              className="text-sm px-3 py-1.5 rounded border border-border hover:bg-accent"
            >
              Clear
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

"use client";

/**
 * Phase 7.F sub-group RBAC admin v2 — user access table.
 *
 * Lists every user in the org with their current
 * `allowedSubGroupIds`. Admin can toggle which sub-groups each user
 * can see. Empty selection = full org access (legacy default).
 *
 * Design: matches the CoARolesAdmin / approval-requests admin pattern
 * (Card + Badge + Lucide icons + theme tokens) so the admin section
 * feels consistent.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  Users,
  Shield,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLogin: string | null;
  allowedSubGroupIds: string[];
}

interface SubGroup {
  id: string;
  code: string;
  name: string;
  childCount: number;
}

type RowState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

const ROLE_BADGE: Record<string, { label: string; tone: string }> = {
  admin: { label: "admin", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  manager: { label: "manager", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  editor: { label: "editor", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  viewer: { label: "viewer", tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function formatRelativeTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

export function UsersAccessAdmin() {
  const t = useTranslations("usersAdmin");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [subGroups, setSubGroups] = useState<SubGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [uRes, sgRes] = await Promise.all([
          fetch("/api/users", { cache: "no-store" }),
          fetch("/api/companies/sub-groups", { cache: "no-store" }),
        ]);
        if (!uRes.ok || !sgRes.ok) {
          const body = await (uRes.ok ? sgRes : uRes).json().catch(() => ({}));
          if (alive) setError(body.error || `HTTP ${uRes.status}/${sgRes.status}`);
          return;
        }
        const uBody = (await uRes.json()) as { users: UserRow[] };
        const sgBody = (await sgRes.json()) as { subGroups: SubGroup[] };
        if (alive) {
          setUsers(uBody.users);
          setSubGroups(sgBody.subGroups);
          const d: Record<string, string[]> = {};
          for (const u of uBody.users) d[u.id] = [...u.allowedSubGroupIds];
          setDraft(d);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    if (!users) return null;
    const total = users.length;
    const admins = users.filter((u) => u.role === "admin").length;
    const restricted = users.filter(
      (u) => u.role !== "admin" && u.allowedSubGroupIds.length > 0,
    ).length;
    const unrestricted = users.filter(
      (u) => u.role !== "admin" && u.allowedSubGroupIds.length === 0,
    ).length;
    return { total, admins, restricted, unrestricted };
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [users, search]);

  const toggleSubGroup = (userId: string, subGroupId: string) => {
    setDraft((prev) => {
      const cur = prev[userId] ?? [];
      const next = cur.includes(subGroupId)
        ? cur.filter((id) => id !== subGroupId)
        : [...cur, subGroupId];
      return { ...prev, [userId]: next };
    });
    // Clear stale "saved" state on next edit so the toast doesn't linger.
    setRowState((p) =>
      p[userId]?.kind === "saved" ? { ...p, [userId]: { kind: "idle" } } : p,
    );
  };

  const save = async (userId: string) => {
    setRowState((p) => ({ ...p, [userId]: { kind: "saving" } }));
    const ids = draft[userId] ?? [];
    try {
      const res = await fetch(
        `/api/users/${encodeURIComponent(userId)}/access`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allowedSubGroupIds: ids }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRowState((p) => ({
          ...p,
          [userId]: {
            kind: "error",
            message: body.error || `HTTP ${res.status}`,
          },
        }));
        return;
      }
      setRowState((p) => ({ ...p, [userId]: { kind: "saved", at: Date.now() } }));
      setUsers((us) =>
        us
          ? us.map((u) =>
              u.id === userId ? { ...u, allowedSubGroupIds: ids } : u,
            )
          : us,
      );
    } catch (e) {
      setRowState((p) => ({
        ...p,
        [userId]: {
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">{t("title")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{t("subtitle")}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard
                label={t("stats.total")}
                value={stats.total}
                icon={<Users className="h-4 w-4" />}
                tone="bg-slate-50 dark:bg-slate-900/40"
              />
              <StatCard
                label={t("stats.admins")}
                value={stats.admins}
                icon={<Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                tone="bg-emerald-50 dark:bg-emerald-900/20"
              />
              <StatCard
                label={t("stats.restricted")}
                value={stats.restricted}
                icon={<EyeOff className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                tone="bg-blue-50 dark:bg-blue-900/20"
              />
              <StatCard
                label={t("stats.unrestricted")}
                value={stats.unrestricted}
                icon={<Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
                tone="bg-amber-50 dark:bg-amber-900/20"
              />
            </div>
          )}

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {users == null && !error && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t("loading")}</span>
            </div>
          )}

          {users != null && (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("col.user")}
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("col.role")}
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("col.access")}
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                      {t("col.lastLogin")}
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("col.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground text-xs">
                        {search ? t("noMatches") : t("empty")}
                      </td>
                    </tr>
                  )}
                  {filteredUsers.map((u) => {
                    const current = draft[u.id] ?? [];
                    const dirty =
                      current.length !== u.allowedSubGroupIds.length ||
                      current.some((id) => !u.allowedSubGroupIds.includes(id));
                    const state = rowState[u.id] ?? { kind: "idle" };
                    const isAdmin = u.role === "admin";
                    const roleBadge = ROLE_BADGE[u.role] ?? ROLE_BADGE.viewer;
                    return (
                      <tr
                        key={u.id}
                        className="border-t border-border/50 hover:bg-muted/20 transition-colors"
                        data-testid={`user-row-${u.id}`}
                      >
                        {/* User */}
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate flex items-center gap-1.5">
                                {u.name}
                                {!u.isActive && (
                                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground border border-border/60 rounded px-1 py-0.5">
                                    {t("inactive")}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {u.email}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-3 py-2.5 align-top">
                          <Badge
                            variant="default"
                            className={`text-[10px] uppercase tracking-wider ${roleBadge.tone}`}
                          >
                            {roleBadge.label}
                          </Badge>
                        </td>

                        {/* Access */}
                        <td className="px-3 py-2.5 align-top">
                          {isAdmin ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                              <Shield className="h-3.5 w-3.5" />
                              {t("adminBypass")}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {(subGroups ?? []).map((sg) => {
                                const selected = current.includes(sg.id);
                                return (
                                  <button
                                    key={sg.id}
                                    type="button"
                                    onClick={() => toggleSubGroup(u.id, sg.id)}
                                    className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border transition-all ${
                                      selected
                                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                        : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/40"
                                    }`}
                                    title={`${sg.name} · ${sg.childCount} ${t("companies")}`}
                                  >
                                    {selected && <Check className="h-3 w-3" />}
                                    {sg.code}
                                  </button>
                                );
                              })}
                              {current.length === 0 && (
                                <span className="inline-flex items-center text-[10px] text-amber-700 dark:text-amber-400 italic ml-1">
                                  {t("emptyFullAccess")}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Last login */}
                        <td className="px-3 py-2.5 align-top text-xs text-muted-foreground hidden md:table-cell">
                          {formatRelativeTime(u.lastLogin, "en")}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-2.5 align-top text-right">
                          {!isAdmin && (
                            <div className="flex items-center justify-end gap-2">
                              {state.kind === "saving" && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              )}
                              {state.kind === "saved" && (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                                  <Check className="h-3.5 w-3.5" />
                                  {t("saved")}
                                </span>
                              )}
                              {state.kind === "error" && (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-destructive"
                                  title={state.message}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  {t("errorShort")}
                                </span>
                              )}
                              <Button
                                size="sm"
                                onClick={() => save(u.id)}
                                disabled={!dirty || state.kind === "saving"}
                                className="h-8"
                              >
                                {t("save")}
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground italic">{t("hint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className={`rounded-lg p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}

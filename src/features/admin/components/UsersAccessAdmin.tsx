"use client";

/**
 * Phase 7.F sub-group RBAC admin v2 — user access table.
 *
 * Lists every user in the org with their current
 * `allowedSubGroupIds`. Admin can toggle which sub-groups each user
 * can see. Empty selection = full org access (legacy default).
 *
 * - Admin-only API: non-admin viewers see "Forbidden" state
 * - Per-row save (no batch) — keeps mutations small + auditable
 * - Optimistic UI: row goes green on success, red on error
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

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

export function UsersAccessAdmin() {
  const t = useTranslations("usersAdmin");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [subGroups, setSubGroups] = useState<SubGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [draft, setDraft] = useState<Record<string, string[]>>({});

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
          // Initialize draft with current state.
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

  const subGroupById = useMemo(() => {
    const m = new Map<string, SubGroup>();
    for (const s of subGroups ?? []) m.set(s.id, s);
    return m;
  }, [subGroups]);

  const toggleSubGroup = (userId: string, subGroupId: string) => {
    setDraft((prev) => {
      const cur = prev[userId] ?? [];
      const next = cur.includes(subGroupId)
        ? cur.filter((id) => id !== subGroupId)
        : [...cur, subGroupId];
      return { ...prev, [userId]: next };
    });
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
      setRowState((p) => ({
        ...p,
        [userId]: { kind: "saved", at: Date.now() },
      }));
      // Refresh local user row state so dirty detection works.
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

  if (error) {
    return (
      <div className="p-6 text-[#FF4757]" role="alert">
        {error}
      </div>
    );
  }
  if (users == null || subGroups == null) {
    return (
      <div className="p-6 text-gray-500">{t("loading")}</div>
    );
  }

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-xl font-semibold mb-2">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-4">{t("subtitle")}</p>
      <div className="overflow-x-auto rounded border border-gray-800/40">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/30 text-gray-500 uppercase text-xs">
            <tr>
              <th className="text-left py-2 px-3 font-normal">{t("col.user")}</th>
              <th className="text-left py-2 px-3 font-normal">{t("col.role")}</th>
              <th className="text-left py-2 px-3 font-normal">
                {t("col.access")}
              </th>
              <th className="text-right py-2 px-3 font-normal">{t("col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const current = draft[u.id] ?? [];
              const dirty =
                current.length !== u.allowedSubGroupIds.length ||
                current.some((id) => !u.allowedSubGroupIds.includes(id));
              const state = rowState[u.id] ?? { kind: "idle" };
              const isAdmin = u.role === "admin";
              return (
                <tr
                  key={u.id}
                  className="border-t border-gray-800/30 hover:bg-gray-800/20"
                  data-testid={`user-row-${u.id}`}
                >
                  <td className="py-2 px-3">
                    <div className="text-gray-200">{u.name}</div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border ${
                        isAdmin
                          ? "border-[#00D4AA]/50 text-[#00D4AA]"
                          : "border-gray-700 text-gray-400"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    {isAdmin ? (
                      <span className="text-xs text-gray-500 italic">
                        {t("adminBypass")}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {subGroups.map((sg) => {
                          const selected = current.includes(sg.id);
                          return (
                            <button
                              key={sg.id}
                              type="button"
                              onClick={() => toggleSubGroup(u.id, sg.id)}
                              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
                                selected
                                  ? "border-[#00D4AA]/60 bg-[#00D4AA]/15 text-[#00D4AA]"
                                  : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                              }`}
                              title={`${sg.name} · ${sg.childCount} ${t("companies")}`}
                            >
                              {sg.code}
                            </button>
                          );
                        })}
                        {current.length === 0 && (
                          <span className="text-[10px] text-gray-600 italic ml-1">
                            {t("emptyFullAccess")}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {!isAdmin && (
                      <div className="flex items-center justify-end gap-2">
                        {state.kind === "saving" && (
                          <span className="text-xs text-gray-500">
                            {t("saving")}
                          </span>
                        )}
                        {state.kind === "saved" && (
                          <span className="text-xs text-[#00D4AA]">
                            ✓ {t("saved")}
                          </span>
                        )}
                        {state.kind === "error" && (
                          <span
                            className="text-xs text-[#FF4757]"
                            title={state.message}
                          >
                            ✗ {t("errorShort")}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => save(u.id)}
                          disabled={!dirty || state.kind === "saving"}
                          className="text-xs px-2 py-1 rounded bg-[#00D4AA] text-[#050814] disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed hover:bg-[#00E5BB]"
                        >
                          {t("save")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 mt-3">{t("hint")}</p>
    </div>
  );
}

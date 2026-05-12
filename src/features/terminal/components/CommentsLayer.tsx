"use client";

/**
 * Tier-3 sub-30 — CommentsLayer overlay (Bloomberg IB Internal Chat
 * equivalent for the CFO use-case).
 *
 * Bloomberg's IB Manager surfaces threaded chat between trader desks +
 * counterparties + research teams. Our holding-CFO equivalent is per-cell
 * @mention threads — a CFO can attach a question to a specific HeatMap
 * cell (e.g. "@cfo why is AAC-MAIN gross margin 8% red?") and the sub-co
 * finance manager can reply inline. This is the "discuss this exact data
 * point" surface, complementary to SubCoFinanceChat which is per-sub-co
 * channels (broader context).
 *
 * v1 scope:
 *   - In-memory + localStorage persistence (key: `terminal-comments-v1`)
 *   - Per-cell threads keyed by `${companyCode}:${indicatorCode}`
 *   - Comment shape: { id, author, timestamp, text }
 *   - @mention syntax (visual highlight of `@<word>` tokens; no
 *     notification routing in v1 — that's v2 along with DB persistence)
 *   - Modal-pattern delivery (same as AlertsPanel / ActionCenterPanel)
 *   - Opens on `terminal:open-comments` event (CommandBar `CMT GO`)
 *   - Active-cell context auto-fills the thread selector if user clicked
 *     a HeatMap cell before invoking CMT
 *
 * v2 (post-demo, 🔄'd in CARRYOVER):
 *   - Backend persistence (Comment Prisma model + REST endpoints)
 *   - @mention routing → notification + email
 *   - Read/unread state per user
 *   - Edit / delete / resolve workflow
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { MessageSquare, X, Send } from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";

interface Comment {
  id: string;
  /** Display name; populated from `session.user.name || session.user.email`
   *  at submit time. Falls back to "cfo" if no auth session (e.g. dev mode
   *  without NextAuth provider mounted). */
  author: string;
  /** Unix epoch ms; rendered via Intl.DateTimeFormat in user's locale. */
  timestamp: number;
  /** Free text. @mentions are visually highlighted at render time. */
  text: string;
}

/** Map<cellKey, Comment[]> — cellKey is "${companyCode}:${indicatorCode}". */
type CommentStore = Record<string, Comment[]>;

const STORAGE_KEY = "terminal-comments-v1";
const STORAGE_VERSION = 1;
const ANONYMOUS_FALLBACK = "anon"; // when no auth session

interface StorageEnvelope<T> {
  v: number;
  data: T;
}

function isEnvelope(x: unknown): x is StorageEnvelope<unknown> {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as StorageEnvelope<unknown>).v === "number" &&
    "data" in (x as StorageEnvelope<unknown>)
  );
}

/** Read comments from localStorage with defensive shape check + v:1
 *  envelope acceptance (legacy bare-object also accepted). */
function readStore(): CommentStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    const data: unknown = isEnvelope(parsed) ? parsed.data : parsed;
    if (!data || typeof data !== "object") return {};
    // Filter shape: each entry must be an array of {id, author, timestamp, text}
    const out: CommentStore = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(val)) continue;
      const filtered = val.filter(
        (c): c is Comment =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as Comment).id === "string" &&
          typeof (c as Comment).author === "string" &&
          typeof (c as Comment).timestamp === "number" &&
          typeof (c as Comment).text === "string",
      );
      if (filtered.length > 0) out[key] = filtered;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: CommentStore): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: StorageEnvelope<CommentStore> = {
      v: STORAGE_VERSION,
      data: store,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage full or disabled — silent fail.
  }
}

/** Highlight @mention tokens in text; returns a JSX fragment array. */
function renderWithMentions(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Match `@<word>` — alphanumeric + underscore + hyphen.
  const re = /@([a-zA-Z0-9_-]+)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      out.push(<span key={key++}>{text.slice(lastIdx, m.index)}</span>);
    }
    out.push(
      <span
        key={key++}
        className="text-[#FFB020] font-semibold"
        data-testid="mention"
      >
        @{m[1]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    out.push(<span key={key++}>{text.slice(lastIdx)}</span>);
  }
  return out;
}

export function CommentsLayer() {
  const t = useTranslations("terminal");
  const locale = useLocale();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState<CommentStore>({});
  const [draft, setDraft] = useState("");
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const activeIvId = useTerminalStore((s) => s.activeIndicatorValueId);
  /** Resolved current-user identity for new comments. Round-24 audit
   *  closure — replaces the hardcoded "cfo" placeholder so every
   *  comment carries the actual signed-in user's name/email. Falls
   *  back to "anon" only when no NextAuth provider is mounted (e.g.
   *  rendering outside the app shell — possible in tests but not in
   *  production where SessionProvider wraps the dashboard). */
  const currentAuthor = useMemo(() => {
    if (session?.user?.name && session.user.name.trim().length > 0) {
      return session.user.name;
    }
    if (session?.user?.email && session.user.email.trim().length > 0) {
      return session.user.email;
    }
    return ANONYMOUS_FALLBACK;
  }, [session]);

  // Hydrate from localStorage after mount (SSR-safe).
  useEffect(() => {
    setStore(readStore());
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-comments", onOpen);
    return () => window.removeEventListener("terminal:open-comments", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Active cell key — derived from store state. v1 uses the active
   * company code AND the active indicator value id (joined). When no
   * cell is active, the modal renders an empty-thread placeholder.
   */
  const cellKey = useMemo(() => {
    if (!activeCompanyCode || !activeIvId) return null;
    return `${activeCompanyCode}:${activeIvId}`;
  }, [activeCompanyCode, activeIvId]);

  const thread = cellKey ? store[cellKey] ?? [] : [];

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || !cellKey) return;
      const next: Comment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: currentAuthor,
        timestamp: Date.now(),
        text: trimmed,
      };
      const newStore: CommentStore = {
        ...store,
        [cellKey]: [...thread, next],
      };
      setStore(newStore);
      writeStore(newStore);
      setDraft("");
    },
    [draft, cellKey, store, thread, currentAuthor],
  );

  if (!open) return null;

  const fmt = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });

  const totalThreadCount = Object.values(store).filter((t) => t.length > 0).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("comments.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-lg border border-gray-700 shadow-2xl flex flex-col text-gray-200"
        style={{ backgroundColor: "#0A0E27" }}
      >
        <header
          className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 px-6 py-3 backdrop-blur shrink-0"
          style={{ backgroundColor: "rgba(10, 14, 39, 0.95)" }}
        >
          <div className="flex items-center gap-2">
            <MessageSquare
              size={16}
              className="text-[#00D4AA]"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-100">
                {t("comments.title", { count: totalThreadCount })}
              </h2>
              <p className="text-xs text-gray-500">
                {t("comments.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("comments.closeAriaLabel")}
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800 text-gray-300"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {/* v1 disclosure — comments persist in localStorage only; don't
            notify anyone else. Surface this so users don't expect
            real-time inter-user threads. */}
        <div
          className="px-6 py-2 border-b border-gray-800 text-[10px] text-[#00D4AA]/80 flex items-start gap-2"
          style={{ backgroundColor: "rgba(0, 212, 170, 0.06)" }}
          role="note"
        >
          <span className="font-bold mt-0.5">⚠</span>
          <span className="leading-snug">
            {t("comments.localOnlyBanner")}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {!cellKey ? (
            <p
              className="text-sm text-gray-500"
              data-testid="comments-no-cell"
            >
              {t("comments.noActiveCell")}
            </p>
          ) : (
            <>
              <div
                className="text-xs text-gray-500 uppercase tracking-wider font-mono"
                data-testid="comments-cell-key"
              >
                {t("comments.threadFor", { key: cellKey })}
              </div>
              {thread.length === 0 ? (
                <p
                  className="text-sm text-gray-500 italic"
                  data-testid="comments-empty"
                >
                  {t("comments.empty")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {thread.map((c) => (
                    <li
                      key={c.id}
                      data-testid={`comment-row-${c.id}`}
                      className="rounded border border-gray-800 px-3 py-2 bg-gray-900/40"
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="font-mono text-[11px] font-semibold text-[#00D4AA]">
                          @{c.author}
                        </span>
                        <span className="font-mono text-[10px] text-gray-500 tabular-nums">
                          {fmt.format(new Date(c.timestamp))}
                        </span>
                      </div>
                      <div className="text-[12px] text-gray-200 leading-snug">
                        {renderWithMentions(c.text)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {cellKey && (
          <form
            onSubmit={handleSubmit}
            className="border-t border-gray-800 px-6 py-3 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("comments.draftPlaceholder")}
              aria-label={t("comments.draftAriaLabel")}
              className="flex-1 bg-[#0A0E27] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:border-[#00D4AA] focus:outline-none"
              spellCheck={false}
              data-testid="comments-draft"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label={t("comments.sendAriaLabel")}
              className="px-3 py-1 rounded bg-[#00D4AA] text-[#050814] text-sm font-semibold flex items-center gap-1 disabled:bg-gray-800 disabled:text-gray-600"
              data-testid="comments-send"
            >
              <Send size={12} aria-hidden="true" />
              {t("comments.send")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * Tier-3 sub-30 — SubCoFinanceChat (Bloomberg counterparty-chat
 * equivalent for the CFO use-case).
 *
 * Bloomberg's IB Manager left column lists 7 broker-dealer chat threads;
 * the holding-CFO equivalent is per-sub-co finance-manager threads. The
 * holding CFO can ask "AAC: why is your gross margin 8% red this month?"
 * on the AAC channel; the AAC finance manager replies. SubCoFinanceChat
 * complements CommentsLayer (per-cell threads) — broader-context channels
 * exist per sub-co, not per data-point.
 *
 * v1 scope:
 *   - In-memory + localStorage persistence (key: `terminal-subco-chat-v1`)
 *   - Per-sub-co threads keyed by company code
 *   - Message shape: { id, direction, timestamp, text }
 *     where direction = "outgoing" (from holding CFO) | "incoming" (from
 *     sub-co finance manager). v1 always sends "outgoing"; v2 will route
 *     incoming via push-notification when the sub-co user replies in
 *     their own session.
 *   - Modal-pattern delivery (same as AlertsPanel / ActionCenterPanel)
 *   - Opens on `terminal:open-subco-chat` event (CommandBar `CHT GO`)
 *   - Sub-co list derived from useCompanies() — every leaf op-co with
 *     a code is a potential channel
 *
 * v2 (post-demo, 🔄'd in CARRYOVER):
 *   - Backend persistence (ChatMessage Prisma model + REST endpoints)
 *   - WebSocket / SSE for real-time incoming messages
 *   - Per-channel unread-count badges
 *   - File / image attachments
 *   - Read receipts
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Users, X, Send } from "lucide-react";
import { useCompanies } from "../hooks/use-companies";

interface ChatMessage {
  id: string;
  direction: "outgoing" | "incoming";
  timestamp: number;
  text: string;
}

/** Map<companyCode, ChatMessage[]> — per-sub-co threaded chat. */
type ChatStore = Record<string, ChatMessage[]>;

const STORAGE_KEY = "terminal-subco-chat-v1";
const STORAGE_VERSION = 1;

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

function readStore(): ChatStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    const data: unknown = isEnvelope(parsed) ? parsed.data : parsed;
    if (!data || typeof data !== "object") return {};
    const out: ChatStore = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const filtered = v.filter(
        (m): m is ChatMessage =>
          typeof m === "object" &&
          m !== null &&
          typeof (m as ChatMessage).id === "string" &&
          ((m as ChatMessage).direction === "outgoing" ||
            (m as ChatMessage).direction === "incoming") &&
          typeof (m as ChatMessage).timestamp === "number" &&
          typeof (m as ChatMessage).text === "string",
      );
      if (filtered.length > 0) out[k] = filtered;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: ChatStore): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: StorageEnvelope<ChatStore> = {
      v: STORAGE_VERSION,
      data: store,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage full / disabled — silent fail.
  }
}

export function SubCoFinanceChat() {
  const t = useTranslations("terminal");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState<ChatStore>({});
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { codeToId, loading: companiesLoading } = useCompanies();

  // Hydrate from localStorage after mount.
  useEffect(() => {
    setStore(readStore());
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-subco-chat", onOpen);
    return () =>
      window.removeEventListener("terminal:open-subco-chat", onOpen);
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

  /** Sorted alphabetic list of sub-co codes. Fallback to in-store keys
   *  when /api/companies hasn't resolved yet so user always sees their
   *  own past threads. */
  const channels = useMemo(() => {
    const fromApi = Array.from(codeToId.keys()).sort();
    if (fromApi.length > 0) return fromApi;
    return Object.keys(store).sort();
  }, [codeToId, store]);

  const thread = selectedCode ? store[selectedCode] ?? [] : [];

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || !selectedCode) return;
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        direction: "outgoing",
        timestamp: Date.now(),
        text: trimmed,
      };
      const newStore: ChatStore = {
        ...store,
        [selectedCode]: [...thread, msg],
      };
      setStore(newStore);
      writeStore(newStore);
      setDraft("");
    },
    [draft, selectedCode, store, thread],
  );

  if (!open) return null;

  const fmt = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("subcoChat.dialogAriaLabel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-lg border border-gray-700 shadow-2xl flex flex-col text-gray-200"
        style={{ backgroundColor: "#0A0E27" }}
      >
        <header
          className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 px-6 py-3 backdrop-blur shrink-0"
          style={{ backgroundColor: "rgba(10, 14, 39, 0.95)" }}
        >
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[#FFB020]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-100">
                {t("subcoChat.title")}
              </h2>
              <p className="text-xs text-gray-500">
                {t("subcoChat.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("subcoChat.closeAriaLabel")}
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800 text-gray-300"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {/* v1 disclosure — local-only persistence is non-obvious from the
            visual chrome alone; tell users explicitly so they don't expect
            sub-co finance manager to receive the message. */}
        <div
          className="px-6 py-2 border-b border-gray-800 text-[10px] text-[#FFB020]/80 flex items-start gap-2"
          style={{ backgroundColor: "rgba(255, 176, 32, 0.06)" }}
          role="note"
        >
          <span className="font-bold mt-0.5">⚠</span>
          <span className="leading-snug">
            {t("subcoChat.localOnlyBanner")}
          </span>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-[200px_1fr]">
          <aside
            aria-label={t("subcoChat.channelListAriaLabel")}
            className="border-r border-gray-800 overflow-y-auto"
          >
            <div className="text-[9px] uppercase tracking-wider text-gray-500 px-3 py-2 border-b border-gray-800">
              {t("subcoChat.channels")} ({channels.length})
            </div>
            {channels.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-500 italic">
                {companiesLoading
                  ? t("subcoChat.loading")
                  : t("subcoChat.noChannels")}
              </div>
            ) : (
              <ul className="font-mono text-[11px]">
                {channels.map((code) => {
                  const isActive = selectedCode === code;
                  const count = store[code]?.length ?? 0;
                  return (
                    <li key={code}>
                      <button
                        type="button"
                        onClick={() => setSelectedCode(code)}
                        data-testid={`subco-chat-channel-${code}`}
                        title={code}
                        className={`w-full text-left px-3 py-1.5 hover:bg-gray-800/40 flex items-center justify-between ${
                          isActive
                            ? "bg-[#FFB020]/10 text-[#FFB020]"
                            : "text-gray-300"
                        }`}
                      >
                        <span className="truncate">{code}</span>
                        {count > 0 && (
                          <span className="text-[9px] tabular-nums opacity-70 ml-1">
                            {count}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section
            aria-label={t("subcoChat.threadAriaLabel")}
            className="flex flex-col overflow-hidden"
          >
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
              data-testid="subco-chat-thread"
            >
              {!selectedCode ? (
                <p
                  className="text-sm text-gray-500"
                  data-testid="subco-chat-no-channel"
                >
                  {t("subcoChat.pickChannel")}
                </p>
              ) : thread.length === 0 ? (
                <p
                  className="text-sm text-gray-500 italic"
                  data-testid="subco-chat-empty"
                >
                  {t("subcoChat.emptyThread")}
                </p>
              ) : (
                thread.map((m) => (
                  <div
                    key={m.id}
                    data-testid={`subco-chat-msg-${m.id}`}
                    className={`max-w-[80%] rounded px-2 py-1 ${
                      m.direction === "outgoing"
                        ? "ml-auto bg-[#00D4AA]/15 border border-[#00D4AA]/30"
                        : "mr-auto bg-gray-800/40 border border-gray-700"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="font-mono text-[9px] uppercase tracking-wider opacity-70">
                        {m.direction === "outgoing"
                          ? t("subcoChat.from")
                          : selectedCode}
                      </span>
                      <span className="font-mono text-[9px] text-gray-500 tabular-nums">
                        {fmt.format(new Date(m.timestamp))}
                      </span>
                    </div>
                    <div className="text-[12px] text-gray-200 leading-snug">
                      {m.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {selectedCode && (
              <form
                onSubmit={handleSubmit}
                className="border-t border-gray-800 px-4 py-2 flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t("subcoChat.draftPlaceholder", {
                    channel: selectedCode,
                  })}
                  aria-label={t("subcoChat.draftAriaLabel")}
                  className="flex-1 bg-[#0A0E27] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:border-[#FFB020] focus:outline-none"
                  spellCheck={false}
                  data-testid="subco-chat-draft"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label={t("subcoChat.sendAriaLabel")}
                  className="px-3 py-1 rounded bg-[#FFB020] text-[#050814] text-sm font-semibold flex items-center gap-1 disabled:bg-gray-800 disabled:text-gray-600"
                  data-testid="subco-chat-send"
                >
                  <Send size={12} aria-hidden="true" />
                  {t("subcoChat.send")}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

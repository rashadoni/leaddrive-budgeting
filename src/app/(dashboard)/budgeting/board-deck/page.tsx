import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";
import { auth } from "@/lib/auth";
import { scoreToBand } from "@/lib/risk/composite-score";
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import {
  DEFAULT_ALERT_RULE_IDS,
  type AlertSeverity,
} from "@/lib/risk/alert-rules";
import { type HeatMapCell } from "@/lib/risk/heatmap-matrix";
import { buildBoardSnapshot } from "@/lib/board-deck/build-snapshot";
import {
  runNarration,
  isNarrationLanguage,
  type NarrationLanguage,
  type NarrationOutput,
} from "@/lib/board-deck/narrate-snapshot";
import { hasAnthropicKey } from "@/lib/ai/client";
import { PrintButton } from "./PrintButton";
import { ExportPptxButton } from "./ExportPptxButton";

export const metadata = {
  title: "Board Deck — Risk Snapshot",
};

/**
 * Phase C3 v1 — Board Deck Generator.
 *
 * Print-friendly server-rendered snapshot of the holding's risk posture
 * for sharing with the board / shareholders. Mirrors the Risk Terminal's
 * matrix view but optimized for an A4 portrait page: no interactive
 * panels, no live SSE — a frozen-in-time export.
 *
 * Output sections:
 *   1. Cover header — org name, period, generated timestamp.
 *   2. Composite scores table — every operational sub-co with its
 *      C5 0-100 score + status counts (g/a/r/unknown).
 *   3. Active alerts — every match from `evaluateAlertRules` against
 *      the same matrix the Terminal sees, grouped by severity.
 *   4. Status grid — companies × indicators tile-grid showing only
 *      status colors (no values; high-density visual summary).
 *   5. Footer — caveat (v1 ships static-snapshot; live-recompute under
 *      scenario overrides arrives in v2 + Phase 6 BullMQ).
 *
 * v1 deliberately uses the browser's native Print flow rather than
 * shipping a server-side PDF pipeline (no puppeteer / @react-pdf-renderer
 * dependency). v2 follow-ups in CARRYOVER.
 */
export default async function BoardDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; lang?: string; narrate?: string }>;
}) {
  const session = await auth();
  // `auth()` (NextAuth server-side) puts orgId at session.user.organizationId
  // — distinct from `requireAuth` (API helper) which surfaces it at
  // session.orgId. See src/lib/auth.ts:83.
  const orgId = session?.user?.organizationId;
  if (!session?.user || !orgId) {
    redirect("/budgeting");
  }

  // Sub-35 — server-side translator for alert rule names + message
  // bodies. Server components use `getTranslations` (async) instead of
  // `useTranslations` (client hook). Locale resolved from cookie/header
  // by next-intl/server middleware. Scoped at "terminal" (NOT
  // "terminal.alerts") so the engine-emitted absolute keys
  // (`alerts.rules.<id>` / `alerts.messages.<id>`) flow through without
  // string surgery — architect Round-31 closure of fragile prefix-strip.
  const tTerminal = await getTranslations("terminal");
  // Phase 7.G Turn G — separate scoped translator for `industries.*`. Used
  // by `localizeAlertMessageParams` to swap raw industry codes (e.g.
  // `"industrial"`) for their localized labels in sector-alert messages.
  // Cast to `IndustryTranslator` because next-intl's typed-key narrowing
  // is too strict for the dynamic-code lookup the helper does internally.
  const tIndustries = (await getTranslations(
    "industries",
  )) as unknown as IndustryTranslator;

  const params = await searchParams;
  const rawPeriod = params.period ?? currentBakuYear();
  // Architect Round-1 sub-12 ⚠️ closure: validate the period regex
  // before passing into the Prisma where-clause. Mirrors the matrix
  // endpoint's defense-in-depth at /api/indicators/matrix/route.ts:64-72.
  // Garbage input (`?period=foo`) returns the user to the budgeting hub
  // instead of silently rendering an empty page.
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      redirect("/budgeting");
    }
    throw err;
  }
  const period = rawPeriod;

  // Phase 7.E C3 v2 — single shared helper assembles the snapshot;
  // `/api/budgeting/board-deck/export-pptx` consumes the same helper so
  // the page render and PPTX export stay byte-for-byte identical.
  const snapshot = await buildBoardSnapshot({ orgId, period });
  if (!snapshot) {
    redirect("/budgeting");
  }

  // Phase 7.G E.2 — optional AI-narrated executive summary.
  // Off by default (would cost ~$0.05 per page-load otherwise); user
  // adds `?narrate=1` to request it. Param can also flow from a future
  // toggle button. Language picker via `?lang=en|ru|az`; defaults to
  // English. If the LLM call fails (timeout, no key, schema violation)
  // we render the page WITHOUT the narrative section — the deck is
  // still useful for the audience.
  const langParam = params.lang;
  const narrationLanguage: NarrationLanguage =
    typeof langParam === "string" && isNarrationLanguage(langParam)
      ? langParam
      : "en";
  const wantNarration =
    params.narrate === "1" || params.narrate === "true";
  let narration: NarrationOutput | null = null;
  if (wantNarration && hasAnthropicKey()) {
    try {
      narration = await runNarration({
        snapshot,
        language: narrationLanguage,
      });
    } catch (err) {
      // Graceful degradation — log + render without narrative. Operator
      // sees the failure in server logs; user sees a clean deck.
      console.error("[board-deck] runNarration failed:", err);
    }
  }
  const {
    org,
    operational,
    indicators,
    cellByKey,
    compositeByCompany,
    countsByCompany,
    matches,
    matchesBySeverity,
    idToCode,
    totals,
    generatedAt,
  } = snapshot;
  type IndicatorShape = (typeof indicators)[number];
  const totalCells = totals.cells;
  const totalGreen = totals.green;
  const totalAmber = totals.amber;
  const totalRed = totals.red;

  return (
    <div className="board-deck mx-auto max-w-5xl space-y-8 px-4 py-6 print:max-w-none print:px-0 print:py-0">
      <header className="flex items-center justify-between border-b border-gray-700 pb-4 print:border-black">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 print:text-gray-700">
            Board Snapshot
          </p>
          <h1 className="text-2xl font-semibold tracking-tight print:text-black">
            {org.name}
          </h1>
          <p className="text-sm text-gray-400 print:text-gray-700">
            Period <span className="font-mono">{period}</span> · Generated{" "}
            <time dateTime={generatedAt} className="font-mono">
              {generatedAt.replace("T", " ").slice(0, 19)}Z
            </time>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/budgeting/terminal"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white print:hidden"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Terminal
          </Link>
          <ExportPptxButton period={period} />
          <PrintButton />
        </div>
      </header>

      {narration !== null && (
        <section
          aria-label="Executive summary"
          data-testid="board-deck-narrative"
          className="rounded border border-[#00D4AA]/40 bg-[#00D4AA]/5 p-4 print:border-black print:bg-white print:break-inside-avoid"
        >
          <p className="text-xs uppercase tracking-wider text-[#00D4AA] mb-2 print:text-gray-700">
            Executive summary
            <span className="ml-2 text-gray-500 font-mono text-[10px] print:text-gray-500">
              · AI · {narration.modelName} · v{narration.promptVersion}
            </span>
          </p>
          <h2 className="text-lg font-semibold tracking-tight mb-3 print:text-black">
            {narration.headline}
          </h2>
          <div className="space-y-2 text-sm leading-relaxed text-gray-200 print:text-black">
            {narration.paragraphs.map((paragraph, idx) => (
              <p key={idx}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      <section
        aria-label="Holding summary"
        className="rounded border border-gray-800 p-4 print:border-black print:break-inside-avoid"
      >
        <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2 print:text-gray-700">
          Holding totals
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Operational sub-cos" value={operational.length} />
          <Stat label="Indicators" value={indicators.length} />
          <Stat label="Cells" value={totalCells} />
          <Stat
            label="Green / Amber / Red"
            value={`${totalGreen} / ${totalAmber} / ${totalRed}`}
          />
        </div>
      </section>

      <section
        aria-label="Composite scores"
        className="rounded border border-gray-800 print:border-black print:break-inside-avoid"
      >
        <h2 className="text-xs uppercase tracking-wider text-gray-500 px-4 pt-4 mb-2 print:text-gray-700">
          Composite scores ({operational.length})
        </h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-gray-500 border-b border-gray-800 print:text-gray-700 print:border-black">
            <tr>
              <th className="text-left px-4 py-2 font-mono">Code</th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Industry</th>
              <th className="text-right px-4 py-2">Score</th>
              <th className="text-center px-4 py-2">Band</th>
              <th className="text-right px-4 py-2">G / A / R / U</th>
            </tr>
          </thead>
          <tbody>
            {operational.map((co) => {
              const composite = compositeByCompany.get(co.id);
              const counts = countsByCompany.get(co.id);
              const score = composite?.score ?? null;
              const band = composite ? composite.band : "unknown";
              return (
                <tr
                  key={co.id}
                  className="border-b border-gray-800 print:border-gray-300"
                >
                  <td className="px-4 py-2 font-mono text-xs">{co.code}</td>
                  <td className="px-4 py-2">{co.name}</td>
                  <td className="px-4 py-2 text-gray-400 print:text-gray-700">
                    {co.industry || "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {score === null ? "—" : score}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <BandPill band={band} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-300 print:text-gray-700">
                    {counts
                      ? `${counts.green} / ${counts.amber} / ${counts.red} / ${counts.unknown}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section
        aria-label="Active alerts"
        className="rounded border border-gray-800 p-4 print:border-black print:break-inside-avoid"
      >
        <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2 print:text-gray-700">
          <AlertTriangle
            size={12}
            className="inline -mt-0.5 mr-1 text-[#FFB800]"
            aria-hidden="true"
          />
          Active alerts ({matches.length})
        </h2>
        {matches.length === 0 ? (
          <p className="text-sm text-[#00D4AA] print:text-black">
            ✓ No alerts triggered — all systems green.
          </p>
        ) : (
          (Object.keys(matchesBySeverity) as AlertSeverity[]).map((sev) => {
            const list = matchesBySeverity[sev];
            if (list.length === 0) return null;
            return (
              <div key={sev} className="mt-3 first:mt-0">
                <h3 className="text-xs font-mono uppercase tracking-wider mb-1 text-gray-300 print:text-black">
                  {sev} ({list.length})
                </h3>
                <ul className="space-y-1.5">
                  {list.map((m, i) => (
                    <li
                      key={`${m.ruleId}-${i}`}
                      className="text-sm border-l-2 pl-2 border-gray-700 print:border-black"
                    >
                      <div className="font-mono text-[10px] text-gray-500 print:text-gray-700">
                        {(() => {
                          // Sub-35 — locale-aware rule name (server-side).
                          // tTerminal is scoped at "terminal" so the engine
                          // key shape flows through directly.
                          if (!DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) return m.ruleName;
                          try {
                            return tTerminal(`alerts.rules.${m.ruleId}` as never);
                          } catch {
                            return m.ruleName;
                          }
                        })()}
                      </div>
                      <div>
                        {(() => {
                          // Sub-35 — locale-aware message body.
                          if (!m.messageKey || !DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) {
                            return m.message;
                          }
                          try {
                            // Turn G: localize industry code before substitution.
                            const localizedParams = localizeAlertMessageParams(
                              m.messageParams,
                              tIndustries,
                            );
                            return tTerminal(
                              m.messageKey as never,
                              localizedParams as never,
                            );
                          } catch {
                            return m.message;
                          }
                        })()}
                      </div>
                      {m.affectedCompanyIds.length > 0 && (
                        <div className="text-xs text-gray-500 mt-0.5 font-mono print:text-gray-700">
                          {m.affectedCompanyIds
                            .map((id) => idToCode.get(id) ?? id.slice(0, 8))
                            .join(", ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <section
        aria-label="Status grid"
        className="rounded border border-gray-800 p-4 overflow-x-auto print:border-black print:break-before-page"
      >
        <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2 print:text-gray-700">
          Status grid (companies × indicators)
        </h2>
        <table className="w-full text-[9px] font-mono border-collapse">
          <thead>
            <tr>
              <th className="text-left p-1 sticky left-0 bg-background print:bg-white">
                CO \\ IND
              </th>
              {indicators.map((ind: IndicatorShape) => (
                <th
                  key={ind.id}
                  className="text-center p-1 align-bottom"
                  style={{
                    writingMode: "vertical-rl",
                    transform: "rotate(180deg)",
                    minWidth: 16,
                    maxWidth: 16,
                  }}
                  title={ind.nameEn}
                >
                  {ind.code.replace(/^IND_/, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operational.map((co) => (
              <tr key={co.id}>
                <th className="text-left p-1 sticky left-0 bg-background print:bg-white text-gray-300 print:text-black">
                  {co.code}
                </th>
                {indicators.map((ind: IndicatorShape) => {
                  const cell = cellByKey.get(`${co.id}|${ind.id}`);
                  const status = cell?.status ?? "unknown";
                  return (
                    <td
                      key={ind.id}
                      className="p-0 border border-gray-900 print:border-gray-300"
                      style={{
                        backgroundColor: STATUS_PRINT_COLOR[status],
                        height: 16,
                        width: 16,
                      }}
                      title={`${co.code} · ${ind.code}: ${status}`}
                      aria-label={`${co.code} ${ind.code} ${status}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="text-xs text-gray-500 border-t border-gray-800 pt-3 print:border-black print:text-gray-700 print:break-inside-avoid">
        <p>
          Generated by BudgetPro Risk Terminal · Static snapshot at print
          time · Live recompute under scenario overrides ships with Phase 6
          (BullMQ scheduler) · Confidential — intended for board / executive
          recipients only.
        </p>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 print:text-gray-700">{label}</p>
      <p className="text-lg font-mono">{value}</p>
    </div>
  );
}

function BandPill({ band }: { band: ReturnType<typeof scoreToBand> | "unknown" }) {
  const tone =
    band === "green"
      ? "bg-[#00D4AA]/20 text-[#00D4AA] print:bg-green-200 print:text-green-900"
      : band === "amber"
        ? "bg-[#FFB800]/20 text-[#FFB800] print:bg-yellow-200 print:text-yellow-900"
        : band === "red"
          ? "bg-[#FF4757]/20 text-[#FF4757] print:bg-red-200 print:text-red-900"
          : "bg-gray-800 text-gray-400 print:bg-gray-200 print:text-gray-700";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${tone}`}
    >
      {band}
    </span>
  );
}

const STATUS_PRINT_COLOR: Record<HeatMapCell["status"], string> = {
  green: "#00D4AA",
  amber: "#FFB800",
  red: "#FF4757",
  unknown: "#1A2330",
};

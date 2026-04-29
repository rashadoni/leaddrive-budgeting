import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { filterOperationalCompanies } from "@/lib/risk/targets";
import {
  computeCompositeByCompany,
  scoreToBand,
} from "@/lib/risk/composite-score";
import { parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
  type AlertMatch,
  type AlertSeverity,
} from "@/lib/risk/alert-rules";
import { readAlertThresholdsFromOrgSettings } from "@/lib/risk/alert-thresholds-config";
import type { HeatMapCell } from "@/lib/risk/heatmap-matrix";
import { PrintButton } from "./PrintButton";

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
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await auth();
  // `auth()` (NextAuth server-side) puts orgId at session.user.organizationId
  // — distinct from `requireAuth` (API helper) which surfaces it at
  // session.orgId. See src/lib/auth.ts:83.
  const orgId = session?.user?.organizationId;
  if (!session?.user || !orgId) {
    redirect("/budgeting");
  }

  const params = await searchParams;
  const rawPeriod = params.period ?? String(new Date().getUTCFullYear());
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

  const [org, companiesRaw, indicators] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true, settings: true },
    }),
    prisma.company.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId: orgId }],
      },
      select: {
        id: true,
        code: true,
        nameEn: true,
        direction: true,
        unit: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (!org) {
    redirect("/budgeting");
  }

  // Explicit type arg preserves `name`/`sortOrder` on returned rows —
  // `filterOperationalCompanies` is generic over `CompanyForMatch` and
  // would otherwise narrow to its base shape (mirror of matrix endpoint
  // pattern, see route.ts:131-132).
  type CompanyRawShape = (typeof companiesRaw)[number];
  type IndicatorShape = (typeof indicators)[number];
  const operational =
    filterOperationalCompanies<CompanyRawShape>(companiesRaw);
  const operationalIds = operational.map((c) => c.id);
  const indicatorIds = indicators.map((i: IndicatorShape) => i.id);

  const values =
    operationalIds.length === 0 || indicatorIds.length === 0
      ? []
      : await prisma.indicatorValue.findMany({
          where: {
            organizationId: orgId,
            period,
            companyId: { in: operationalIds },
            indicatorId: { in: indicatorIds },
          },
          select: {
            companyId: true,
            indicatorId: true,
            value: true,
            status: true,
          },
        });

  type ValueShape = {
    companyId: string;
    indicatorId: string;
    value: number | null;
    status: HeatMapCell["status"];
  };
  const cells: HeatMapCell[] = values.map((v: ValueShape) => ({
    companyId: v.companyId,
    indicatorId: v.indicatorId,
    value: v.value,
    status: v.status,
  }));

  // Composite score per company. Shared helper (see composite-score.ts)
  // — identical contract used by HeatMap. `companyIds` arg requested so
  // EVERY operational sub-co gets a row even with no IndicatorValues
  // (board-deck table renders one row per sub-co).
  const compositeByCompany = computeCompositeByCompany(
    cells,
    operational.map((c) => c.id),
  );

  // Status counts per company.
  type StatusCounts = { green: number; amber: number; red: number; unknown: number };
  const countsByCompany = new Map<string, StatusCounts>();
  for (const co of operational) {
    countsByCompany.set(co.id, { green: 0, amber: 0, red: 0, unknown: 0 });
  }
  for (const c of cells) {
    if (c.isSubgroupRollup) continue;
    const counts = countsByCompany.get(c.companyId);
    if (counts) counts[c.status] += 1;
  }

  // Alert matches — Phase 7.E C6 v2 reads org-tuned thresholds from
  // `settings.alertThresholds`; defaults match v1 behavior when unset.
  const alertThresholds = readAlertThresholdsFromOrgSettings(org.settings);
  const matches = evaluateAlertRules(
    DEFAULT_ALERT_RULES,
    {
      companies: operational.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        industry: c.industry,
      })),
      indicators: indicators.map((i: IndicatorShape) => ({ id: i.id, code: i.code })),
      cells,
    },
    alertThresholds,
  );
  const matchesBySeverity: Record<AlertSeverity, AlertMatch[]> = {
    critical: [],
    warning: [],
    info: [],
  };
  for (const m of matches) matchesBySeverity[m.severity].push(m);

  // Cell lookup for status grid.
  const cellByKey = new Map<string, HeatMapCell>();
  for (const c of cells) cellByKey.set(`${c.companyId}|${c.indicatorId}`, c);

  const idToCode = new Map(operational.map((c) => [c.id, c.code]));
  const totalCells = operational.length * indicators.length;
  const totalGreen = Array.from(countsByCompany.values()).reduce(
    (a, b) => a + b.green,
    0,
  );
  const totalAmber = Array.from(countsByCompany.values()).reduce(
    (a, b) => a + b.amber,
    0,
  );
  const totalRed = Array.from(countsByCompany.values()).reduce(
    (a, b) => a + b.red,
    0,
  );

  const generatedAt = new Date().toISOString();

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
          <PrintButton />
        </div>
      </header>

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
                        {m.ruleName}
                      </div>
                      <div>{m.message}</div>
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

/**
 * Phase 7.E C3 v2 — PPTX export for the Board Deck.
 *
 * Companion to `/budgeting/board-deck` page. Calls the same shared
 * `buildBoardSnapshot` helper, then serializes the snapshot into a
 * 4-slide widescreen presentation:
 *   1. Cover (org name, period, generated, holding totals)
 *   2. Composite scores per operational sub-co (table)
 *   3. Active alerts grouped by severity (text blocks)
 *   4. Status grid (colored cell-table mirror of the page's grid)
 *
 * Localization: same `getTranslations("terminal")` + `industries`
 * scopes the page uses; rule names + messages render in the user's
 * locale (resolved by next-intl middleware).
 *
 * Auth: `requireAuth` — any authenticated org member can export.
 *
 * Runtime: `nodejs` — pptxgenjs uses Node Buffer + JSZip; edge runtime
 * doesn't support either.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import PptxGenJS from "pptxgenjs";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { parsePeriod, PeriodParseError } from "@/lib/risk/periods";
import {
  DEFAULT_ALERT_RULE_IDS,
  type AlertSeverity,
} from "@/lib/risk/alert-rules";
import {
  localizeAlertMessageParams,
  type IndustryTranslator,
} from "@/lib/risk/alert-message-i18n";
import { buildBoardSnapshot } from "@/lib/board-deck/build-snapshot";

export const runtime = "nodejs";

const STATUS_HEX: Record<string, string> = {
  green: "00D4AA",
  amber: "FFB800",
  red: "FF4757",
  unknown: "1A2330",
};

const BAND_FILL: Record<string, string> = {
  green: "00D4AA",
  amber: "FFB800",
  red: "FF4757",
  unknown: "1A2330",
};

const SEVERITY_ORDER: AlertSeverity[] = ["critical", "warning", "info"];

const SEVERITY_HEX: Record<AlertSeverity, string> = {
  critical: "FF4757",
  warning: "FFB800",
  info: "00B4D8",
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;
  const { orgId } = auth;

  const rawPeriod =
    req.nextUrl.searchParams.get("period") ??
    String(new Date().getUTCFullYear());
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json(
        { error: "Invalid period", message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }
  const period = rawPeriod;

  const snapshot = await buildBoardSnapshot({ orgId, period });
  if (!snapshot) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 },
    );
  }

  const tTerminal = await getTranslations("terminal");
  const tIndustries = (await getTranslations(
    "industries",
  )) as unknown as IndustryTranslator;

  const body = await renderBoardDeckPptx(snapshot, tTerminal, tIndustries);

  const filename = `board-deck-${snapshot.org.slug}-${period}.pptx`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function renderBoardDeckPptx(
  snap: Awaited<ReturnType<typeof buildBoardSnapshot>> & object,
  tTerminal: Awaited<ReturnType<typeof getTranslations>>,
  tIndustries: IndustryTranslator,
): Promise<ArrayBuffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `Board Snapshot — ${snap.org.name} — ${snap.period}`;
  pptx.author = "BudgetPro Risk Terminal";
  pptx.company = snap.org.name;

  // Slide 1 — Cover
  const cover = pptx.addSlide();
  cover.background = { color: "0B0F14" };
  cover.addText("BOARD SNAPSHOT", {
    x: 0.5,
    y: 0.5,
    w: 12.3,
    h: 0.4,
    fontFace: "Inter",
    fontSize: 12,
    color: "9CA3AF",
    bold: true,
    charSpacing: 4,
  });
  cover.addText(snap.org.name, {
    x: 0.5,
    y: 1.0,
    w: 12.3,
    h: 1.0,
    fontFace: "Inter",
    fontSize: 36,
    color: "FFFFFF",
    bold: true,
  });
  cover.addText(
    `Period ${snap.period} · Generated ${snap.generatedAt.replace("T", " ").slice(0, 19)}Z`,
    {
      x: 0.5,
      y: 2.0,
      w: 12.3,
      h: 0.4,
      fontFace: "Inter",
      fontSize: 14,
      color: "9CA3AF",
    },
  );

  // KPI strip
  const kpis: Array<{ label: string; value: string }> = [
    { label: "Operational sub-cos", value: String(snap.totals.operational) },
    { label: "Indicators", value: String(snap.totals.indicators) },
    { label: "Cells", value: String(snap.totals.cells) },
    {
      label: "Green / Amber / Red",
      value: `${snap.totals.green} / ${snap.totals.amber} / ${snap.totals.red}`,
    },
  ];
  const kpiW = 2.9;
  const kpiGap = 0.2;
  const kpiTotal = kpis.length * kpiW + (kpis.length - 1) * kpiGap;
  const kpiStartX = (13.33 - kpiTotal) / 2;
  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i];
    const kx = kpiStartX + i * (kpiW + kpiGap);
    cover.addShape("rect", {
      x: kx,
      y: 3.5,
      w: kpiW,
      h: 1.5,
      fill: { color: "111827" },
      line: { color: "374151", width: 0.75 },
    });
    cover.addText(k.label, {
      x: kx,
      y: 3.6,
      w: kpiW,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 10,
      color: "9CA3AF",
      align: "center",
      charSpacing: 2,
    });
    cover.addText(k.value, {
      x: kx,
      y: 3.95,
      w: kpiW,
      h: 1.0,
      fontFace: "Courier New",
      fontSize: 28,
      color: "FFFFFF",
      align: "center",
      bold: true,
    });
  }
  cover.addText(
    "Confidential — intended for board / executive recipients only.",
    {
      x: 0.5,
      y: 6.9,
      w: 12.3,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 9,
      color: "6B7280",
      italic: true,
    },
  );

  // Slide 2 — Composite scores table
  const scoresSlide = pptx.addSlide();
  scoresSlide.background = { color: "0B0F14" };
  scoresSlide.addText(`Composite scores (${snap.totals.operational})`, {
    x: 0.5,
    y: 0.3,
    w: 12.3,
    h: 0.5,
    fontFace: "Inter",
    fontSize: 18,
    color: "FFFFFF",
    bold: true,
  });
  type Cell = { text: string; options: Record<string, unknown> };
  const headerOpts = {
    fill: { color: "111827" },
    color: "9CA3AF",
    bold: true,
    fontFace: "Inter",
    fontSize: 10,
  };
  const headerRow: Cell[] = [
    { text: "Code", options: headerOpts },
    { text: "Name", options: headerOpts },
    { text: "Industry", options: headerOpts },
    { text: "Score", options: { ...headerOpts, align: "right" } },
    { text: "Band", options: { ...headerOpts, align: "center" } },
    { text: "G / A / R / U", options: { ...headerOpts, align: "right" } },
  ];
  const bodyRows: Cell[][] = snap.operational.map((co) => {
    const composite = snap.compositeByCompany.get(co.id);
    const band: string = composite ? composite.band : "unknown";
    const score = composite?.score ?? null;
    const counts = snap.countsByCompany.get(co.id);
    const cellOpts = {
      fontFace: "Inter",
      fontSize: 10,
      color: "E5E7EB",
    };
    return [
      {
        text: co.code,
        options: { ...cellOpts, fontFace: "Courier New", color: "FFFFFF" },
      },
      { text: co.name, options: cellOpts },
      { text: co.industry || "—", options: cellOpts },
      {
        text: score === null ? "—" : String(score),
        options: {
          ...cellOpts,
          align: "right",
          fontFace: "Courier New",
        },
      },
      {
        text: band.toUpperCase(),
        options: {
          ...cellOpts,
          fill: { color: BAND_FILL[band] ?? BAND_FILL.unknown },
          color: band === "amber" ? "111827" : "FFFFFF",
          align: "center",
          bold: true,
        },
      },
      {
        text: counts
          ? `${counts.green} / ${counts.amber} / ${counts.red} / ${counts.unknown}`
          : "—",
        options: {
          ...cellOpts,
          align: "right",
          fontFace: "Courier New",
          color: "9CA3AF",
        },
      },
    ];
  });
  scoresSlide.addTable([headerRow, ...bodyRows], {
    x: 0.5,
    y: 0.95,
    w: 12.3,
    colW: [1.4, 4.0, 2.0, 1.2, 1.5, 2.2],
    border: { type: "solid", color: "374151", pt: 0.5 },
    fontFace: "Inter",
    fontSize: 10,
  });

  // Slide 3 — Active alerts
  const alertsSlide = pptx.addSlide();
  alertsSlide.background = { color: "0B0F14" };
  alertsSlide.addText(`Active alerts (${snap.matches.length})`, {
    x: 0.5,
    y: 0.3,
    w: 12.3,
    h: 0.5,
    fontFace: "Inter",
    fontSize: 18,
    color: "FFFFFF",
    bold: true,
  });
  if (snap.matches.length === 0) {
    alertsSlide.addText("✓ No alerts triggered — all systems green.", {
      x: 0.5,
      y: 3.0,
      w: 12.3,
      h: 1.5,
      fontFace: "Inter",
      fontSize: 28,
      color: "00D4AA",
      align: "center",
      bold: true,
    });
  } else {
    let cursorY = 1.0;
    for (const sev of SEVERITY_ORDER) {
      const list = snap.matchesBySeverity[sev];
      if (list.length === 0) continue;
      alertsSlide.addText(`${sev.toUpperCase()} (${list.length})`, {
        x: 0.5,
        y: cursorY,
        w: 12.3,
        h: 0.3,
        fontFace: "Inter",
        fontSize: 11,
        color: SEVERITY_HEX[sev],
        bold: true,
        charSpacing: 3,
      });
      cursorY += 0.35;
      for (const m of list) {
        // Localize rule name + message body the same way the page does.
        let ruleLabel = m.ruleName;
        if (DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) {
          try {
            ruleLabel = tTerminal(`alerts.rules.${m.ruleId}` as never);
          } catch {
            // fall through
          }
        }
        let body = m.message;
        if (m.messageKey && DEFAULT_ALERT_RULE_IDS.has(m.ruleId)) {
          try {
            const localizedParams = localizeAlertMessageParams(
              m.messageParams,
              tIndustries,
            );
            body = tTerminal(
              m.messageKey as never,
              localizedParams as never,
            );
          } catch {
            // fall through
          }
        }
        const affected = m.affectedCompanyIds
          .map((id) => snap.idToCode.get(id) ?? id.slice(0, 8))
          .join(", ");
        const composed =
          `[${ruleLabel}]  ${body}` +
          (affected ? `\n    ${affected}` : "");
        alertsSlide.addText(composed, {
          x: 0.7,
          y: cursorY,
          w: 12.1,
          h: 0.5,
          fontFace: "Inter",
          fontSize: 9,
          color: "E5E7EB",
        });
        cursorY += 0.55;
      }
      cursorY += 0.15;
    }
  }

  // Slide 4 — Status grid
  const gridSlide = pptx.addSlide();
  gridSlide.background = { color: "0B0F14" };
  gridSlide.addText("Status grid (companies × indicators)", {
    x: 0.5,
    y: 0.3,
    w: 12.3,
    h: 0.5,
    fontFace: "Inter",
    fontSize: 18,
    color: "FFFFFF",
    bold: true,
  });
  const gridHeader: Cell[] = [
    {
      text: "CO \\ IND",
      options: {
        fill: { color: "111827" },
        color: "9CA3AF",
        bold: true,
        fontFace: "Courier New",
        fontSize: 8,
      },
    },
    ...snap.indicators.map((ind) => ({
      text: ind.code.replace(/^IND_/, ""),
      options: {
        fill: { color: "111827" },
        color: "9CA3AF",
        bold: true,
        fontFace: "Courier New",
        fontSize: 7,
        align: "center" as const,
      },
    })),
  ];
  const gridBody: Cell[][] = snap.operational.map((co) => {
    const row: Cell[] = [
      {
        text: co.code,
        options: {
          fill: { color: "111827" },
          color: "E5E7EB",
          fontFace: "Courier New",
          fontSize: 8,
          bold: true,
        },
      },
    ];
    for (const ind of snap.indicators) {
      const cell = snap.cellByKey.get(`${co.id}|${ind.id}`);
      const status = cell?.status ?? "unknown";
      row.push({
        text: "",
        options: {
          fill: { color: STATUS_HEX[status] ?? STATUS_HEX.unknown },
        },
      });
    }
    return row;
  });
  // Column widths: first col wider for the code, rest evenly distributed
  const indW = (12.3 - 1.2) / Math.max(1, snap.indicators.length);
  const colW = [1.2, ...snap.indicators.map(() => indW)];
  gridSlide.addTable([gridHeader, ...gridBody], {
    x: 0.5,
    y: 0.95,
    w: 12.3,
    colW,
    border: { type: "solid", color: "374151", pt: 0.4 },
    rowH: 0.22,
  });
  // Hint band/legend at the bottom
  gridSlide.addText(
    "Legend  ·  green  ·  amber  ·  red  ·  unknown",
    {
      x: 0.5,
      y: 6.9,
      w: 12.3,
      h: 0.3,
      fontFace: "Inter",
      fontSize: 9,
      color: "6B7280",
      italic: true,
    },
  );
  // colored swatches just above the legend label
  const swatchY = 6.6;
  const swatchKeys: string[] = ["green", "amber", "red", "unknown"];
  for (let i = 0; i < swatchKeys.length; i++) {
    gridSlide.addShape("rect", {
      x: 1.7 + i * 2.0,
      y: swatchY,
      w: 0.3,
      h: 0.18,
      fill: { color: STATUS_HEX[swatchKeys[i]] },
      line: { color: "374151", width: 0.5 },
    });
  }
  const out = await pptx.write({ outputType: "arraybuffer" });
  return out as ArrayBuffer;
}

"use client";

/**
 * Tier 3 closer — Excel export companion to PDF.
 *
 * Listens for `terminal:export-xlsx`, loads the shared snapshot on demand,
 * then builds a 3-sheet workbook (Summary / Matrix / Today's Brief)
 * the PDF uses, and triggers a download.
 *
 * Lazy-imports the `xlsx` package so the ~600KB writer doesn't ship
 * to every session — most users never click Excel.
 */

import { useEffect } from "react";
import { hasEvidencedValue } from "@/lib/risk/heatmap-matrix";
import { useLocale, useTranslations } from "next-intl";
import { ensureMatrix } from "../hooks/use-matrix";
import {
  ensureCompanies,
  buildRiskTagsByCompanyId,
} from "../hooks/use-companies";
import { useTerminalStore } from "../store/terminalStore";
import { getLogger } from "@/lib/log";

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("terminal:export-xlsx");
import { computeCompositeByCompany, MIN_SCORING_CELLS } from "@/lib/risk/composite-score";

export function ExportXlsxTrigger() {
  const locale = useLocale() as "en" | "ru" | "az";
  // 2026-07-31 i18n sweep — the workbook used to be English-only regardless
  // of locale (the component read `locale` purely to format the date), so an
  // Azerbaijani user exported an English spreadsheet.
  const t = useTranslations("terminal");
  const tStatus = useTranslations("terminal.status");
  const alertMatches = useTerminalStore((s) => s.alertMatches);
  const selectedPeriod = useTerminalStore((s) => s.selectedPeriod);

  useEffect(() => {
    const handler = async () => {
      try {
        const [matrix, companyTree] = await Promise.all([
          ensureMatrix(selectedPeriod),
          ensureCompanies().catch(() => null),
        ]);
        const XLSX = await import("xlsx");

        // Composites for the summary sheet (same calc as PDF). Phase 7.N —
        // apply the per-company riskTag penalty from the shared
        // `/api/companies` source so the exported composites match the
        // on-screen terminal; the matrix payload carries no riskTags.
        const riskTagsByCompanyId = companyTree
          ? buildRiskTagsByCompanyId(companyTree)
          : undefined;
        // 11.71 — an exported composite must equal the one on the screen it
        // was exported from. `matrix.cells` carry the `scoring` flag stamped by
        // the matrix API (constants + the informational legal/compliance
        // indicators the owner directed out of the financial score) and
        // `computeCompositeScore` enforces it, so no filter belongs here.
        const compositesById = computeCompositeByCompany(
          matrix.cells,
          undefined,
          riskTagsByCompanyId,
        );

        // ---- Sheet 1: Summary ----
        const orgName =
          document.querySelector("header span")?.textContent?.trim() || "FO Holding";
        const generatedAt = new Date().toLocaleString(
          locale === "az" ? "az" : locale === "ru" ? "ru" : "en",
        );
        let green = 0,
          amber = 0,
          red = 0,
          unknown = 0;
        for (const c of matrix.cells) {
          if (c.status === "green") green += 1;
          else if (c.status === "amber") amber += 1;
          else if (c.status === "red") red += 1;
          else unknown += 1;
        }
        const summaryRows = [
          [t("export.organization"), orgName],
          [t("export.period"), matrix.period],
          [t("export.generated"), generatedAt],
          [],
          [t("export.status"), t("export.count")],
          [tStatus("green"), green],
          [tStatus("amber"), amber],
          [tStatus("red"), red],
          [t("export.unknownMissing"), unknown],
          [],
          [
            t("export.company"),
            t("export.code"),
            t("export.composite"),
            t("export.contributingTotal"),
          ],
          // 11.81 — `s?.score ?? ""` wrote an EMPTY cell, indistinguishable
          // from "not computed", which broke the client's own AVERAGE/MIN
          // invisibly and sorted to whichever end Excel picked. This is the
          // one export a client re-sorts themselves. A text token is never
          // silently averaged, and the coverage column is now always
          // populated (it was also "" for a null score).
          ...matrix.companies.map((co) => {
            const s = compositesById.get(co.id);
            return [
              co.name,
              co.code,
              s && s.score !== null ? s.score : t("composite.notScoredCell"),
              s ? `${s.contributingCount}/${s.totalCount}` : "0/0",
            ];
          }),
          [],
          [t("export.notScoredNote", { min: MIN_SCORING_CELLS })],
        ];

        // ---- Sheet 2: Matrix grid (companies × indicators) ----
        const coById = new Map(matrix.companies.map((c) => [c.id, c]));
        const indById = new Map(matrix.indicators.map((i) => [i.id, i]));
        const cellMap = new Map<string, (typeof matrix.cells)[number]>();
        for (const c of matrix.cells) {
          cellMap.set(`${c.companyId}|${c.indicatorId}`, c);
        }
        const matrixHeader = [
          t("export.company"),
          ...matrix.indicators.map((i) => i.code),
        ];
        const matrixValueRows: (string | number)[][] = matrix.companies.map(
          (co) => {
            const row: (string | number)[] = [`${co.code} — ${co.name}`];
            for (const ind of matrix.indicators) {
              const cell = cellMap.get(`${co.id}|${ind.id}`);
              // 2026-08-04 audit — Number.isFinite passes an unscored row's
              // stored 0, so this sheet — the one clients re-sort, average and
              // chart themselves — carried fabricated zeros indistinguishable
              // from measured ones. Blank is the honest cell: Excel skips it in
              // AVERAGE and it cannot win a MIN.
              row.push(
                cell && hasEvidencedValue(cell.status, cell.value) ? cell.value : "",
              );
            }
            return row;
          },
        );
        const matrixStatusRows: string[][] = matrix.companies.map((co) => {
          const row: string[] = [`${co.code} — ${co.name}`];
          for (const ind of matrix.indicators) {
            const cell = cellMap.get(`${co.id}|${ind.id}`);
            row.push(cell?.status ?? "");
          }
          return row;
        });

        // ---- Sheet 3: Today's Brief ----
        const worst: Array<{ companyCode: string; indicatorCode: string; value: number; unit: string }> = [];
        const moverPool: Array<{ companyCode: string; indicatorCode: string; deltaPct: number }> = [];
        for (const cell of matrix.cells) {
          const co = coById.get(cell.companyId);
          const ind = indById.get(cell.indicatorId);
          if (!co || !ind) continue;
          if (cell.status === "red" && Number.isFinite(cell.value)) {
            worst.push({
              companyCode: co.code,
              indicatorCode: ind.code,
              value: cell.value,
              unit: ind.unit,
            });
          }
          if (cell.sparkline && cell.sparkline.length >= 2) {
            const vals = cell.sparkline.filter(
              (v): v is number => typeof v === "number" && Number.isFinite(v),
            );
            if (vals.length >= 2 && Math.abs(vals[0]) > 0.0001) {
              const delta = vals[vals.length - 1] - vals[0];
              const deltaPct = (delta / Math.abs(vals[0])) * 100;
              if (Number.isFinite(deltaPct)) {
                moverPool.push({
                  companyCode: co.code,
                  indicatorCode: ind.code,
                  deltaPct,
                });
              }
            }
          }
        }
        worst.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        moverPool.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

        const briefRows: (string | number)[][] = [
          [t("export.briefWorst")],
          [
            t("export.company"),
            t("export.indicator"),
            t("export.value"),
            t("export.unit"),
          ],
          ...worst
            .slice(0, 3)
            .map((w) => [w.companyCode, w.indicatorCode, w.value, w.unit]),
          [],
          [t("export.briefMovers")],
          [t("export.company"), t("export.indicator"), t("export.deltaPct")],
          ...moverPool
            .slice(0, 3)
            .map((m) => [
              m.companyCode,
              m.indicatorCode,
              Number(m.deltaPct.toFixed(2)),
            ]),
          [],
          [t("export.activeAlerts")],
          [t("export.ruleId"), t("export.message")],
          ...(alertMatches ?? [])
            .slice(0, 10)
            .map((a) => [a.ruleId, a.message]),
        ];

        const wb = XLSX.utils.book_new();
        // Excel caps sheet names at 31 chars and rejects []:*?/\ — the
        // localized names are short, but clamp defensively so a future
        // translation can't produce an unopenable workbook.
        const sheetName = (raw: string) =>
          raw.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet(summaryRows),
          sheetName(t("export.sheetSummary")),
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixValueRows]),
          sheetName(t("export.sheetMatrixValues")),
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixStatusRows]),
          sheetName(t("export.sheetMatrixStatus")),
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet(briefRows),
          sheetName(t("export.sheetBrief")),
        );

        const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        const blob = new Blob([wbout], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `risk-matrix-${matrix.period}-${Date.now()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        log.error("XLSX export failed", {
          period: selectedPeriod,
          err: err instanceof Error ? err.message : String(err),
        });
        alert(
          t("export.xlsxFailed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    };
    window.addEventListener("terminal:export-xlsx", handler);
    return () => window.removeEventListener("terminal:export-xlsx", handler);
  }, [selectedPeriod, locale, alertMatches, t, tStatus]);

  return null;
}

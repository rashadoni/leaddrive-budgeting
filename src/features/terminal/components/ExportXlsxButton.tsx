"use client";

/**
 * Tier 3 closer — Excel export companion to PDF.
 *
 * Listens for `terminal:export-xlsx`, builds a 3-sheet workbook
 * (Summary / Matrix / Today's Brief) from the same matrix snapshot
 * the PDF uses, and triggers a download.
 *
 * Lazy-imports the `xlsx` package so the ~600KB writer doesn't ship
 * to every session — most users never click Excel.
 */

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useMatrix } from "../hooks/use-matrix";
import { useTerminalStore } from "../store/terminalStore";
import { getLogger } from "@/lib/log";

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("terminal:export-xlsx");
import { computeCompositeByCompany } from "@/lib/risk/composite-score";

export function ExportXlsxTrigger() {
  const { matrix } = useMatrix();
  const locale = useLocale() as "en" | "ru" | "az";
  const alertMatches = useTerminalStore((s) => s.alertMatches);

  useEffect(() => {
    const handler = async () => {
      if (!matrix) {
        alert("Matrix not loaded yet");
        return;
      }
      try {
        const XLSX = await import("xlsx");

        // Composites for the summary sheet (same calc as PDF).
        const compositesById = computeCompositeByCompany(matrix.cells);

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
          ["Organization", orgName],
          ["Period", matrix.period],
          ["Generated", generatedAt],
          [],
          ["Status", "Count"],
          ["Green", green],
          ["Amber", amber],
          ["Red", red],
          ["Unknown / missing", unknown],
          [],
          ["Company", "Code", "Composite", "Contributing / Total"],
          ...matrix.companies.map((co) => {
            const s = compositesById.get(co.id);
            return [
              co.name,
              co.code,
              s?.score ?? "",
              s ? `${s.contributingCount}/${s.totalCount}` : "",
            ];
          }),
        ];

        // ---- Sheet 2: Matrix grid (companies × indicators) ----
        const coById = new Map(matrix.companies.map((c) => [c.id, c]));
        const indById = new Map(matrix.indicators.map((i) => [i.id, i]));
        const cellMap = new Map<string, (typeof matrix.cells)[number]>();
        for (const c of matrix.cells) {
          cellMap.set(`${c.companyId}|${c.indicatorId}`, c);
        }
        const matrixHeader = [
          "Company",
          ...matrix.indicators.map((i) => i.code),
        ];
        const matrixValueRows: (string | number)[][] = matrix.companies.map(
          (co) => {
            const row: (string | number)[] = [`${co.code} — ${co.name}`];
            for (const ind of matrix.indicators) {
              const cell = cellMap.get(`${co.id}|${ind.id}`);
              row.push(cell && Number.isFinite(cell.value) ? cell.value : "");
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
          ["Top-3 worst (red)"],
          ["Company", "Indicator", "Value", "Unit"],
          ...worst
            .slice(0, 3)
            .map((w) => [w.companyCode, w.indicatorCode, w.value, w.unit]),
          [],
          ["Top-3 movers (12-month delta %)"],
          ["Company", "Indicator", "Delta %"],
          ...moverPool
            .slice(0, 3)
            .map((m) => [
              m.companyCode,
              m.indicatorCode,
              Number(m.deltaPct.toFixed(2)),
            ]),
          [],
          ["Active alerts"],
          ["Rule ID", "Message"],
          ...(alertMatches ?? [])
            .slice(0, 10)
            .map((a) => [a.ruleId, a.message]),
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet(summaryRows),
          "Summary",
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixValueRows]),
          "Matrix (values)",
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixStatusRows]),
          "Matrix (status)",
        );
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet(briefRows),
          "Today's Brief",
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
          period: matrix?.period,
          err: err instanceof Error ? err.message : String(err),
        });
        alert(
          "XLSX export failed: " +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    };
    window.addEventListener("terminal:export-xlsx", handler);
    return () => window.removeEventListener("terminal:export-xlsx", handler);
  }, [matrix, locale, alertMatches]);

  return null;
}

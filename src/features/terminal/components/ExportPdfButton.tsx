"use client";

/**
 * Phase 7.G CLI Tier 3 — Risk Matrix PDF export trigger.
 *
 * Listens for `terminal:export-pdf` event (fired by the Export hotkey
 * button), builds the PDF document from the current matrix snapshot,
 * and triggers a download via @react-pdf/renderer's `pdf().toBlob()`.
 *
 * Per-request lazy import — keeps the @react-pdf bundle out of initial
 * client load (~150KB savings) since most sessions never export.
 */

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useMatrix } from "../hooks/use-matrix";
import { useTerminalStore } from "../store/terminalStore";
import { getLogger } from "@/lib/log";

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("terminal:export-pdf");
import { computeCompositeByCompany } from "@/lib/risk/composite-score";

export function ExportPdfTrigger() {
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
        // Lazy-load to keep export deps out of the initial bundle.
        const [{ pdf }, { RiskMatrixPdfDoc }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("./RiskMatrixPdf"),
        ]);

        // Build composites from cells.
        const compositesById = computeCompositeByCompany(matrix.cells);
        const composites = matrix.companies.map((co) => {
          const s = compositesById.get(co.id);
          return {
            code: co.code,
            name: co.name,
            score: s?.score ?? null,
            contributingCount: s?.contributingCount ?? 0,
            totalCount: s?.totalCount ?? 0,
          };
        });

        // Today's Brief: top-3 worst red + movers + alerts.
        const coById = new Map(matrix.companies.map((c) => [c.id, c.code]));
        const indById = new Map(matrix.indicators.map((i) => [i.id, i]));
        const worst: Array<{ companyCode: string; indicatorCode: string; value: number; unit: string }> = [];
        const moverPool: Array<{ companyCode: string; indicatorCode: string; deltaPct: number }> = [];
        for (const cell of matrix.cells) {
          const co = coById.get(cell.companyId);
          const ind = indById.get(cell.indicatorId);
          if (!co || !ind) continue;
          if (cell.status === "red" && Number.isFinite(cell.value)) {
            worst.push({ companyCode: co, indicatorCode: ind.code, value: cell.value, unit: ind.unit });
          }
          if (cell.sparkline && cell.sparkline.length >= 2) {
            const vals = cell.sparkline.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
            if (vals.length >= 2 && Math.abs(vals[0]) > 0.0001) {
              const delta = vals[vals.length - 1] - vals[0];
              const deltaPct = (delta / Math.abs(vals[0])) * 100;
              if (Number.isFinite(deltaPct)) {
                moverPool.push({ companyCode: co, indicatorCode: ind.code, deltaPct });
              }
            }
          }
        }
        worst.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        moverPool.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
        const alerts = (alertMatches ?? []).slice(0, 3).map((a) => ({ ruleId: a.ruleId, message: a.message }));

        const orgName = document.querySelector('header span')?.textContent?.trim() || "FO Holding";
        const generatedAt = new Date().toLocaleString(locale === "az" ? "az" : locale === "ru" ? "ru" : "en");

        const doc = (
          <RiskMatrixPdfDoc
            orgName={orgName}
            period={matrix.period}
            generatedAt={generatedAt}
            language={locale}
            companies={matrix.companies}
            indicators={matrix.indicators}
            cells={matrix.cells.map((c) => ({
              companyId: c.companyId,
              indicatorId: c.indicatorId,
              value: c.value,
              // matrix payload status is one of green/amber/red/unknown;
              // ('missing' is a UI-only placeholder for absent cells).
              status: c.status as "green" | "amber" | "red" | "unknown",
              sparkline: c.sparkline,
            }))}
            composites={composites}
            brief={{
              worst: worst.slice(0, 3),
              movers: moverPool.slice(0, 3),
              alerts,
            }}
          />
        );

        const blob = await pdf(doc).toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `risk-matrix-${matrix.period}-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        log.error("PDF export failed", {
          period: matrix?.period,
          err: err instanceof Error ? err.message : String(err),
        });
        alert("PDF export failed: " + (err instanceof Error ? err.message : String(err)));
      }
    };
    window.addEventListener("terminal:export-pdf", handler);
    return () => window.removeEventListener("terminal:export-pdf", handler);
  }, [matrix, locale, alertMatches]);

  return null;
}

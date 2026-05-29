/**
 * Compliance Hub data-model types — extracted from ComplianceHub.tsx
 * (Phase 8 D1 2026-05-29) so the main component and the presentational
 * table/badge subcomponents (compliance-subcomponents.tsx) share one source
 * without an import cycle. `EntityComplianceData` is re-exported from
 * ComplianceHub.tsx for the page + test that import it from there.
 */

export interface FindingComment {
  at: string;
  author: string;
  text: string;
}

export interface FindingMutation {
  at: string;
  by: string;
  action: "close" | "reopen" | "assign" | "comment" | "deadline";
  value?: string;
}

export interface AuditFinding {
  severity: string;
  audit: string;
  status: string;
  grouping: string;
  findingStatusJan: string;
  // Phase 8 E1 — write-back overlay fields. Optional; present after
  // PATCH /api/admin/compliance/finding flips them.
  closed?: boolean;
  closedAt?: string;
  closedBy?: string;
  // Phase 8 E2 — drill-down modal fields. Server emits these whenever
  // assign / comment / close PATCHes have fired against the finding.
  assignedTo?: string;
  comments?: FindingComment[];
  mutations?: FindingMutation[];
  // Phase 8 E1 completion (2026-05-29) — target completion date set via
  // the `deadline` action (ISO YYYY-MM-DD).
  deadline?: string;
}

/** Phase 8 E1 completion — the write-back actions the modal can fire
 *  beyond close/reopen. `assign` + `deadline` carry a single string
 *  value; `comment` appends to the thread. */
export type ManageAction = "assign" | "comment" | "deadline";

export interface CourtCase {
  date: string;
  court: string;
  claimant: string;
  defendant: string;
  disputeType: string;
  status: string;
  closed: boolean;
}

export interface AuditData {
  summary: Record<string, number | undefined>;
  items: AuditFinding[];
  source?: string;
  importedAt?: string;
}

export interface CourtData {
  summary: Record<string, number | undefined>;
  cases: CourtCase[];
  source?: string;
  importedAt?: string;
}

export interface EntityComplianceData {
  /** Phase 8 E1 — companyId needed for the per-finding write-back PATCH. */
  id: string;
  code: string;
  name: string;
  industry: string;
  auditFindings: AuditData | null;
  courtDisputes: CourtData | null;
}

/**
 * Phase 7.H F4.v2.3 — manual data-entry admin route.
 *
 * Two tabs:
 *  - Operational KPI : 13 metrics × all companies (`OperationalFact` writes)
 *  - ESG disclosure  : 4 indicators × all companies (overrides modeled-generic)
 *
 * Auth: middleware gates the route group; underlying APIs enforce
 * manager+ on POST. UI renders for everyone but mutations 403 on
 * non-manager roles.
 */

import { DataEntryAdmin } from "@/features/budgeting/components/DataEntryAdmin"

export const metadata = {
  title: "Data Entry · BudgetPro",
}

export default function DataEntryAdminPage() {
  return <DataEntryAdmin />
}

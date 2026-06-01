/**
 * Phase 7.K — admin "Data Sources Catalog" page.
 *
 * Client-facing overview of every external data feed: what each source
 * is, why the holding cares, which indicators it powers, a live sample
 * value with plain-language interpretation. Designed to be openable
 * during a client demo to explain "where does this number come from".
 *
 * Source of truth: `src/lib/intel/sources-catalog.ts` — adding a new
 * adapter requires one entry there + this page auto-renders it.
 */
import { DataSourcesCatalogView } from "@/features/admin/components/DataSourcesCatalogView"

export const metadata = {
  title: "Data Sources · Admin · BudgetPro",
}

export default function DataSourcesPage() {
  return <DataSourcesCatalogView />
}

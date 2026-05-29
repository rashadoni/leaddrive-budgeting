/**
 * Data-entry admin shared types — extracted from DataEntryAdmin.tsx (Phase 8
 * D1 2026-05-29). `CompanyRow` is referenced by both the main file
 * (flattenCompanies + the two tabs) and the field components in
 * data-entry-fields.tsx, so it lives here to keep the import DAG acyclic
 * (types ← {DataEntryAdmin, data-entry-fields}).
 */

export interface CompanyRow {
  id: string
  code: string
  name: string
  /**
   * Nested descendants returned by `/api/companies` (roots + 2 levels
   * of children). The data-entry dropdown must walk this tree so users
   * can pick operational leaves (AZSEKER-EDEN, AAC-MAIN, etc.), not
   * just the top-level holding parents (AZMADE, AZSEKER). 2026-05-16
   * parity with the fc9c7fb fix that closed the same bug on the
   * budgeting filter dropdown.
   */
  children?: CompanyRow[]
}

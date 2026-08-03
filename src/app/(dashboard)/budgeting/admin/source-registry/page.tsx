/**
 * Phase L4 — admin route for the drift-watchdog source registry.
 * CRUDs PostgreSQL-backed registry metadata via the API; admin-only.
 */
import { SourceRegistryAdmin } from "@/features/admin/components/SourceRegistryAdmin";

export const metadata = {
  title: "Source Registry · BudgetPro",
};

export default function SourceRegistryAdminPage() {
  return <SourceRegistryAdmin />;
}

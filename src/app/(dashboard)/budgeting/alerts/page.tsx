import { redirect } from "next/navigation";

/**
 * Index redirect for the Alerts section.
 *
 * The sidebar links to `/budgeting/alerts`, but the only alerts surface is
 * the history feed at `/budgeting/alerts/history`. Before this page existed
 * the nav entry 404'd (found in the 2026-06-30 prod UX audit, P0-2). Keep the
 * clean `/budgeting/alerts` URL and land users on the feed.
 */
export default function AlertsIndexPage() {
  redirect("/budgeting/alerts/history");
}

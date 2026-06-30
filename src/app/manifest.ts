import type { MetadataRoute } from "next";

/**
 * PWA web app manifest (App Router file-based metadata).
 *
 * Added in the 2026-06-30 UX audit (P0-3): prod was missing favicon, app
 * icon, and manifest entirely — every page logged a `/favicon.ico` 404 and
 * the browser tab showed a blank icon. Next serves this at
 * `/manifest.webmanifest` and injects `<link rel="manifest">` automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BudgetPro",
    short_name: "BudgetPro",
    description: "Enterprise Budgeting & Financial Planning",
    start_url: "/",
    display: "standalone",
    background_color: "#001E3C",
    theme_color: "#001E3C",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

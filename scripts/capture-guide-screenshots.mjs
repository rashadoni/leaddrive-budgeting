#!/usr/bin/env node
/**
 * Captures full-page screenshots of every major BudgetPro surface for the
 * USER_GUIDE.md presentation. Logs in once as admin, then walks each URL,
 * saves PNG to docs/guide/screenshots/.
 *
 * Run:
 *   node scripts/capture-guide-screenshots.mjs
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.GUIDE_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.GUIDE_EMAIL ?? "admin@budgetpro.com";
const PASSWORD = process.env.GUIDE_PASSWORD ?? "Admin123!";
const OUT_DIR = "docs/guide/screenshots";

const SURFACES = [
  // Top-level
  { name: "01-login", url: "/login", auth: false, label: "Экран входа" },
  { name: "02-terminal", url: "/budgeting/terminal", label: "Risk Terminal — главный экран" },
  { name: "03-board-deck", url: "/budgeting/board-deck?period=2026", label: "Board Deck — снимок для совета директоров" },
  { name: "04-budgeting", url: "/budgeting", label: "Бюджетирование — главная" },
  // Admin tools
  { name: "05-admin-landing", url: "/budgeting/admin", label: "Admin Tools — лендинг" },
  { name: "06-ai-import", url: "/budgeting/admin/ai-import", label: "AI Auto Import — одиночный файл" },
  { name: "07-import-workbook", url: "/budgeting/admin/import-workbook", label: "Импорт workbook — ручной" },
  { name: "08-companies-readiness", url: "/budgeting/admin/companies-readiness", label: "Готовность компаний" },
  { name: "09-indicator-health", url: "/budgeting/admin/indicator-health", label: "Здоровье индикаторов" },
  { name: "10-data-archive", url: "/budgeting/admin/data-archive", label: "Архив данных" },
  // Other
  { name: "11-onboarding", url: "/budgeting/onboarding", label: "Онбординг — мастер новой компании" },
  { name: "12-audit-log", url: "/budgeting/audit", label: "Журнал аудита" },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  console.log(`→ Logging in as ${EMAIL}`);
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/\/budgeting/, { timeout: 15_000 }),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
  console.log("✓ Logged in");

  for (const s of SURFACES) {
    const outPath = path.join(OUT_DIR, `${s.name}.png`);
    try {
      if (s.url === "/login") {
        // Take it fresh in a new context (no session)
        const fresh = await browser.newContext({
          viewport: { width: 1600, height: 900 },
          deviceScaleFactor: 2,
          colorScheme: "dark",
        });
        const freshPage = await fresh.newPage();
        await freshPage.goto(`${BASE_URL}${s.url}`);
        await freshPage.waitForLoadState("networkidle").catch(() => {});
        await freshPage.waitForTimeout(800);
        await freshPage.screenshot({ path: outPath, fullPage: false });
        await fresh.close();
      } else {
        await page.goto(`${BASE_URL}${s.url}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(2500);
        await page.screenshot({ path: outPath, fullPage: true });
      }
      console.log(`✓ ${s.name}  ${s.label}`);
    } catch (err) {
      console.warn(`✗ ${s.name}  ${s.label} — ${err.message}`);
    }
  }

  // Special: Variance Explainer panel on EDEN with AI narrative loaded
  try {
    console.log("→ Capturing Variance Explainer with EDEN cell + AI narrative");
    await page.goto(`${BASE_URL}/budgeting/terminal`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(4000);

    // Click EDEN row in the company tree (text "Eden Agro")
    const edenRow = page.getByText("Eden Agro").first();
    if (await edenRow.count()) {
      await edenRow.click();
      await page.waitForTimeout(1500);
    }

    // HeatMap cell aria-label format: "AZSEKER-EDEN CUSTOMER_HHI red ▲ ..."
    // Pick the first red cell for AZSEKER-EDEN by aria-label match.
    const edenCell = page
      .locator('[aria-label*="AZSEKER-EDEN"][aria-label*="red"]')
      .first();
    if (await edenCell.count()) {
      await edenCell.click({ force: true });
      await page.waitForTimeout(1500);
    } else {
      // Fallback: any AZSEKER-EDEN cell
      const anyEdenCell = page
        .locator('[aria-label*="AZSEKER-EDEN"]')
        .first();
      if (await anyEdenCell.count()) {
        await anyEdenCell.click({ force: true });
        await page.waitForTimeout(1500);
      } else {
        // Last resort: coordinate click
        await page.mouse.click(1075, 323);
        await page.waitForTimeout(1500);
      }
    }

    // Click Explain → button — wait for it to appear first
    const explainBtn = page.getByRole("button", { name: /^explain/i }).first();
    await explainBtn.waitFor({ timeout: 5000 }).catch(() => {});
    if (await explainBtn.count()) {
      await explainBtn.click();
      console.log("    ⏳ Waiting for LLM response (up to 25s)...");
      // Variance Explainer takes ~10-15s; wait until "Asking the model" disappears
      await page
        .getByText(/recommendations/i)
        .first()
        .waitFor({ timeout: 25_000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
    }

    await page.screenshot({
      path: path.join(OUT_DIR, "13-variance-explainer.png"),
      fullPage: false,
    });
    console.log("✓ 13-variance-explainer");
  } catch (err) {
    console.warn(`✗ variance-explainer — ${err.message}`);
  }

  // Special: Board Deck — scroll to Risk Flags section
  try {
    console.log("→ Capturing Board Deck Risk Flags section");
    await page.goto(`${BASE_URL}/budgeting/board-deck?period=2026`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);
    // Scroll to "Qualitative Risk Flags" heading (text-based)
    const riskFlagsHeading = page
      .getByText(/qualitative risk flags/i)
      .first();
    if (await riskFlagsHeading.count()) {
      await riskFlagsHeading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({
      path: path.join(OUT_DIR, "14-board-deck-risk-flags.png"),
      fullPage: false,
    });
    console.log("✓ 14-board-deck-risk-flags");
  } catch (err) {
    console.warn(`✗ board-deck-risk-flags — ${err.message}`);
  }

  // Special: Risk Registry panel inside CompanySettingsAdmin
  try {
    console.log("→ Capturing Risk Registry panel (CompanySettingsAdmin)");
    await page.goto(`${BASE_URL}/budgeting/admin/companies`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3000);
    // Try to scroll to Risk Registry section
    const riskRegistryHeading = page
      .getByText(/risk registry|регистр риск/i)
      .first();
    if (await riskRegistryHeading.count()) {
      await riskRegistryHeading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
    }
    await page.screenshot({
      path: path.join(OUT_DIR, "15-risk-registry.png"),
      fullPage: true,
    });
    console.log("✓ 15-risk-registry");
  } catch (err) {
    console.warn(`✗ risk-registry — ${err.message}`);
  }

  // Special: Board Deck full page (capture the entire scrollable doc)
  try {
    console.log("→ Capturing Board Deck full page");
    await page.goto(`${BASE_URL}/budgeting/board-deck?period=2026`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3500);
    await page.screenshot({
      path: path.join(OUT_DIR, "16-board-deck-full.png"),
      fullPage: true,
    });
    console.log("✓ 16-board-deck-full");
  } catch (err) {
    console.warn(`✗ board-deck-full — ${err.message}`);
  }

  await browser.close();
  console.log(`\n✓ All screenshots saved to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

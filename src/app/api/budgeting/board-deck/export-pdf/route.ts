/**
 * Phase 7.G Turn XLVII (Phase E.1) — server-side PDF export for Board Deck.
 *
 * Companion to `/budgeting/board-deck` page + the existing PPTX
 * export route. Spawns a headless Chromium via Playwright (already
 * pinned at `^1.59.1` for E2E tests; reused as a runtime dep), points
 * it at the internal page URL with the caller's session cookie, then
 * captures the rendered DOM as a single A4 PDF.
 *
 * Auth: `requireAuth` — any authenticated org member can export.
 * Browser context replays the caller's cookie so the internal page
 * sees the same session — NOT a token-bypass, no admin escalation.
 *
 * Runtime: `nodejs` — playwright spawns native Chromium binary; not
 * compatible with edge runtime.
 *
 * Production deploy note: requires Chromium binary present on the host.
 * Vercel: solved via `chrome-aws-lambda` swap or dedicated worker host.
 * Self-hosted: `npx playwright install chromium`. Both filed as 🔄.
 *
 * Failure mode: if Chromium can't launch (binary missing, permissions),
 * returns 503 with a JSON error body so the UI can surface a clear
 * "PDF export unavailable on this server" message instead of a generic
 * 500.
 */

import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import {
  currentBakuYear,
  parsePeriod,
  PeriodParseError,
} from "@/lib/risk/periods";

export const runtime = "nodejs";

/** Hard cap on render time. A normal 4-section deck renders in ~3-5s;
 *  10s lets us absorb cold-start + LLM-summary fetch. Beyond that we
 *  abort and surface a 504 so a hung Chromium doesn't pin the route. */
const RENDER_TIMEOUT_MS = 10_000;

const SUPPORTED_LANGUAGES: readonly string[] = ["en", "ru", "az"];

function parseLanguage(raw: string | null): string {
  if (raw && SUPPORTED_LANGUAGES.includes(raw)) return raw;
  return "en";
}

function pdfFilename(period: string): string {
  // Keep parity with the PPTX route: `board-deck-<slug>-<period>.<ext>`.
  // We don't have access to org.slug here without an extra DB hit, so
  // we use the bare period; the page-level Content-Disposition already
  // matches the PPTX route shape via the page request's response.
  return `board-deck-${period}.pdf`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (isAuthError(auth)) return auth;

  const rawPeriod =
    req.nextUrl.searchParams.get("period") ?? currentBakuYear();
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json(
        { error: "Invalid period", message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }
  const period = rawPeriod;

  const wantSummary = req.nextUrl.searchParams.get("summary") === "true";
  const language = parseLanguage(req.nextUrl.searchParams.get("lang"));

  // Build the target URL the headless browser will hit. Same-origin so
  // the session cookie travels naturally; we replay caller's cookies on
  // the playwright context to authenticate the internal page request.
  const protocol = req.nextUrl.protocol; // "http:" / "https:"
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const params = new URLSearchParams({ period });
  if (wantSummary) {
    params.set("summary", "true");
    params.set("lang", language);
  }
  const targetUrl = `${protocol}//${host}/budgeting/board-deck?${params.toString()}`;

  // Replay caller's session cookies so the internal page sees the
  // SAME authenticated user. We rely on host parsing to set the
  // cookie domain correctly — host can be `localhost:3000`,
  // `app.example.com`, etc. Strip the port for the cookie domain.
  //
  // Architect Turn-XLVII Проблема fix: filter to next-auth.*-prefixed
  // cookies only. Replaying ALL cookies (analytics, CSRF, third-party)
  // would unnecessarily expand the surface area of what the headless
  // browser accepts; we only need the session token to authenticate.
  const hostNoPort = host.split(":")[0];
  const callerCookies = req.cookies
    .getAll()
    .filter((c) => c.name.startsWith("next-auth."))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: hostNoPort,
      path: "/",
    }));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    // Most common production failure: chromium binary not installed
    // (`npx playwright install chromium` not run on host). Surface a
    // clear 503 instead of a generic 500.
    return NextResponse.json(
      {
        error: "PDF export unavailable",
        message: `Headless Chromium failed to launch on the server: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const context = await browser.newContext();
    if (callerCookies.length > 0) await context.addCookies(callerCookies);
    const page = await context.newPage();
    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: RENDER_TIMEOUT_MS,
    });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "15mm",
        right: "15mm",
        bottom: "15mm",
        left: "15mm",
      },
    });
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFilename(period)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "PDF render failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 504, headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    // Best-effort close — response was already sent above; a leaked
    // Chromium process is OS-level cleanup, not a user-visible error.
    // Architect Turn-XLVII Suggestion: log the error for production
    // observability so leaked processes can be traced post-mortem.
    await browser.close().catch((err) => {
      console.error(
        `[board-deck/export-pdf] browser.close() failed (orgId=${auth.orgId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}

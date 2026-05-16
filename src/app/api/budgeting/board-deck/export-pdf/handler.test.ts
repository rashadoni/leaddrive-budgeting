// @vitest-environment node
/**
 * Phase 7.G Turn XLVII (Phase E.1) — handler tests for
 * `GET /api/budgeting/board-deck/export-pdf`.
 *
 * Locks: 401 unauth, 400 invalid period, 200 returns PDF Content-Type
 * + non-empty body, target URL composed correctly with query params,
 * caller's session cookie replayed on browser context, browser closed
 * on success AND failure paths, 503 when chromium.launch() throws,
 * 504 when render path throws.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { chromiumLaunchMock, browserMock, contextMock, pageMock } = vi.hoisted(
  () => {
    const pageMock = {
      goto: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4\nfake pdf body")),
    };
    const contextMock = {
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(pageMock),
    };
    const browserMock = {
      newContext: vi.fn().mockResolvedValue(contextMock),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const chromiumLaunchMock = vi.fn().mockResolvedValue(browserMock);
    return { chromiumLaunchMock, browserMock, contextMock, pageMock };
  },
);

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("playwright", () => ({
  chromium: { launch: chromiumLaunchMock },
}));

import { mockSession, makeRequest } from "@/test/api-harness";
import { GET } from "./route";

const ORG_ID = "org_demo";
const USER_ID = "u1";

beforeEach(() => {
  chromiumLaunchMock.mockReset().mockResolvedValue(browserMock);
  browserMock.newContext.mockClear();
  browserMock.close.mockClear().mockResolvedValue(undefined);
  contextMock.addCookies.mockClear().mockResolvedValue(undefined);
  contextMock.newPage.mockClear().mockResolvedValue(pageMock);
  pageMock.goto.mockClear().mockResolvedValue(undefined);
  pageMock.pdf
    .mockClear()
    .mockResolvedValue(Buffer.from("%PDF-1.4\nfake pdf body"));
});

describe("GET /api/budgeting/board-deck/export-pdf", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null);
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(res.status).toBe(401);
    expect(chromiumLaunchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed period with 400 — gate fires before chromium launch", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=garbage"),
    );
    expect(res.status).toBe(400);
    expect(chromiumLaunchMock).not.toHaveBeenCalled();
  });

  it("returns 200 with PDF Content-Type + Content-Disposition + non-empty body", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="board-deck-2025.pdf"',
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const buf = Buffer.from(await res.arrayBuffer());
    // Mock returns a fixed body — assert it landed verbatim.
    expect(buf.toString().startsWith("%PDF-1.4")).toBe(true);
  });

  it("composes target URL with period + summary + lang params", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    await GET(
      makeRequest(
        "/api/budgeting/board-deck/export-pdf?period=2026&summary=true&lang=ru",
      ),
    );
    expect(pageMock.goto).toHaveBeenCalledTimes(1);
    const navigatedUrl = pageMock.goto.mock.calls[0][0] as string;
    expect(navigatedUrl).toContain("/budgeting/board-deck?");
    expect(navigatedUrl).toContain("period=2026");
    expect(navigatedUrl).toContain("summary=true");
    expect(navigatedUrl).toContain("lang=ru");
  });

  it("does NOT include summary/lang query when ?summary not set", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    const navigatedUrl = pageMock.goto.mock.calls[0][0] as string;
    expect(navigatedUrl).toContain("period=2025");
    expect(navigatedUrl).not.toContain("summary=");
    expect(navigatedUrl).not.toContain("lang=");
  });

  it("rejects unsupported language and falls back to 'en'", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    await GET(
      makeRequest(
        "/api/budgeting/board-deck/export-pdf?period=2025&summary=true&lang=fr",
      ),
    );
    const navigatedUrl = pageMock.goto.mock.calls[0][0] as string;
    expect(navigatedUrl).toContain("lang=en");
    expect(navigatedUrl).not.toContain("lang=fr");
  });

  it("replays caller's next-auth cookies on browser context, filters non-session cookies", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    const req = makeRequest("/api/budgeting/board-deck/export-pdf?period=2025", {
      headers: {
        cookie:
          "next-auth.session-token=abc123; next-auth.csrf-token=xyz789; analytics=ga-id; another=cookie-value",
      },
    });
    await GET(req);
    expect(contextMock.addCookies).toHaveBeenCalledTimes(1);
    const cookies = contextMock.addCookies.mock.calls[0][0] as Array<{
      name: string;
      value: string;
    }>;
    // Session token + CSRF token are next-auth.* — both should pass through.
    expect(cookies.find((c) => c.name === "next-auth.session-token")?.value).toBe(
      "abc123",
    );
    expect(cookies.find((c) => c.name === "next-auth.csrf-token")?.value).toBe(
      "xyz789",
    );
    // Architect Turn-XLVII Проблема fix: non-next-auth cookies must be
    // filtered out so the headless browser surface stays minimal.
    expect(cookies.find((c) => c.name === "analytics")).toBeUndefined();
    expect(cookies.find((c) => c.name === "another")).toBeUndefined();
    expect(cookies).toHaveLength(2);
  });

  it("does not call addCookies when caller has no next-auth cookies (filtered to empty)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    // Caller has cookies but NONE are next-auth.* — addCookies must skip.
    const req = makeRequest("/api/budgeting/board-deck/export-pdf?period=2025", {
      headers: {
        cookie: "analytics=ga-id; consent=accepted",
      },
    });
    await GET(req);
    expect(contextMock.addCookies).not.toHaveBeenCalled();
  });

  it("does not call addCookies when caller has no cookies at all", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(contextMock.addCookies).not.toHaveBeenCalled();
  });

  it("503 when chromium.launch throws (binary missing)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    chromiumLaunchMock.mockRejectedValueOnce(
      new Error("Executable doesn't exist at /path/to/chromium"),
    );
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("PDF export unavailable");
    expect(body.message).toMatch(/Executable doesn't exist/);
    // Browser was never launched — close should NOT have been called.
    expect(browserMock.close).not.toHaveBeenCalled();
  });

  it("504 when render path throws (Chromium hung / page.goto fails)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    pageMock.goto.mockRejectedValueOnce(new Error("Timeout 10000ms exceeded"));
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe("PDF render failed");
    expect(body.message).toMatch(/Timeout/);
  });

  it("browser.close runs on success path", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(browserMock.close).toHaveBeenCalledTimes(1);
  });

  it("browser.close runs even when render throws (cleanup invariant)", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    pageMock.pdf.mockRejectedValueOnce(new Error("PDF generation failed"));
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf?period=2025"),
    );
    expect(res.status).toBe(504);
    expect(browserMock.close).toHaveBeenCalledTimes(1);
  });

  it("uses default period (current Baku year) when ?period= omitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: USER_ID, role: "manager" });
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pdf"),
    );
    expect(res.status).toBe(200);
    const navigatedUrl = pageMock.goto.mock.calls[0][0] as string;
    // Period must be a 4-digit year.
    expect(navigatedUrl).toMatch(/period=\d{4}/);
  });
});

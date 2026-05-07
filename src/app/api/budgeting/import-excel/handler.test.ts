// @vitest-environment node
/**
 * Phase 7.G Turn LXIII follow-up — auth-only smoke for `/api/budgeting/import-excel`.
 *
 * Architect Turn-LXIII suggested splitting the import-excel test plan
 * into (a) auth-gate-only smoke (~15 min, no fixture needed) and (b)
 * full fixture-driven plan (~6-8h with 3-4 customer xlsx schemas +
 * golden-output assertions). This file is (a). The full (b) stays
 * filed as the dev-owned 🔄 in CARRYOVER.
 *
 * Locks ONLY pre-parsing gates — auth + rate-limit + missing-file +
 * oversized-file. NOT covered (intentionally): xlsx parsing
 * correctness, AI-mapper pipeline, multi-table writes, idempotency.
 * Those need fixtures + golden-output assertions per the deferred
 * 🔄 plan.
 *
 * Why this matters: the route is 1110 LOC. Today nothing prevents an
 * auth regression silently shipping (e.g. someone refactors `getOrgId`
 * → optional). The auth-gate test catches that regression class
 * without needing to mock ExcelJS or downstream Prisma writes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {},
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stub ExcelJS so the route's `new ExcelJS.Workbook()` doesn't trip
// on missing-file (the test never reaches that path; we don't get past
// the file-size gate). Ensures the test fails CLEANLY on a regression
// rather than mysteriously on missing module.
vi.mock("exceljs", () => ({
  default: {
    Workbook: vi.fn(() => ({
      xlsx: { load: vi.fn() },
    })),
  },
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  // Defensive — no Prisma calls expected on these gate-paths.
})

/**
 * Helper: build a multipart/form-data request with a `file` field.
 * Path-of-least-resistance: a Blob → Request body, since `makeRequest`
 * supports `init.body` directly. (We don't use the json helper because
 * import-excel reads `formData()` not `req.json()`.)
 */
function makeUploadRequest(opts: {
  fileName?: string
  fileSize?: number
  noFile?: boolean
}): Request {
  const formData = new FormData()
  if (!opts.noFile) {
    const buf = new Uint8Array(opts.fileSize ?? 100)
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const file = new File([blob], opts.fileName ?? "test.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    formData.append("file", file)
  }
  return new Request("http://localhost/api/budgeting/import-excel", {
    method: "POST",
    body: formData,
  })
}

describe("POST /api/budgeting/import-excel — auth-gate smoke (Turn LXIII)", () => {
  it("returns 401 when unauthenticated (BEFORE file parse)", async () => {
    await mockSession(null)
    const req = makeUploadRequest({})
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(401)
  })

  it("returns 400 when no file in form data", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const req = makeUploadRequest({ noFile: true })
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/no file/i)
  })

  it("returns 413 when file exceeds 20MB cap", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    // Create a 21MB file — exceeds MAX_FILE_SIZE_BYTES (20MB).
    const oversized = 21 * 1024 * 1024
    const req = makeUploadRequest({ fileSize: oversized, fileName: "big.xlsx" })
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/file too large/i)
  })
})

describe("POST /api/budgeting/import-excel — rate-limit smoke (Turn LXIII)", () => {
  it("rate-limit applies to authenticated callers (2/min per orgId)", async () => {
    // Fire 3 requests rapid-succession; the 3rd MUST 429.
    // Note: rate-limit is in-memory + per-org, so each test run starts
    // clean if the test runner imports a fresh module instance.
    // Vitest module isolation guarantees this for vitest-environment node.
    //
    // Org-segregation: dedicated `org_rate_test` (NOT shared `ORG_ID`)
    // ensures no state bleed from other test blocks in the same file
    // even if module-level bucket isolation were ever relaxed (defense
    // in depth — architect Turn-LXIII follow-up suggestion).
    await mockSession({ orgId: "org_rate_test", userId: "u1", role: "manager" })
    const req1 = await POST(
      makeUploadRequest({ noFile: true }) as unknown as Parameters<typeof POST>[0],
    )
    const req2 = await POST(
      makeUploadRequest({ noFile: true }) as unknown as Parameters<typeof POST>[0],
    )
    const req3 = await POST(
      makeUploadRequest({ noFile: true }) as unknown as Parameters<typeof POST>[0],
    )
    // First 2 hit the 400 gate (no file); the 3rd is rate-limited
    // BEFORE reaching that gate, so it returns 429.
    expect(req1.status).toBe(400)
    expect(req2.status).toBe(400)
    expect(req3.status).toBe(429)
  })
})

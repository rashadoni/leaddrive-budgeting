/**
 * Phase 1.4 — tests for the BullMQ soft-delete purge processor.
 *
 * Mocks both the helper and the prisma + audit-log modules so the test
 * doesn't open Redis or Postgres connections. Asserts:
 *   - calls runSoftDeleteCleanup with the payload's cutoffMs
 *   - emits one audit event with the right metadata shape
 *   - tolerates missing org (no audit event but still returns counts)
 *   - swallows audit-log failures (cleanup is the source of truth)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { CleanupSoftDeletedJob } from "../job-types"

vi.mock("../../cleanup/soft-delete-cleanup", () => ({
  SOFT_DELETE_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  runSoftDeleteCleanup: vi.fn(),
}))
vi.mock("../../audit/log", () => ({
  logAuditEvent: vi.fn(),
}))
vi.mock("../../prisma", () => ({
  prisma: {
    organization: {
      findFirst: vi.fn(),
    },
  },
}))

import {
  runSoftDeleteCleanup,
  SOFT_DELETE_TTL_MS,
} from "../../cleanup/soft-delete-cleanup"
import { logAuditEvent } from "../../audit/log"
import { prisma } from "../../prisma"
import { processCleanupSoftDeleted } from "./cleanup-processor"

const cleanupMock = runSoftDeleteCleanup as unknown as ReturnType<typeof vi.fn>
const auditMock = logAuditEvent as unknown as ReturnType<typeof vi.fn>
const orgMock = (prisma as unknown as {
  organization: { findFirst: ReturnType<typeof vi.fn> }
}).organization.findFirst

function fakeJob(data: CleanupSoftDeletedJob): Job<CleanupSoftDeletedJob> {
  return { data } as unknown as Job<CleanupSoftDeletedJob>
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanupMock.mockResolvedValue({
    budgetPlans: 1,
    cashFlowEntries: 2,
    balanceSheetLines: 3,
    counterparties: 4,
    total: 10,
  })
  auditMock.mockResolvedValue({ ok: true, id: "evt_1" })
  orgMock.mockResolvedValue({ id: "org_1" })
})

describe("processCleanupSoftDeleted", () => {
  it("calls helper with default cutoff (30d) when payload omits it", async () => {
    await processCleanupSoftDeleted(fakeJob({}))
    expect(cleanupMock).toHaveBeenCalledWith(prisma, {
      cutoffMs: SOFT_DELETE_TTL_MS,
    })
  })

  it("respects payload cutoffMs override", async () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    await processCleanupSoftDeleted(fakeJob({ cutoffMs: sevenDays }))
    expect(cleanupMock).toHaveBeenCalledWith(prisma, { cutoffMs: sevenDays })
  })

  it("emits one audit event with counts + duration + cutoffDays", async () => {
    const result = await processCleanupSoftDeleted(fakeJob({}))
    expect(auditMock).toHaveBeenCalledTimes(1)
    const call = auditMock.mock.calls[0]
    expect(call[1]).toMatchObject({
      organizationId: "org_1",
      actorUserId: null,
      event: {
        action: "soft_delete_purge",
        entityType: "Organization",
        entityId: "org_1",
        metadata: {
          counts: {
            budgetPlans: 1,
            cashFlowEntries: 2,
            balanceSheetLines: 3,
            counterparties: 4,
            total: 10,
          },
          cutoffDays: 30,
        },
      },
    })
    const metadata = call[1].event.metadata as { durationMs: number }
    expect(typeof metadata.durationMs).toBe("number")
    expect(metadata.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.auditEventId).toBe("evt_1")
  })

  it("uses payload organizationId when provided (skips findFirst)", async () => {
    await processCleanupSoftDeleted(
      fakeJob({ organizationId: "org_explicit" }),
    )
    expect(orgMock).not.toHaveBeenCalled()
    const call = auditMock.mock.calls[0]
    expect(call[1].organizationId).toBe("org_explicit")
  })

  it("falls back to first active org when payload omits organizationId", async () => {
    await processCleanupSoftDeleted(fakeJob({}))
    expect(orgMock).toHaveBeenCalledTimes(1)
    const call = auditMock.mock.calls[0]
    expect(call[1].organizationId).toBe("org_1")
  })

  it("skips audit emission when no org exists in DB", async () => {
    orgMock.mockResolvedValue(null)
    const result = await processCleanupSoftDeleted(fakeJob({}))
    expect(auditMock).not.toHaveBeenCalled()
    expect(result.auditEventId).toBeNull()
    expect(result.counts.total).toBe(10) // cleanup still ran
  })

  it("returns null auditEventId on audit-log failure (never reverses cleanup)", async () => {
    auditMock.mockResolvedValue({ ok: false, error: "DB down" })
    const result = await processCleanupSoftDeleted(fakeJob({}))
    expect(result.auditEventId).toBeNull()
    expect(result.counts.total).toBe(10)
  })

  it("returns durationMs + cutoffDays in result", async () => {
    const result = await processCleanupSoftDeleted(
      fakeJob({ cutoffMs: 14 * 24 * 60 * 60 * 1000 }),
    )
    expect(result.cutoffDays).toBe(14)
    expect(typeof result.durationMs).toBe("number")
  })
})

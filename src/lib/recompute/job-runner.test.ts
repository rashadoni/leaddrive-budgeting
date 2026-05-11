import { describe, it, expect, beforeEach } from "vitest"
import { enqueue, getJob, _clearAllJobsForTests } from "./job-runner"

beforeEach(() => {
  _clearAllJobsForTests()
})

describe("job-runner — Phase 6.1 in-process queue", () => {
  it("returns a jobId immediately and starts pending", () => {
    const job = enqueue("org1", 10, async () => {
      // never resolve
      await new Promise<void>(() => {})
    })
    expect(job.jobId).toMatch(/^job_/)
    expect(job.status).toBe("pending")
    expect(job.total).toBe(10)
  })

  it("transitions pending → running → succeeded", async () => {
    const job = enqueue("org1", 3, async (state, report) => {
      report({ processed: 1, total: 3, result: { companyCode: "A", indicatorCode: "X", status: "ok" } })
      report({ processed: 2, total: 3, result: { companyCode: "A", indicatorCode: "Y", status: "unknown" } })
      report({ processed: 3, total: 3, result: { companyCode: "B", indicatorCode: "X", status: "ok" } })
    })
    // Wait for setImmediate to fire + worker to complete.
    await new Promise((r) => setTimeout(r, 50))
    const fetched = getJob(job.jobId, "org1")
    expect(fetched?.status).toBe("succeeded")
    expect(fetched?.processed).toBe(3)
    expect(fetched?.ok).toBe(2)
    expect(fetched?.unknown).toBe(1)
    expect(fetched?.errored).toBe(0)
  })

  it("captures errors and marks job failed", async () => {
    const job = enqueue("org1", 1, async () => {
      throw new Error("kaboom")
    })
    await new Promise((r) => setTimeout(r, 50))
    const fetched = getJob(job.jobId, "org1")
    expect(fetched?.status).toBe("failed")
    expect(fetched?.errorMessage).toBe("kaboom")
  })

  it("isolates jobs by organization (cross-tenant returns null)", async () => {
    const job = enqueue("org1", 1, async () => {})
    await new Promise((r) => setTimeout(r, 20))
    expect(getJob(job.jobId, "org2")).toBeNull()
    expect(getJob(job.jobId, "org1")).not.toBeNull()
  })

  it("trims recentResults to last 5", async () => {
    const job = enqueue("org1", 10, async (_s, report) => {
      for (let i = 0; i < 10; i++) {
        report({ processed: i + 1, total: 10, result: { companyCode: `C${i}`, indicatorCode: "X", status: "ok" } })
      }
    })
    await new Promise((r) => setTimeout(r, 50))
    const fetched = getJob(job.jobId, "org1")
    expect(fetched?.recentResults.length).toBe(5)
    expect(fetched?.recentResults[0].companyCode).toBe("C5")
    expect(fetched?.recentResults[4].companyCode).toBe("C9")
  })

  it("getJob returns null for unknown jobId", () => {
    expect(getJob("nonexistent", "org1")).toBeNull()
  })
})

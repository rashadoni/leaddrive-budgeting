// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { clearDataPendingBanners } from "./clear-data-pending-banner"

type Co = { id: string; code: string; organizationId: string; settings: unknown }

function fakeTx(companies: Co[]) {
  const updates: Array<{ id: string; settings: Record<string, unknown> }> = []
  const tx = {
    updates,
    company: {
      findMany: vi.fn(async ({ where }: { where: { organizationId: string; code: { in: string[] } } }) =>
        companies
          .filter((c) => c.organizationId === where.organizationId && where.code.in.includes(c.code))
          .map((c) => ({ id: c.id, settings: c.settings })),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { settings: Record<string, unknown> } }) => {
        updates.push({ id: where.id, settings: data.settings })
      }),
    },
  }
  return tx
}

describe("clearDataPendingBanners", () => {
  it("clears the banner for a company that has one, preserving other settings", async () => {
    const tx = fakeTx([
      { id: "c1", code: "AZSEKER-PROMALT", organizationId: "org1", settings: { dataPendingBanner: "awaiting", riskTags: ["x"] } },
    ])
    const n = await clearDataPendingBanners(tx as never, "org1", ["AZSEKER-PROMALT"])
    expect(n).toBe(1)
    expect(tx.updates).toHaveLength(1)
    expect(tx.updates[0].settings).toEqual({ riskTags: ["x"] }) // banner gone, riskTags kept
    expect("dataPendingBanner" in tx.updates[0].settings).toBe(false)
  })

  it("leaves a company WITHOUT a banner untouched (no update)", async () => {
    const tx = fakeTx([{ id: "c1", code: "AZSEKER-CPC", organizationId: "org1", settings: { riskTags: [] } }])
    const n = await clearDataPendingBanners(tx as never, "org1", ["AZSEKER-CPC"])
    expect(n).toBe(0)
    expect(tx.updates).toHaveLength(0)
  })

  it("only touches companies in entityCodes — a sibling's banner survives", async () => {
    const tx = fakeTx([
      { id: "c1", code: "AZSEKER-PROMALT", organizationId: "org1", settings: { dataPendingBanner: "a" } },
      { id: "c2", code: "AZSEKER-HORIZON", organizationId: "org1", settings: { dataPendingBanner: "still empty" } },
    ])
    const n = await clearDataPendingBanners(tx as never, "org1", ["AZSEKER-PROMALT"]) // HORIZON not included
    expect(n).toBe(1)
    expect(tx.updates.map((u) => u.id)).toEqual(["c1"]) // only ProMalt
  })

  it("no-op on empty / blank entityCodes (no query)", async () => {
    const tx = fakeTx([{ id: "c1", code: "X", organizationId: "org1", settings: { dataPendingBanner: "a" } }])
    expect(await clearDataPendingBanners(tx as never, "org1", [])).toBe(0)
    expect(await clearDataPendingBanners(tx as never, "org1", ["", "   "])).toBe(0)
    expect(tx.company.findMany).not.toHaveBeenCalled()
  })

  it("tolerates null / non-object settings", async () => {
    const tx = fakeTx([
      { id: "c1", code: "A", organizationId: "org1", settings: null },
      { id: "c2", code: "B", organizationId: "org1", settings: "weird" },
    ])
    const n = await clearDataPendingBanners(tx as never, "org1", ["A", "B"])
    expect(n).toBe(0)
    expect(tx.updates).toHaveLength(0)
  })
})

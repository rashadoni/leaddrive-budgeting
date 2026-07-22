import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const scriptPath = resolve(
  process.cwd(),
  "scripts/derive-azseker-drought-index.ts",
)
const playbookPath = resolve(process.cwd(), "docs/PRE_DEMO_PLAYBOOK.md")

describe("retired EDEN drought writer", () => {
  it("fails closed without importing Prisma or retaining a write path", () => {
    const source = readFileSync(scriptPath, "utf8")

    expect(source).toContain("RETIRED")
    expect(source).toContain("process.exitCode = 2")
    expect(source).toContain("period-safe")
    expect(source).toContain("0–10")
    expect(source).toContain("owner-approved rainfall")
    expect(source).not.toContain("PrismaClient")
    expect(source).not.toContain("operationalFact")
    expect(source).not.toContain("deleteMany")
    expect(source).not.toContain("create({")
  })

  it("exits non-zero with the owner-policy reason and performs no setup", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("[drought-index] BLOCKED")
    expect(result.stderr).toContain("owner-approved EDEN rainfall policy")
  })

  it("is not listed as an executable pre-demo data command", () => {
    const playbook = readFileSync(playbookPath, "utf8")

    expect(playbook).not.toContain(
      "npx tsx scripts/derive-azseker-drought-index.ts",
    )
    expect(playbook).toContain("drought derivation is retired")
  })
})

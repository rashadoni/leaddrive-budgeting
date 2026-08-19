// @vitest-environment node
/**
 * The checked-in table is what the RULE prints for this workbook.
 *
 * A mapping table nobody can re-derive is a transcript: it is right until
 * someone edits a line, and then it is wrong in a way no test can see. So the
 * derivation is code (`deriveLegacyChartMap`), the table is its output, and
 * this test re-runs the derivation against the real file and demands the
 * checked-in file byte for byte. If the workbook changes, the table has to be
 * regenerated — and the regenerate is one command, printed in the failure.
 *
 * Skips when the client file is absent:
 *
 *   PLF_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run plf-2025-chart-rederive
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { deriveFromWorkbook } from "../../../../scripts/derive-plf-2025-chart-map"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)

const GENERATED = path.join(__dirname, "plf-2025-chart-map.generated.ts")

describe.skipIf(!AVAILABLE)("the 2025 chart map re-derives from the workbook", () => {
  const run = AVAILABLE ? deriveFromWorkbook(WORKBOOK) : null

  it("reproduces the checked-in table exactly", () => {
    expect(run!.rendered).toBe(fs.readFileSync(GENERATED, "utf8"))
  })

  it("leaves nothing ambiguous", () => {
    // The section tie-break — keep the 2025 code's own section — is what
    // takes this to zero. Anything left here is a mapping only the client can
    // settle, and the rule must not paper over it.
    expect(run!.ambiguous).toEqual([])
  })

  it("violates no invariant except the duplicates it names", () => {
    // `duplicate` is a statement about the CLIENT's chart, not a defect in
    // the mapping: five 2025 accounts share a name with a 2026 account that
    // sits at another code, and three of those are `.R` region rows whose
    // 2026 twin is a parent. They are reported and warned on, never merged.
    expect(run!.violations.filter((v) => v.kind !== "duplicate" && v.kind !== "merge")).toEqual([])
    expect(run!.violations.filter((v) => v.kind === "duplicate").map((v) => v.code)).toEqual([
      "PLF.05.11.R",
      "PLF.05.17.R",
      "PLF.05.18.R",
      "PLF.08.02",
      "PLF.08.03",
    ])
  })

  it("names the five places two 2025 accounts become one", () => {
    /**
     * These were invisible until the check learned that a source account is
     * (code, label): all five pairs share a label, and the old comparison
     * looked at the label alone. Pinned rather than fixed, because which 2026
     * account each pair belongs in is the client's decision, not the rule's.
     *
     * Two carry real money, and they are the cause of the product-margin
     * defects chased on 2026-08-19:
     *
     *   Other Costs                 −1,094,833 (farm) + −9,696 (plant)
     *     Farming cost left PLF.02.01.99 while its revenue PLF.01.01.99 stayed,
     *     so 1,921,539 of "other products" revenue showed no cost at all.
     *   Revenue from Other Sources     82,398 + −705,200
     *     Landed on PLF.01.03.99 beside the cost above, and the screen printed
     *     +277.3% on a line that lost 1,727,331.
     *
     * One is small — Consulting Fees, −6,171 + −6,365 — but it collapses the
     * client's Sales-&-Marketing / Head-Office split, which the section
     * tie-break exists to protect: the tie-break chooses between two TARGETS,
     * and cannot stop two SOURCES converging. The last two are empty.
     */
    expect(run!.violations.filter((v) => v.kind === "merge").map((v) => v.code)).toEqual([
      "PLF.04.05.02",
      "PLF.05.13.01",
      "PLF.05.13.02",
      "PLF.02.03.99",
      "PLF.01.03.99",
    ])
  })

  it("classifies every 2025 leaf, and 148 of them carry money", () => {
    expect(run!.census).toEqual({
      identical: 77,
      renumbered: 123,
      own_account: 172,
    })
    expect(run!.moneyCensus).toEqual({
      identical: 59,
      renumbered: 64,
      own_account: 25,
    })
  })

  it("agrees with the owner's verified table, and says where it goes further", () => {
    // The owner's table (145 rows: 58 identical / 61 mapped / 26 unmapped)
    // was derived by the same rule keyed on the CODE. Keying on (code, label)
    // reproduces it everywhere except three codes that carry two meanings on
    // the 2025 sheet — where the code-keyed pass silently took the first
    // label and mislabelled the rest:
    //
    //   PLF.07.02.04  Farming / Investment / Product  →  .02 / .03 / .04
    //                 (verified: one mapping to .02; 4,977,039 mislabelled)
    //   PLF.01.01.99  "Revenue from Sale of Other Products" stays,
    //                 "Revenue from Other Sources" → PLF.01.03.99
    //                 (verified: identical; 705,200 mislabelled)
    //   PLF.12.03.04  the "Provision - G&A" wording — which is the one that
    //                 carries the −44,049 — matches PLF.12.01.04, the 2026
    //                 home of the whole `Provisions - G&A` block. The empty
    //                 "Accrual - G&A" wording keeps the old code.
    //                 (verified: unmapped, read off the "Accrual" wording)
    const byCode = new Map<string, string[]>()
    for (const e of run!.entries) {
      const list = byCode.get(e.code)
      if (list) list.push(e.storedCode)
      else byCode.set(e.code, [e.storedCode])
    }
    expect(byCode.get("PLF.07.02.04")).toEqual([
      "PLF.07.02.02",
      "PLF.07.02.03",
      "PLF.07.02.04",
    ])
    expect(byCode.get("PLF.01.01.99")).toEqual(["PLF.01.01.99", "PLF.01.03.99"])
    expect(byCode.get("PLF.12.03.04")).toEqual(["PLF.12.01.04", "PLF.12.03.04"])
  })
})

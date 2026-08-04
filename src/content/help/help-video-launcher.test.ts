import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 2026-08-04 — the guide card is permanent, on the owner's call.
 *
 * It used to carry an X that wrote `thumbnailDismissed` into localStorage and
 * hid the card for that section forever. Both the card's X and the modal's X
 * ran it, so watching the video once could remove its own entry point — and it
 * did: the owner reported "the video disappeared after the update" when the
 * video was fine and the browser had simply remembered a dismissal.
 *
 * Source-level assertions rather than a mounted component: what matters is that
 * no code path writes the permanent flag again, and that is exactly what a
 * future edit would reintroduce.
 */
const SOURCE = readFileSync(
  resolve(process.cwd(), "src/components/help/help-video-launcher.tsx"),
  "utf8",
)

describe("help video launcher — the card cannot be dismissed away", () => {
  it("never writes the permanent-hide flag", () => {
    expect(SOURCE).not.toMatch(/thumbnailDismissed:\s*true/)
  })

  it("does not branch the render mode on a stored dismissal", () => {
    // Browsers still carry the flag from before this change; honouring it would
    // leave those users with no card and no explanation.
    expect(SOURCE).not.toMatch(/if\s*\(\s*stored\.thumbnailDismissed\s*\)/)
  })

  it("keeps the poster thumbnail in the card", () => {
    // The thumbnail is the point of the card — a text-only strip reads as a
    // banner and gets ignored.
    expect(SOURCE).toContain("assets.posterSrc")
    expect(SOURCE).toMatch(/aspect-video/)
  })

  it("still lets the expanded modal collapse back to the card", () => {
    // Closing the video must return to the card, not remove it.
    expect(SOURCE).toContain("function minimize()")
    expect(SOURCE).not.toMatch(/function close\(\)/)
  })
})

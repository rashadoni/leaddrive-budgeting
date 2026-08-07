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

/**
 * 2026-08-07 — the terminal drops the card but must not drop the launcher.
 *
 * The Risk Terminal sizes four panels against the viewport, so a card above
 * them takes height off every one at once; the owner asked for that strip back
 * («терминал тут много место занимает, не хочу чтоб видео сужало эту часть»).
 *
 * The dangerous way to grant that is to stop rendering the launcher on that
 * route. The `budgetpro:open-help-video` listener lives inside it, so the
 * header's video button — the only remaining way in — would dispatch an event
 * with nobody listening. That is the same dead-control shape `help-video-button`
 * was built to fix, and it fails silently: the icon is there, it just does
 * nothing. These assertions pin the mounted-but-cardless arrangement.
 */
const LAYOUT = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/layout.tsx"),
  "utf8",
)

describe("help video launcher — suppressed on the terminal, never unmounted", () => {
  it("keeps the launcher mounted on the full-bleed terminal", () => {
    expect(LAYOUT).toContain("<HelpVideoLauncher inlineCard={!isFullBleed} />")
    // A conditional around the element itself would unmount it and kill the
    // listener; the flag has to reach the component instead.
    expect(LAYOUT).not.toMatch(/\{\s*!isFullBleed\s*&&\s*<HelpVideoLauncher/)
  })

  it("registers the open-event listener before any early return", () => {
    const listenerAt = SOURCE.indexOf("window.addEventListener(OPEN_EVENT")
    const firstReturnNull = SOURCE.indexOf("return null")
    expect(listenerAt).toBeGreaterThan(-1)
    expect(firstReturnNull).toBeGreaterThan(-1)
    expect(listenerAt).toBeLessThan(firstReturnNull)
  })

  it("suppresses only the card, leaving the expanded modal reachable", () => {
    // The cardless early return must be guarded on the thumbnail mode. Guarding
    // on `!inlineCard` alone would also swallow the modal, so the header button
    // would open nothing.
    expect(SOURCE).toContain('if (mode === "thumbnail" && !inlineCard)')
  })

  it("defaults to showing the card, so every other section is unaffected", () => {
    expect(SOURCE).toMatch(/inlineCard\s*=\s*true/)
  })
})

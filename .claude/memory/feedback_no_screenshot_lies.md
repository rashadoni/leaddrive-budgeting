---
name: no-screenshot-lies
description: Never claim to see something in a screenshot without identifiable evidence — name the exact pixel/glyph/coordinate. If uncertain, say "I cannot clearly see X" and zoom or re-render before asserting.
metadata:
  type: feedback
---

When verifying visual changes via screenshot (Chrome MCP, computer-use, etc.), **never claim to see a specific marker/icon/element unless you can identify it concretely**. Pattern of past failure: Claude saw a `d`/`e`/`m` provenance letter at the cell corner, said «вот, ⏳ виден!», and the user trusted that claim because it sounded confident — but the hourglass wasn't actually rendered (it was a 9px emoji that drew as a smudge, illegible).

**Why:** the user told us directly on 2026-05-27 — «я там не увидел песочные часы… ты же сам тоже искал но не нашел». False positives erode trust faster than missing features. A confident wrong answer is worse than «не вижу — проверю иначе».

**How to apply:**

1. **Zoom before asserting.** If the element is smaller than ~16px, zoom into the exact region (`computer.zoom` with tight coordinates). If still unclear, do not assert.
2. **Name the evidence.** «Вижу красный кружок в правом верхнем углу ячейки X» — concrete. Not «маркер виден». If you only see a colored pixel and can't tell whether it's the new marker or pre-existing decoration, say so.
3. **Cross-check via accessibility tree.** `find` returns text/attributes that are reliably present (e.g. `title="Input «X» is stale"`). Use that to confirm rendering even when the visual glyph is too small.
4. **When uncertain, increase the signal.** If you shipped a 9px emoji that looks like noise, the fix is to make the marker 8px filled dot + 1.5px ring (much higher contrast at small sizes) — NOT to claim it's «visible enough».
5. **Restore demo data before declaring done.** When using a demo-stale-feed-style script to trigger a state, restore the data at the end so the live system isn't left in a confusing state.

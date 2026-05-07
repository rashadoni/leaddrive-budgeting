# Read route response shape BEFORE writing handler tests

## Triggering empirical evidence

Phase 7.G **Turn LXIII** (2026-05-08): wrote 6 NEW `handler.test.ts` files
in one batch using `intel/refresh/handler.test.ts` template (mockSession +
makeRequest + Prisma vi.hoisted mocks). 5 of 6 passed first run.

The 6th — `cash-flow/generate/handler.test.ts` — failed on:

```
expect(body.created).toBe(0)
                     ^
expected undefined to be +0
```

The route returns `{ success, entriesCreated, year }` (line 169-173 of
`route.ts`); my test assumed `{ created, ... }` based on `let created = 0`
state-variable name (line 41 of route). Two-symbol mismatch. Caught at
first vitest run + fixed pre-commit.

Architect Turn-LXIII Suggestion #1:

> The mid-turn fix points to a repeatable hazard: writing tests before
> reading the actual route response shape. A pre-test step of
> `grep -n "return NextResponse\|return Response" <route.ts>` takes 5
> seconds and eliminates this class of mismatch. Worth codifying as a
> one-liner habit since the same template is now used across 6+ files.

## Rule

Before writing assertions on `body.X` in a NEW handler.test.ts, **always**
run:

```bash
grep -nE "return NextResponse\.json\\(|return NextResponse\\(" <route.ts>
```

Read the response object shape literally. Match assertions to actual
emitted keys, not state-variable names from the function body.

## Why this matters

When the test template is reused (per `feedback_session_speedup.md` item
#5 — skip-fresh-design), envelope-shape assertions are the **one**
per-route detail that changes. The rest (mockSession + Prisma mocks +
auth gates) is mechanical. Skipping the response-shape read = the
mistake compounds across N test files in the batch.

## When to apply

- Writing any NEW `handler.test.ts` against an existing `route.ts`
- Reusing an existing handler-test template for a new route
- Adding new test cases to an existing handler.test.ts that assert on
  the route's response body (not just status code)

## When NOT to apply

- Pure status-code assertions (`expect(res.status).toBe(401)`) — no
  body-shape dependency
- Refactoring tests where the response shape is already locked
- New routes you're authoring yourself in the same turn (you know
  the shape)

## Cost / benefit

- Cost: ~5 seconds per route (one grep call)
- Benefit: avoids N × ~30-60s mid-turn fix cycles + 1 architect ⚠️
  round per missed shape

## Related memory

- `feedback_session_speedup.md` item #5 (skip-fresh-design / reuse
  templates) — this rule is the safety net for that pattern
- `feedback_verify_one_layer_up.md` — verify production behavior, not
  test-fixture behavior

# Prompt: Finish BudgetPro AI Analytics (cloud v2)

> **How to use:** paste this entire file into a new Claude Code session opened on `/Users/rashadrahimov/Documents/leaddrive-budgeting`. The project is a Next.js 16 + Prisma + PostgreSQL app. A LaunchAgent at `~/Library/LaunchAgents/com.budgetpro.dev.plist` runs `npx next dev` on port 3000 — don't `npm run dev` manually. You must use Chrome MCP or the already-running browser to verify UI; `preview_start` cannot take port 3000.

---

## 1. Context

BudgetPro already has a **v1 AI Analytics feature** shipped. It works end-to-end: a floating "AI Analysis" button on every analytical tab opens a side panel, Claude Sonnet 4.5 streams an initial analysis, uses Anthropic's native `web_search` tool to cite benchmarks, and answers multi-turn follow-up questions. Code lives in:

```
src/lib/ai/client.ts                     # Anthropic SDK wrapper, lazily instantiated
src/lib/ai/section-context.ts            # 7 per-section data collectors (P&L, BS, COGS, CF, Assumptions, Workspace, Forecast)
src/lib/ai/prompts.ts                    # System prompts + kickoff user message
src/app/api/budgeting/ai-analytics/route.ts   # POST endpoint, SSE streaming, web_search enabled
src/components/ai-analytics-panel.tsx    # Radix Sheet + chat UI, streams into bubbles
src/app/(dashboard)/budgeting/page.tsx   # Floating FAB + panel mount (at bottom of component)
.env                                     # ANTHROPIC_API_KEY=sk-ant-api03-...
```

A separate long-term plan for migrating to self-hosted LLMs lives at
`docs/FUTURE_SELF_HOSTED_LLM_MIGRATION.md` — **do not execute that now**, only reference
it if you need to understand the architectural boundary.

**Product constraints** (locked in; read `docs/ROADMAP.md` and
`feedback_budgetpro_mvp_constraints.md` in memory if you're unsure):
- English-only. No i18n.
- Enterprise B2B. No self-serve billing.

## 2. Goal for this session

Finish the remaining items from the original v1 plan so the feature is
"complete-complete" before the first paying client sees it. Specifically:

1. **Custom drill-down tools** — Claude should be able to pull specific month or
   specific account data on demand, not just what the initial context blob
   contains.
2. **PDF export** of the chat.
3. **Admin toggle** to enable/disable AI per organization.
4. **Explicit consent modal** on first use (privacy disclosure).
5. **Smoke-test script** that hits the endpoint and asserts a sensible response.
6. **Handle rate-limit 429s gracefully** in the UI.
7. **Keep architecture swappable** — any new code that talks to Anthropic
   specifically must go through `src/lib/ai/client.ts` or a thin provider
   adapter. Future self-hosted migration must remain a one-file change.

## 3. Sub-tasks in order

### Task A — Custom drill-down tools (most value; ~2 hours)

**Goal:** Claude can request more data mid-conversation.

1. Create `src/lib/ai/tools.ts` with two tool schemas for Claude:

   - `get_monthly_breakdown`
     - Input: `{ accountCode?: string, lineType?: "revenue"|"cogs"|"expense", productCode?: string }`
     - Returns: `{ months: Array<{ month: number, amount: number, count: number }> }` — 12 rows, summing `budgetLine.plannedAmount` for the current plan filtered by whichever fields were passed.

   - `get_account_drill`
     - Input: `{ accountCode: string }`
     - Returns: account metadata (from `chart_of_accounts`) + all `budgetLine`s referencing it + all `cogsCostDetail`s referencing it, summarised.

2. Declare the tools in the `messages.stream()` call in
   `src/app/api/budgeting/ai-analytics/route.ts`, alongside `web_search`.

3. Handle `tool_use` events in the stream loop. The current loop already emits
   `tool_use` as a UI chip — now you need to also:
   - Catch the `tool_use` content block for custom tools (non-`web_search`).
   - Run the corresponding Prisma query (org-scoped via `session.orgId`, plan-scoped via the `planId` passed in the request).
   - Send a follow-up `messages.create` with a `tool_result` block so Claude can continue.
   - Emit a `tool_result` event over SSE so the panel can render the chip as completed.

4. Update `src/components/ai-analytics-panel.tsx` to render `tool_use` chips for
   the new tools (a database icon instead of a search icon when `name !==
   "web_search"`). The data structure already supports it.

5. Verification: open P&L tab, ask "Which month had the worst EBITDA?" — Claude
   should call `get_monthly_breakdown` with `lineType: "revenue"` and
   `lineType: "expense"`, compute margins, and answer correctly.

### Task B — PDF export (~1.5 hours)

**Goal:** download-as-PDF button in the panel header.

1. `@react-pdf/renderer` is already installed. Create `src/components/ai-chat-pdf.tsx` exporting a `<ChatPdfDoc>` React component that renders the conversation:
   - A header: "BudgetPro AI Analysis", section label, plan name, today's date.
   - Alternating speech bubbles. User bubbles right-aligned, muted; assistant bubbles left-aligned. Markdown rendered as plain text (don't try to support every markdown feature — headings and paragraphs are enough).
   - A footer: "Generated from data in Budget 2026 (Imported). Not audited."

2. In `src/components/ai-analytics-panel.tsx`, add an "Export PDF" button next
   to the existing "Clear" button. On click:
   - Use `pdf(<ChatPdfDoc ...>).toBlob()`
   - Download via `URL.createObjectURL` + anchor click
   - Filename: `budget-ai-analysis-<section>-<timestamp>.pdf`

3. Verification: run the PDF export on a chat with at least 3 messages, open the
   file → layout is readable, no overflow, text wraps correctly.

### Task C — Admin toggle + consent modal (~1 hour)

**Goal:** org-level feature flag, explicit user opt-in on first click.

1. The `Organization` model already has a `features: Json?` column. Read its
   shape via `prisma.organization.findFirst` — treat it as `{ aiEnabled?: boolean }`.

2. Add a toggle in the Configuration tab (`?tab=config`, rendered in
   `budget-config-tab.tsx`). Labelled "Enable AI Analyst (sends data to
   Anthropic US)". Admin-only — gate with `hasRole(role, "admin")`.

3. Update `src/app/api/budgeting/ai-analytics/route.ts`: before any LLM call,
   read `Organization.features` and if `aiEnabled !== true` return
   `{ error: "AI analytics is disabled for this organization. Enable it in Settings → Configuration." }` with 403.

4. Create `src/components/ai-consent-modal.tsx`. Stored in `User.features`
   column — same JSON pattern: `{ aiConsentAt?: string }`. If unset, show the
   modal on first panel open explaining:
   - Data being sent: budget line totals, CoA names, product names, numbers
   - Destination: Anthropic API (US servers)
   - Retention: 30 days (Anthropic ToS)
   - Training: disabled by default
   - User clicks "I understand and consent" → write `aiConsentAt = now()` via a new
     `POST /api/user/consent-ai` endpoint.

5. Verification: flip the toggle off, reload — AI button should stay but clicking shows a friendly disabled message.

### Task D — Smoke-test script (~30 min)

Create `scripts/verify-ai-analytics.ts` that:
1. Opens a Prisma client, finds the demo org's live budget plan.
2. Fetches an internal session cookie (or uses a dev-only API token if you add one).
3. Hits `POST /api/budgeting/ai-analytics` with `{ section: "pnl-report", planId, messages: [] }`.
4. Reads the SSE stream, accumulates text, fails the script if:
   - Total text is < 200 chars
   - No `tool_use` event fires (means Claude isn't using web search)
   - Stream doesn't close within 30 s
5. Prints pass/fail.

Add a note in `docs/ROADMAP.md` that this script exists.

### Task E — Rate-limit UI (~30 min)

The middleware returns 429 with a `Retry-After` header. In the panel:
- Detect 429 response.
- Show a friendly banner "Too many AI requests. Try again in Xs."
- Disable the send button until the retry timer elapses.

## 4. Constraints while coding

- **Do not refactor existing v1 code** unless required. The cloud path is working; preserve it.
- **Keep `src/lib/ai/client.ts` as the only place that knows about Anthropic.** All new Anthropic calls must go through the `getAnthropicClient()` helper — no direct `new Anthropic()` elsewhere.
- **TypeScript must stay at 0 errors** — project has `typescript.ignoreBuildErrors: false` enforced.
- **All DB queries must be org-scoped** — read `session.orgId` from `api-auth.ts`'s `requireAuth` and filter every Prisma query. Never trust `planId` from the body without verifying ownership via `prisma.budgetPlan.findFirst({ where: { id, organizationId, deletedAt: null } })`.
- **Rate limit** for `/api/budgeting/ai-analytics` is already set to 5/min/org
  in `src/middleware.ts` — don't duplicate it.

## 5. Files you will change

New:
- `src/lib/ai/tools.ts`
- `src/components/ai-chat-pdf.tsx`
- `src/components/ai-consent-modal.tsx`
- `src/app/api/user/consent-ai/route.ts`
- `scripts/verify-ai-analytics.ts`

Modified:
- `src/app/api/budgeting/ai-analytics/route.ts` (add tool dispatch + feature-flag check)
- `src/components/ai-analytics-panel.tsx` (PDF button, consent modal trigger, 429 handling)
- `src/components/budget-config-tab.tsx` (admin toggle)

## 6. Verification (manual, end-to-end)

1. Restart LaunchAgent: `launchctl kickstart -k gui/501/com.budgetpro.dev`
2. Open `http://localhost:3000/budgeting?tab=pnl-report` in Chrome.
3. Consent modal shows on first click — click "I understand".
4. Initial analysis streams in. At least one search chip appears.
5. Ask: "Which month had the worst EBITDA?" → database chip appears, then
   Claude answers with a specific month.
6. Click "Export PDF" → file opens cleanly.
7. Admin → Configuration → flip AI toggle off → reload → clicking button
   shows disabled message.
8. Flip back on, hit the button 6 times quickly → 6th attempt shows
   rate-limit banner.
9. `npx tsx scripts/verify-ai-analytics.ts` → exits 0.
10. `npx tsc --noEmit` → 0 errors.

## 7. Commits

Make one commit per sub-task (A through E) with a descriptive message. Don't
squash — each step should be independently reviewable.

## 8. After you're done

- Update `docs/ROADMAP.md`: mark AI Analytics as **done**; note that
  self-hosted migration remains available via `docs/FUTURE_SELF_HOSTED_LLM_MIGRATION.md`.
- Rotate the Anthropic API key in `.env` (old one is leaked in the original
  chat). Prompt the user to supply a new key if they haven't already.

## 9. Anti-goals (do NOT do)

- Don't add a "speech-to-text" or "voice" feature — not asked for.
- Don't persist conversation history server-side — MVP keeps it in client
  React state only.
- Don't add multi-language support — project is English-only.
- Don't add billing / usage tracking UI — enterprise B2B, handled out-of-band.
- Don't switch the LLM provider to anything other than Anthropic cloud in this
  session; the self-hosted migration is a separate plan at
  `docs/FUTURE_SELF_HOSTED_LLM_MIGRATION.md`.

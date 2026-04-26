---
name: Set generous max_tokens on every LLM call — 8K+, not 2K
description: BudgetPro's AI produces Russian/Azerbaijani finance prose; default 2048 cap truncates mid-sentence. Default to 8K+ for any Anthropic call that streams analyst-style output.
type: feedback
originSessionId: 5be687c7-afd2-4010-b93c-680c1832cc72
---
Any Anthropic `messages.stream` / `messages.create` call in this project that produces analyst-style prose must set `max_tokens` to at least 8192. Don't copy the SDK's low doc-example default.

**Why:** User flagged multiple times that AI analysis text was cut off mid-sentence (e.g. "Yaşıl tikinti qəb…"). Root cause was `max_tokens: 2048` in `src/app/api/budgeting/ai-analytics/route.ts`. Russian and Azerbaijani cost ~2-3x more tokens per word than English, and a full structured answer (headline + key findings + strategy + recommendations + web-search citations) easily crosses 2K.

**How to apply:**
- New LLM endpoints that stream analyst / narrative output → start with `max_tokens: 8192`. Increase further only when a specific use case needs it.
- Short-utility calls (classifier, one-word label, boolean) → smaller cap is fine.
- If the product grows features in more verbose languages or adds longer sections, bump again.
- Always detect `stop_reason === "max_tokens"` and surface it to the UI. Silent truncation is worse than visible truncation — users notice the cut-off word and lose trust in the analysis.

---
name: Don't frighten enterprise customers with privacy banners
description: Avoid persistent alarming banners (e.g. "data sent to Anthropic US") in customer-facing AI UI. Use gentler disclosure via modal or settings.
type: feedback
originSessionId: 5be687c7-afd2-4010-b93c-680c1832cc72
---
Don't put persistent "⚠ data is sent to …" style banners inside customer-facing AI features.

**Why:** After Task A of AI Analytics v2 shipped, the user asked to remove an amber banner reading "⚠ Section data is sent to Anthropic (US) for analysis. Not used for model training." Their words: "не пугай клиентов" — this is BudgetPro's enterprise B2B audience (CFOs, finance managers) and loud privacy warnings read as "this product is risky."

**How to apply:**
- Privacy disclosure in AI features belongs in a one-time consent modal (Task C of the v2 plan) or in settings, not as an always-visible amber strip.
- When writing UI copy for enterprise features, default to quiet, confident tone. Security/privacy framing should feel like a product feature, not a warning label.
- Same principle for any "beta", "experimental", or "may send data to third party" disclaimers in this project.

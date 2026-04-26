---
name: AI Analytics output language is user-selectable (EN/RU/AZ)
description: AI Analyst panel lets the user pick EN, RU, or AZ for the LLM's output before each analysis. UI strings stay English.
type: project
originSessionId: 5be687c7-afd2-4010-b93c-680c1832cc72
---
The AI Analytics panel supports user-selected output language: EN, RU, AZ. Default is English. The picker sits in the panel header; auto-kickoff has been replaced with an explicit "Start analysis" button so the choice can land before the first turn.

**Why:** BudgetPro's CFO audience is in Azerbaijan — they're comfortable reading English UI but want the actual financial analysis narrative in Russian or Azerbaijani. The user requested this on top of Task A.

**How to apply:**
- "English-only" from `docs/ROADMAP.md` / `CLAUDE.md` refers to the UI (labels, buttons, error strings). AI *output* language is a separate dimension and IS user-selectable.
- When editing `src/lib/ai/prompts.ts` / `src/app/api/budgeting/ai-analytics/route.ts` / `src/components/ai-analytics-panel.tsx`, preserve the `language` parameter flow. Don't hardcode English in new prompts.
- Any future AI surface (chat, PDF export header, narrative generation) should accept and respect the same `language: "en" | "ru" | "az"` setting.

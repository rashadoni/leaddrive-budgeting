# Risk Terminal 2.0

## Master documentation index and implementation charter

**Product:** BudgetPro Enterprise Holding Risk Terminal  
**Prepared:** 2026-07-15  
**Status:** implementation in progress; Stage A and early trust-core slices are implemented, but the full 2.0 cutover is not complete
**Audience:** product owner, CFO, risk owner, finance controller, designer, Claude Code, engineering reviewer  
**Delivery boundary:** this package began as the design proposal. `docs/ROADMAP.md` and `IMPLEMENTATION-STATUS.md` are authoritative for what is implemented; all remaining stages stay proposals until their listed gates pass. Production readiness is still a separate release decision.

## 1. Executive decision

Risk Terminal 2.0 is not a cosmetic reskin and not a destructive rewrite. It is a staged transformation of the product around one operating principle:

> No agreed period, reconciliation and lineage means no decision-grade color, composite score or alert.

The user-facing north star is equally strict:

> In 30 seconds, a user must understand where the material risk is, why it exists, whether the data can be trusted, who must act, and what a scenario would change.

The current terminal contains valuable professional infrastructure, including keyboard workflows, a resizable expert matrix, drill-downs, formula inspection, period locks, audit events and scenario tooling. Those assets should be retained. The default experience, financial source of truth, period contract, KPI governance, lineage and composite semantics must change.

## 2. Document set

Read the package in this order:

0. [00-EXECUTIVE-SUMMARY-RU.md](./00-EXECUTIVE-SUMMARY-RU.md)
   Russian owner summary: audit verdict, target product, trust rules, realistic timeline and the current execution boundary.
1. [01-AUDIT-BASELINE.md](./01-AUDIT-BASELINE.md)  
   Evidence-based current-state audit, defects, strengths, severity and decision-grade definition.
2. [02-PRODUCT-AND-UI-UX-SPEC.md](./02-PRODUCT-AND-UI-UX-SPEC.md)  
   Product jobs, information architecture, detailed screens, interaction model, design system, responsive, accessibility and usability requirements.
3. [03-DATA-KPI-TRUST-SPEC.md](./03-DATA-KPI-TRUST-SPEC.md)  
   Canonical financial mart, period/revision model, recompute contract, KPI registry, lineage, Risk × Confidence and alert rules.
4. [04-TECHNICAL-IMPLEMENTATION-PLAN.md](./04-TECHNICAL-IMPLEMENTATION-PLAN.md)  
   Strangler migration, current/proposed file map, API contracts, workstreams, PR sequence, performance boundaries and definition of done.
5. [05-TEST-UAT-ROLLOUT.md](./05-TEST-UAT-ROLLOUT.md)  
   Test pyramid, golden reconciliations, visual gate, UAT scripts, feature flags, shadow rollout, rollback and production go/no-go.
6. [CLAUDE-CODE-HANDOFF.md](./CLAUDE-CODE-HANDOFF.md)  
   Operating instructions and copy-ready prompt for Claude Code.

The repository-level planning source remains [../ROADMAP.md](../ROADMAP.md). This package defines **Phase 10: Risk Terminal 2.0, Trust Core & Decision Cockpit**, now in implementation. The roadmap and `IMPLEMENTATION-STATUS.md` must only advance when work actually starts, passes its named checks, or is explicitly blocked.

## 3. Product promise

Risk Terminal 2.0 must support five questions without requiring the user to decode the expert matrix:

1. **Where is the material risk?**
2. **What changed and what drives it?**
3. **How reliable, complete and current is the evidence?**
4. **Who owns the response and by when?**
5. **What changes under an explicit scenario?**

If a feature does not improve one of these answers, it is not a priority for the first release.

## 4. Release shape

| Release | Target | Scope | Meaning |
|---|---:|---|---|
| Trust Core | Week 7 | canonical finance, period/revision, exact recompute, certified KPI subset, lineage, Risk × Confidence | system becomes auditable for the pilot scope |
| Controlled beta | Week 12 | modern Today/Portfolio/Company UX, Expert mode, shadow alerts, accessibility and task-based UAT | usable beta for 3-5 pilot companies and 25-35 decision KPIs |
| Production target | Week 16 | one real close cycle, rollback rehearsal, sign-offs, training and controlled cutover | approved default experience for pilot entities |

Ten to twelve weeks is a beta target, not a promise of full holding-wide production replacement. With one senior engineer and a part-time finance SME, the honest range is 14-18 weeks.

## 5. Non-negotiable product rules

### 5.1 Trust rules

- One canonical aggregation path must serve financial statements, Risk Terminal, scenarios, variance explanations, board decks, exports and alerts.
- Actual January-May must be identified as YTD May, never silently presented as full-year actual.
- Flow and stock measures must have different aggregation semantics.
- Current external context must not be silently presented as historical evidence.
- Unknown and missing data represent uncertainty, not zero risk.
- No numeric composite may appear healthy when material coverage is below the approved gate.
- Every colored decision KPI must expose source revision, period, formula version, threshold version and lineage.
- A recalculation creates a new auditable observation/version. It must not erase the only historical record.

### 5.2 UX rules

- The default route is exception-first, not matrix-first.
- The Expert Matrix remains available and powerful, but it is no longer the onboarding surface.
- Risk, Confidence, Coverage and As-of are separate concepts everywhere.
- The main toolbar contains no more than five primary controls.
- Typography must be readable in normal office conditions. Monospace is reserved for numbers, identifiers and commands.
- Status is never communicated by color alone.
- EN, RU and AZ must be complete and must not mix in one state.
- Mobile supports Inbox, company brief, source check and actions. The expert matrix remains desktop-only.
- Paid or slow AI calls are user-triggered. Merely opening the terminal must not create avoidable LLM spend.

### 5.3 Delivery rules

- Use a strangler migration with versioned contracts, feature flags and old/new shadow comparison.
- Do not rewrite working formula parsing, import staging, period locks, audit infrastructure, RBAC/RLS or Expert Matrix without a verified defect.
- Do not certify all 110 KPIs in the first release.
- Do not build a general warehouse, generic KPI builder or mobile heatmap in the first release.
- Do not begin production cutover before a real close cycle and rollback rehearsal.
- Do not interpret old/new calculation differences as defects automatically. Each material difference needs a reason code and finance-owner decision.

## 6. Priority scope

### P0, trust and correctness

- Protective `Legacy / Provisional` presentation for existing decision outputs.
- Canonical Financial Statement Mart.
- `PeriodContext` and immutable `DataRevision`.
- Exact M/Q/YTD/FY/LTM recompute and invalidation.
- KPI specification registry and first 25-35 certified decision KPIs.
- Source-to-cell lineage.
- Risk Index separated from Confidence and Coverage.
- Decision-grade alert rules.

### P1, decision experience

- Today / Risk Inbox.
- Portfolio Map grouped by risk domain.
- Company Workspace.
- KPI Detail and Evidence chain.
- Data Health workspace.
- Scenario Lab over the same canonical snapshot.
- Executive, Analyst and Audit density modes.
- Expert Matrix retained as a secondary mode.

### Deferred from the first release

- Certification of the complete 110-KPI catalog.
- Mobile heatmap.
- Generic visual KPI builder.
- New web-crawler, AI narrative or board-deck capabilities.
- Broad historical backfill without agreed source/revision policy.
- Cache/materialized views before write invalidation is proven.
- Decorative animation and dashboard customization that do not improve a core task.

## 7. Ownership and decision rights

| Area | Accountable | Responsible | Required sign-off |
|---|---|---|---|
| Statement mapping and reconciliation | Finance Controller | Data/finance engineer | Controller |
| KPI definition and threshold | Risk Owner | Finance SME + engineer | Risk Owner |
| Risk × Confidence semantics | CFO | Risk Owner + product owner | CFO |
| Lineage and revision model | Data Owner | Backend engineer | Controller + audit owner |
| UX and information architecture | Product Owner | Designer + frontend engineer | CFO/risk user UAT |
| Security and org scope | Engineering owner | Backend engineer | Security review |
| Production cutover | Product Owner | Delivery lead | CFO + controller + risk owner |

The finance SME is part of the weekly build loop, not a reviewer at the end. Methodology decisions should have a 24-48 hour SLA. An unsigned KPI is downgraded or excluded, not shipped with a temporary formula presented as fact.

## 8. Required user acceptance tasks

The final interface must let an unaided target user:

1. Find the largest material portfolio risk in at most 30 seconds and 3 interactions.
2. Explain the status and its top drivers in at most 60 seconds.
3. Verify period, data-through, confidence and source in at most 45 seconds.
4. Assign an owner and due date in at most 60 seconds.
5. Run a scenario and explain the delta in at most 2 minutes.

Pass target: at least 90% completion without developer coaching. At least 85% of new users must correctly distinguish Risk from Confidence.

## 9. Definition of a production-ready transformation

The project is not complete because the screen looks different. It is complete only when all of the following are true:

- zero unexplained material differences between the canonical mart and approved financial statements;
- zero stale observations shown with active decision color;
- 100% of decision KPIs have approved specifications and period tests;
- 100% of colored decision KPIs have source lineage and a revision identifier;
- low material coverage cannot produce a green composite;
- historical periods do not silently use current external context;
- exact-period recompute is deterministic;
- alerts originate only from decision-grade observations;
- critical UX tasks pass at least 90%;
- no P0/P1 defects and no P2 defect affecting amount, sign, period, status or ownership;
- at least one real close cycle has passed in pilot mode;
- rollback is proven;
- TLS and non-demo credentials are in place before external client access.

## 10. Documentation conventions

Statements in this package use these labels:

- **Verified current behavior:** confirmed by source inspection, tests or a current runtime/database audit.
- **Proposed contract:** required target behavior, not yet implemented.
- **Requires owner decision:** cannot be finalized safely by engineering alone.
- **Deferred:** explicitly excluded from the current release.

No section should be interpreted as proof of implementation unless the roadmap, code, migration, tests and runtime evidence all agree.

/**
 * Hand-authored, per-section guide scenarios (rich, real-UI walkthroughs).
 * produce-guides.mjs loads this; an entry here WINS over browser-guided.json.
 *
 * Shape: export default { "<slug>": { route, title{lang}, scenes:[
 *   { voice:{az,en,ru}, do: async (page, lang, h) => { ... } } ] } }
 *
 * h helpers move the VISIBLE cursor to a real element, then act:
 *   h.hover(sel) · h.safeClick(sel) · h.moveTo(sel) · h.fill(sel,text) · h.sleep(ms)
 * A `sel` may be an array — the first selector that exists wins (fallback chain).
 *
 * Scene length == narration length (recorder holds each scene for its voice
 * duration). So "longer video" = longer narration + more scenes; "more cursor
 * engagement" = several h.* steps inside one `do` (they run in sequence after a
 * ~650 ms voice-lead). Keep ONE meaning-bearing action per scene so cursor and
 * narration stay in sync.
 *
 * ── statement-controls (Phase 10 / B1 shadow slice) ─────────────────────────
 * READONLY-safe by construction: the page is read-only (it only issues a GET
 * against /api/companies/[id]/statement-controls). This scenario ONLY navigates,
 * hovers, selects a company from the dropdown, and clicks Run — it never touches
 * a save/destructive control (there are none here anyway).
 *
 * Stable anchors used (verified in StatementControlsView.tsx / page.tsx):
 *   h1                                       — page title (t("pageTitle"))
 *   [data-testid="statement-controls-shadow-banner"]   — permanent SHADOW banner
 *   [data-testid="statement-controls-company-select"]  — company <select>
 *   the Run <button> (localized text: en "Run controls" · ru "Запустить контроли"
 *                     · az "Kontrolları işə sal"; running-state text as fallback)
 *   [data-testid="statement-controls-result"]          — results container
 *   [data-testid="statement-control-balance_sheet"]    — evaluated card
 *   [data-testid="statement-controls-sign-convention"] — sign/residuals line
 *   [data-testid="statement-control-cash_flow_sum"]    — blocked card
 *   [data-testid="statement-control-reason-cash_flow_sum"] — its missing-evidence reason
 *   [data-testid="statement-control-net_income_link"]  — provisional link card
 *   [data-testid="statement-control-fx_translation"]   — currency-translation card
 *   [data-testid^="statement-control-fx-rate-dates-"]  — independent rate-date line
 *   [data-testid="statement-controls-why"]             — explainer footer
 */

const TITLE = ["main h1", "h1", "main"];
const BANNER = ['[data-testid="statement-controls-shadow-banner"]', "main"];
const BANNER_DETAIL = ['[data-testid="statement-controls-shadow-banner"] p', BANNER[0], "main"];
const COMPANY_SELECT_SEL = '[data-testid="statement-controls-company-select"]';
const COMPANY_SELECT = [COMPANY_SELECT_SEL, "main select"];
const RUN_BTN = '[data-testid="statement-controls-run"]';
// 2026-08-04 — период обязателен для осмысленной записи. Он опционален в UI, но
// без него контроли не находят отчётность и экран показывает пустое состояние
// «əvvəlcə fayl idxal edin» — восемь сцен подряд под озвучку про карточки
// баланса. Поймано просмотром кадров, silencedetect такое не видит.
const PERIOD_INPUT = '[data-testid="statement-controls-period-input"]';
/** Месяц, за который на стенде есть отчётность AZSEKER-AZSF. */
const DEMO_PERIOD = process.env.GUIDE_SC_PERIOD || "2026-05";
const RESULT = '[data-testid="statement-controls-result"]';
const CARD_BS = ['[data-testid="statement-control-balance_sheet"]', "main"];
const SIGN_CONV = ['[data-testid="statement-controls-sign-convention"]', "main"];
const CARD_CFS = ['[data-testid="statement-control-cash_flow_sum"]', "main"];
const CFS_REASON = [
  '[data-testid="statement-control-reason-cash_flow_sum"]',
  '[data-testid="statement-control-cash_flow_sum"] table',
  '[data-testid="statement-control-cash_flow_sum"]',
  "main",
];
const CARD_NI = ['[data-testid="statement-control-net_income_link"]', "main"];
const CARD_FX = ['[data-testid="statement-control-fx_translation"]', "main"];
const FX_DATES = [
  '[data-testid^="statement-control-fx-rate-dates-"]',
  '[data-testid="statement-control-fx_translation"]',
  "main",
];
const WHY = ['[data-testid="statement-controls-why"]', "main"];

// ── Data control group overview ─────────────────────────────────────────
// Hover-only across eight admin routes. Per-scene `route` navigation is a
// full-page GET; no Run, Refresh, e-mail, export, upload, inline-entry or
// provider control is clicked. The detailed Statement Controls guide remains
// a separate slug and is not replaced by this overview.
const DC_READINESS = '[data-testid="data-control-readiness"]';
const DC_READINESS_TABLE = '[data-testid="data-control-readiness-table"]';
const DC_BACKLOG = '[data-testid="data-control-backlog"]';
const DC_BACKLOG_PERIOD = '[data-testid="data-control-backlog-period"]';
const DC_HEALTH = '[data-testid="data-control-indicator-health"]';
const DC_HEALTH_PERIOD = '[data-testid="data-control-indicator-health-period"]';
const DC_STATEMENT = '[data-testid="data-control-statement-controls"]';
const DC_STATEMENT_BANNER = '[data-testid="statement-controls-shadow-banner"]';
const DC_IFRS = '[data-testid="data-control-ifrs"]';
const DC_COMPLIANCE = '[data-testid="data-control-compliance"]';
const DC_DRIFT = '[data-testid="data-control-drift"]';
const DC_DRIFT_FRESHNESS = '[data-testid="data-control-drift-freshness"]';
const DC_INTEL = '[data-testid="data-control-intel-health"]';
const DC_INTEL_SUMMARY = '[data-testid="data-control-intel-health-summary"]';
// Заголовок текущей страницы — второй бит там, где у раздела всего один якорь.
// Обзор ведёт по восьми маршрутам, и на каждом курсор сначала называет экран,
// потом показывает то, о чём идёт речь.
const DC_TITLE = ["main h1", "h1", "main"];

// ── AI Import (Data İmportu) — the real end-to-end workflow ─────────────
// 2026-08-03 rewrite. The previous version of this scenario was hover-only and
// narrated "this guide never presses the button" over nine static blocks — it
// also still described the single-file tab as the landing tab, which stopped
// being true on 2026-07-30 (AIImportTabs defaults to `multi`). A guide to an
// import that never shows an import fails the bar in VIDEO-GUIDES-HANDOFF.md:
// what you say is what you show.
//
// This version drives the real flow on the MULTI tab — pick year, drop a
// workbook, Step 1 (AI analysis = preview, writes nothing), read the routing
// grid and the Import Doctor, then Step 2 (Apply) and the receipt.
//
// Therefore it REQUIRES a mutating stand: a throwaway DB restored from a prod
// dump, launched with ALLOW_MUTATIONS=1. Under READONLY the recorder's
// interceptor aborts the POST behind Step 1 and fails the take by design — do
// not "fix" that by pointing safeClick somewhere softer.
const AI_ROOT = '[data-testid="ai-import-guide-root"]';
const AI_TITLE = ["main h1", "h1", AI_ROOT];
const AI_PIPELINE = '[data-testid="ai-import-guide-pipeline"]';
const AI_SAFETY = '[data-testid="ai-import-guide-safety"]';
const AI_CLEANUP = '[data-testid="ai-import-guide-cleanup"]';
const AI_TABS = '[data-testid="ai-import-guide-tabs"]';
const AI_TAB_MULTI = '[data-testid="tab-multi"]';
const AI_TAB_SINGLE = '[data-testid="tab-single"]';
const AI_TAB_UNIVERSAL = '[data-testid="tab-universal"]';
const AI_TAB_MULTISHEET = '[data-testid="tab-multisheet"]';
const AI_YEAR = '[data-testid="multi-year"]';
// 2026-08-04 — the guarded delete flow, added so the guide SHOWS a clearing
// instead of only saying one exists. Every id below is on the real control,
// harvested from `src/features/admin/components/delete-data/`.
const AI_RESET_CTA = '[data-testid="ai-import-guide-reset-cta"]';
const DD_TASK_CHOOSER = '[data-testid="task-chooser"]';
const DD_COMPANY_PICKER = '[data-testid="company-picker"]';
const DD_WHAT_PICKER = '[data-testid="what-picker"]';
const DD_YEAR_CHIPS = '[data-testid="year-chips"]';
const DD_CHECK = '[data-testid="check-button"]';
// 2026-08-04 — мастер удаления пошаговый: задача → компания → год, и только
// после этого появляется «Проверить». Сценарий раньше лишь наводился на эти
// блоки, ничего не выбирая, поэтому запись падала на check-button (найдено 0).
// Задача и компания получили собственные якоря (их не было); год цепляется по
// числу — оно одинаково на всех трёх языках.
const DD_TASK_CLEAR_YEAR = '[data-testid="task-clearYears"]';
const DD_COMPANY_OPTION = '[data-testid="company-option-AZSEKER-AZSF"]';
/** 2025, а не 2026: год очищается по-настоящему, а на 2026 держатся все
 *  остальные записи стенда. Озвучка год не называет, так что рассказ честен. */
const DD_YEAR_CHIP = '[data-testid="year-chips"] button:has-text("2025")';
const DD_BLAST_RADIUS = '[data-testid="blast-radius"]';
const DD_CONFIRM_STRIP = '[data-testid="confirm-strip"]';
const DD_CONFIRM_SUBMIT = '[data-testid="confirm-submit"]';
const DD_RUN_DONE = '[data-testid="run-result-done"]';
const AI_DROP = '[data-testid="multi-drop-zone"]';
const AI_FILE_INPUT = '[data-testid="multi-file-input"]';
const AI_FILE_ROW = ['[data-testid="file-row-0"]', AI_DROP];
const AI_ANALYZE = '[data-testid="btn-analyze"]';
const AI_TEMPLATE = '[data-testid="use-template-toggle"]';
const AI_PREVIEW = '[data-testid="preview-result"]';
const AI_ROUTING = ['[data-testid="bu-routing-grid"]', '[data-testid="preview-result"]'];
const AI_DOCTOR = ['[data-testid="import-doctor-panel"]', '[data-testid="preview-result"]'];
const AI_DOCTOR_STATUS = [
  '[data-testid="import-doctor-status"]',
  '[data-testid="import-doctor-panel"]',
  '[data-testid="preview-result"]',
];
const AI_APPLY = '[data-testid="btn-apply"]';
const AI_APPLY_RESULT = '[data-testid="apply-result"]';
const AI_RECEIPT = [
  '[data-testid="receipt-preview-self-check"]',
  '[data-testid="step3-done"]',
  '[data-testid="apply-result"]',
];
const AI_OPEN_PNL = ['[data-testid="receipt-open-pnl"]', '[data-testid="apply-result"]'];
const AI_ALIASES = ['[data-testid="entity-aliases-panel"]', AI_ROOT];
const AI_ALIASES_BTN = ['[data-testid="btn-toggle-aliases"]', '[data-testid="entity-aliases-panel"]'];

// The workbook the guide actually imports. Override with GUIDE_IMPORT_XLSX to
// record against the customer's own file — the narration deliberately never
// names the file, so swapping it does not invalidate the voiceover.
const importWorkbook = () =>
  process.env.GUIDE_IMPORT_XLSX
  || new URL("../../e2e/fixtures/test-budget.xlsx", import.meta.url).pathname;

// ── Alert evaluation snapshot guide ────────────────────────────────────
// Strictly hover-only. Opening the route and the feed's initial load issue
// GET requests only. The scenario never submits a rule filter, resets it,
// loads another page, follows a terminal link, recomputes, acknowledges, or
// invokes an AI provider. Every selector below is rendered even with no rows.
const ALERTS_ROOT = '[data-testid="alerts-guide-root"]';
const ALERTS_HEADER = '[data-testid="alerts-guide-header"]';
const ALERTS_SCOPE = '[data-testid="alerts-guide-scope"]';
const ALERTS_FILTER = '[data-testid="alerts-guide-filter"]';
const ALERTS_RULE_INPUT = '[data-testid="alerts-guide-rule-input"]';
const ALERTS_APPLY = '[data-testid="alerts-guide-apply"]';
const ALERTS_RESET = '[data-testid="alerts-guide-reset"]';
const ALERTS_FILTER_DISCLOSURE = '[data-testid="alerts-guide-filter-disclosure"]';
const ALERTS_READING = '[data-testid="alerts-guide-reading"]';
const ALERTS_READ_SEVERITY = '[data-testid="alerts-guide-read-severity"]';
const ALERTS_READ_MESSAGE = '[data-testid="alerts-guide-read-message"]';
const ALERTS_READ_PAGINATION = '[data-testid="alerts-guide-read-pagination"]';
const ALERTS_READ_DEEPLINK = '[data-testid="alerts-guide-read-deeplink"]';
// 2026-08-04 — найдены probe'ом; сценарий их не использовал, из-за чего каждая
// сцена состояла из одного наведения и кадр замирал под озвучку.
const ALERTS_FEED = ['[data-testid="alerts-guide-feed"]', ALERTS_ROOT];
const ALERTS_RESULTS = ['[data-testid="alerts-guide-results"]', ALERTS_ROOT];
const ALERTS_SUMMARY = ['[data-testid="alerts-guide-summary"]', ALERTS_ROOT];
const ALERTS_EVENT_ROW = [
  '[data-testid="alert-event-row"]',
  '[data-testid="alerts-guide-events-list"]',
  ALERTS_ROOT,
];

// ── Board Deck evidence-boundary guide ─────────────────────────────────
// Strictly hover-only. The page, language state and exports are cache-read-only;
// the guide never presses Generate/Refresh, export, print, terminal links or
// any other control. Every selector is present even when narrative, alerts,
// monthly history or qualitative flags are absent.
const BOARD_ROOT = '[data-testid="board-deck-guide-root"]';
const BOARD_HERO = '[data-testid="board-deck-hero"]';
const BOARD_SCORE = '[data-testid="hero-score-caption"]';
const BOARD_EVIDENCE = '[data-testid="board-deck-guide-evidence"]';
const BOARD_AI = '[data-testid="board-deck-guide-ai-boundary"]';
const BOARD_METRICS = '[data-testid="board-deck-metrics-row"]';
const BOARD_TREND = '[data-testid="composite-trend-chart"]';
const BOARD_ALERTS = '[data-testid="board-deck-top-alerts"]';
const BOARD_FLAGS = '[data-testid="board-deck-risk-flags"]';
const BOARD_FOOTER = '[data-testid="board-deck-footer-actions"]';
// 2026-08-04 — найдены probe'ом. Каждая сцена сценария была одним наведением
// на крупный блок; эти якоря позволяют вести курсор по конкретным числам.
// Генерация нарратива и переключатели языка НЕ трогаются: первая — платное
// действие, вторые могут её запустить.
const BOARD_HEADLINE = ['[data-testid="hero-headline"]', BOARD_HERO];
const BOARD_RED_CELLS = ['[data-testid="metric-red-cells-value"]', '[data-testid="metric-red-cells"]', BOARD_METRICS];
const BOARD_RED_SUBCOS = ['[data-testid="metric-red-subcos-value"]', '[data-testid="metric-red-subcos"]', BOARD_METRICS];
const BOARD_COVERAGE = ['[data-testid="metric-indicator-coverage-value"]', '[data-testid="metric-indicator-coverage"]', BOARD_METRICS];
// Последняя точка тренда: самый свежий месяц на графике.
const BOARD_TREND_LAST = ['[data-testid="trend-point-2026-08"]', '[data-testid="trend-line"]', BOARD_TREND];
const BOARD_ALERTS_LIST = ['[data-testid="top-alerts-list"]', BOARD_ALERTS];

// ── Workspace / P&L execution view ────────────────────────────────────────
// READONLY-safe: the only clicks toggle local list/matrix/materiality state.
// No export, sync, create, edit, save or delete action is touched.
const WS_TITLE = ["main h1", "h1", "main"];
const WS_PLAN = ["main select >> nth=0", "main select"];
const WS_COMPANY = ["main select >> nth=1", "main select"];
const WS_CONTEXT = ['[data-testid="workspace-execution-context"]', "main"];
const WS_KPIS = ['[data-testid="workspace-kpis"]', "main"];
const WS_REVENUE = ['[data-testid="workspace-kpi-revenue"]', WS_KPIS[0]];
const WS_COGS = ['[data-testid="workspace-kpi-cogs"]', WS_KPIS[0]];
const WS_EXPENSES = ['[data-testid="workspace-kpi-expenses"]', WS_KPIS[0]];
const WS_PROFIT = ['[data-testid="workspace-kpi-operating-profit"]', WS_KPIS[0]];
const WS_WATERFALL = ['[data-testid="workspace-waterfall"]', "main"];
const WS_GAUGE = ['[data-testid="workspace-execution-gauge"]', "main"];
const WS_CATEGORY_BARS = ['[data-testid="workspace-category-bars"]', "main"];
const WS_CONTROLS = ['[data-testid="workspace-controls"]', "main"];
const WS_MATERIAL = '[data-testid="workspace-material-filter"]';
const WS_MATRIX_BUTTON = '[data-testid="workspace-view-matrix"]';
const WS_LIST_BUTTON = '[data-testid="workspace-view-list"]';
const WS_MATRIX = ['[data-testid="workspace-matrix"]', "main"];
const WS_TABLE = ['[data-testid="workspace-table"]', "main table", "main"];

// ── Cash Flow guide readiness ─────────────────────────────────────────────
// Production-safe with READONLY=true. Only the Entries/Overview local-state
// tabs are clicked. Generate, alerts, inline fields and delete controls are
// deliberately never passed to safeClick. The evidence selector is honest for
// both states: real chart/table when rows exist, explicit empty-state otherwise.
const CF_ROOT = '[data-testid="cash-flow-guide-root"]';
const CF_HEADER = '[data-testid="cash-flow-guide-header"]';
const CF_TABS = '[data-testid="cash-flow-subview-tabs"]';
const CF_OVERVIEW_BUTTON = '[data-testid="cash-flow-subview-overview"]';
const CF_ENTRIES_BUTTON = '[data-testid="cash-flow-subview-entries"]';
const CF_GENERATE = '[data-testid="cash-flow-generate-from-budget"]';
const CF_OVERVIEW = '[data-testid="cash-flow-overview"]';
const CF_EVIDENCE = [
  '[data-testid="cash-flow-chart"]',
  '[data-testid="cash-flow-empty-state"]',
];
const CF_TOTALS = [
  '[data-testid="cash-flow-chart-totals"]',
  '[data-testid="cash-flow-empty-state"]',
];
const CF_MONTHLY = [
  '[data-testid="cash-flow-monthly-table"]',
  '[data-testid="cash-flow-empty-state"]',
];
const CF_ENTRIES_VIEW = '[data-testid="cash-flow-entries-view"]';
const CF_ENTRIES_EVIDENCE = [
  '[data-testid="cash-flow-entry-list"]',
  '[data-testid="cash-flow-entries-empty"]',
];

// ── Balance Sheet guide readiness ────────────────────────────────────────
// READONLY-safe: section buttons only change local expansion state. Import,
// inline number inputs, plan selectors, AI actions and blur-save are excluded.
const BS_ROOT = '[data-testid="balance-sheet-guide-root"]';
const BS_SOURCE = [
  '[data-testid="balance-sheet-provenance"]',
  '[data-testid="balance-sheet-guide-root"]',
];
const BS_CONSOLIDATED = [
  '[data-testid="balance-sheet-consolidated"]',
  '[data-testid="balance-sheet-guide-root"]',
];
const BS_EDIT_WARNING = [
  '[data-testid="balance-sheet-edit-warning"]',
  '[data-testid="balance-sheet-guide-root"]',
];
const BS_KPIS = '[data-testid="balance-sheet-kpis"]';
const BS_ASSETS = '[data-testid="balance-sheet-kpi-assets"]';
const BS_LIABILITIES = '[data-testid="balance-sheet-kpi-liabilities"]';
const BS_EQUITY = '[data-testid="balance-sheet-kpi-equity"]';
const BS_DE = '[data-testid="balance-sheet-kpi-debt-equity"]';
const BS_STRUCTURE = '[data-testid="balance-sheet-structure-chart"]';
const BS_COMPOSITION = '[data-testid="balance-sheet-asset-composition"]';
const BS_DETAIL = '[data-testid="balance-sheet-detail"]';
const BS_ASSETS_TOGGLE = '[data-testid="balance-sheet-section-assets"]';
const BS_LIABILITIES_TOGGLE = '[data-testid="balance-sheet-section-liabilities"]';
const BS_EQUITY_TOGGLE = '[data-testid="balance-sheet-section-equity"]';

// ── Forecast guide readiness ─────────────────────────────────────────────
// READONLY-safe: scenario and section buttons only change local React state.
// Settings inputs, editable amount cells, Add row, Save and AI actions are not
// clicked or filled. The narration distinguishes saved monthly overrides from
// the plan-derived baseline and never presents missing evidence as actuals.
const FC_ROOT = '[data-testid="forecast-guide-root"]';
const FC_PROVENANCE = '[data-testid="forecast-provenance"]';
const FC_CURRENCY = [
  '[data-testid="forecast-currency-known"]',
  '[data-testid="forecast-currency-unknown"]',
];
const FC_KPIS = '[data-testid="forecast-kpis"]';
const FC_MONTHLY = '[data-testid="forecast-monthly-trend"]';
const FC_COMPARISON = '[data-testid="forecast-scenario-comparison"]';
const FC_SETTINGS = '[data-testid="forecast-settings-toggle"]';
const FC_PNL = '[data-testid="forecast-pnl-summary"]';
const FC_MATRIX = '[data-testid="forecast-matrix"]';
const FC_BASE = '[data-testid="forecast-scenario-base"]';
const FC_OPTIMISTIC = '[data-testid="forecast-scenario-optimistic"]';
const FC_PESSIMISTIC = '[data-testid="forecast-scenario-pessimistic"]';
const FC_REVENUE = '[data-testid="forecast-section-revenue"]';
const FC_COGS = '[data-testid="forecast-section-cogs"]';
const FC_EXPENSE = '[data-testid="forecast-section-expense"]';

// ── Comparison guide readiness ───────────────────────────────────────────
// READONLY-safe: the two guide slots are deterministic populated compatible
// plans (annual actuals on current production data). Selecting them changes
// local state and issues GET analytics only. Numeric threshold inputs and
// create/import/edit/delete/approval actions are never touched.
const CMP_ROOT = '[data-testid="comparison-guide-root"]';
const CMP_PROVENANCE = '[data-testid="comparison-provenance"]';
const CMP_CURRENCY = [
  '[data-testid="comparison-currency-known"]',
  '[data-testid="comparison-currency-unknown"]',
];
const CMP_PICKER = '[data-testid="comparison-plan-picker"]';
const CMP_PRIMARY = '[data-guide-slot="primary"]';
const CMP_SECONDARY = '[data-guide-slot="secondary"]';
const CMP_BASIS = '[data-testid="comparison-basis"]';
const CMP_KPIS = '[data-testid="comparison-kpis"]';
const CMP_CHART = '[data-testid="comparison-category-chart"]';
const CMP_TOTALS = '[data-testid="comparison-opex-totals"]';
const CMP_ABSENCE = [
  '[data-testid="comparison-actuals-absence"]',
  '[data-testid="comparison-table"]',
];
const CMP_TABLE = '[data-testid="comparison-table"]';

const PLANS_ROOT = '[data-testid="plans-guide-root"]';
const PLANS_PROVENANCE = '[data-testid="plans-provenance"]';
const PLANS_COUNT = '[data-testid="plans-count"]';
const PLANS_CARD = '[data-testid^="plans-card-"]';
const PLANS_EVIDENCE = '[data-testid^="plans-evidence-"]';
const PLANS_STATUS = '[data-testid^="plans-status-"]';
const PLANS_CURRENCY = '[data-testid="plans-currency-scope"]';
const PLANS_APPROVAL = '[data-testid="plans-approval-workflow"]';
const PLANS_APPROVAL_HISTORY = [
  '[data-testid="plans-approval-history"]',
  '[data-testid="plans-approval-history-empty"]',
  '[data-testid="plans-approval-history-error"]',
  '[data-testid="plans-approval-history-loading"]',
];
const PLANS_VERSION = [
  '[data-testid="plans-version-history"]',
  '[data-testid="plans-version-error"]',
  '[data-testid="plans-version-loading"]',
  '[data-testid="plans-version-empty"]',
];
const PLANS_MUTATIONS = '[data-testid="plans-readonly-disclosure"]';

// ── Risk Terminal overview guide readiness ───────────────────────────────
// READONLY-safe: exactly two clicks change client-side selection and issue
// GET-only detail reads. The scenario never activates Explain, Recompute,
// scenario simulation, alerts, exports, layouts or any provider-backed action.
const TERM_ROOT = '[data-testid="terminal-guide-root"]';
const TERM_TOOLBAR = '[role="toolbar"]';
const TERM_COMMAND = '[data-cmd-bar="true"]';
const TERM_TREE = '[role="tree"]';
const TERM_COMPANY = '[data-testid="company-tree-row"][data-company-code="AZSEKER-AZSF"]';
const TERM_SNAPSHOT = '[data-testid="snapshot-card"]';
const TERM_TRUST = '[data-testid="heatmap-provisional-badge"]';
const TERM_MATRIX = '#risk-heatmap-table';
const TERM_CELL = '[data-company-code="AZSEKER-AZSF"][data-indicator-code="FP_GROSS_MARGIN"]';
const TERM_DETAIL = '[data-testid="terminal-panel-3"]';
const TERM_VARIANCE = '[data-testid="terminal-panel-4"]';
const TERM_PERIODS = '[data-testid="period-chips"]';
const TERM_AUDIT = '[data-testid="audit-ticker"]';

// Select AZSEKER (code AZSF) from the company <select>. READONLY-safe: selecting
// an option only changes local React state; the fetch is a GET. Find the option
// whose text names AZSEKER/AZSF (label is "<code> · <name>"), else the first real
// option, then drive Playwright's native selectOption so React's onChange fires.
const selectCompany = async (p, h) => {
  await h.moveTo(COMPANY_SELECT);
  await h.sleep(200);
  const value = await p
    .$eval(COMPANY_SELECT_SEL, (el) => {
      const opts = [...el.options].filter((o) => o.value);
      // Именно операционная компания: у родительского «AZSEKER» отчётности нет,
      // и раньше выбор падал на него первым — экран выходил пустым.
      const hit =
        opts.find((o) => /azsf/i.test(o.textContent || "")) ||
        opts.find((o) => /azseker/i.test(o.textContent || "")) ||
        opts[0];
      return hit ? hit.value : "";
    })
    .catch(() => "");
  if (value) {
    const sel = await h.firstLocator(COMPANY_SELECT);
    await sel?.selectOption(value).catch(() => {});
  }
  await h.sleep(400);
};

// ── Indicator backlog anchors ───────────────────────────────────────────
// Every one of these is a read-only surface or a client-state control; the
// page issues a single GET and nothing here can write. Verified live against
// the stand before recording (handoff rule #2).
const IB_TITLE = ["main h1", "h1", "main"];
const IB_PERIOD = '[data-testid="data-control-backlog-period"]';
const IB_KPI_ENTITIES = '[data-testid="backlog-kpi-entities"]';
const IB_KPI_APPLICABLE = '[data-testid="backlog-kpi-applicable"]';
const IB_KPI_PRESENT = '[data-testid="backlog-kpi-present"]';
const IB_KPI_MISSING = '[data-testid="backlog-kpi-missing"]';
const IB_KPI_READINESS = '[data-testid="backlog-kpi-readiness"]';
const IB_PROGRESS = '[data-testid="backlog-progress"]';
const IB_BY_OWNER = '[data-testid="backlog-by-owner"]';
// The dashed amber chip: gaps with nobody assigned. Exactly one per page.
const IB_OWNER_UNKNOWN = '[data-testid="backlog-owner-chip"][data-owner-unknown="1"]';
const IB_FILTERS = '[data-testid="backlog-filters"]';
const IB_HIDE_COMPLETE = '[data-testid="backlog-hide-complete"]';
const IB_SHOWN_COUNT = '[data-testid="backlog-shown-count"]';
const IB_ENTITY_CARD = ['[data-testid="backlog-entity-card"]', "main"];
const IB_ENTITY_SUMMARY = ['[data-testid="backlog-entity-summary"]', '[data-testid="backlog-entity-card"]'];
const IB_ENTITY_PRESENT = ['[data-testid="backlog-entity-present"]', '[data-testid="backlog-entity-card"]'];
const IB_ENTITY_MISSING = ['[data-testid="backlog-entity-missing"]', '[data-testid="backlog-entity-card"]'];
const IB_ENTITY_ACTIONS = ['[data-testid="backlog-entity-actions"]', '[data-testid="backlog-entity-card"]'];
// Hover targets only — never clicked. See the scenario note.
const IB_CSV = ['[data-testid="backlog-csv"]', '[data-testid="backlog-entity-actions"]'];
const IB_EMAIL = ['[data-testid="backlog-email"]', '[data-testid="backlog-entity-actions"]'];
const IB_UPLOAD = ['[data-testid="backlog-upload"]', '[data-testid="backlog-entity-actions"]'];


// ── Assumptions (Fərziyyələr) — budget drivers ──────────────────────────
// Every anchor is a data-testid added in the same change as this scenario, so
// the take does not hang off CSS classes or translated text.
const AS_ROOT = ['[data-testid="assumptions-root"]', "main"];
const AS_DETAILS = ['[data-testid="assumptions-details-title"]', AS_ROOT[0], "main"];
const AS_ADD = ['[data-testid="assumptions-add"]', '[data-testid="assumptions-add-first"]', AS_ROOT[0]];
const AS_ROW_PLAN = ['[data-assumption-scope="plan"]', '[data-testid="assumptions-row"]', AS_ROOT[0]];
const AS_ROW_COMPANY = ['[data-assumption-scope="company"]', '[data-testid="assumptions-row"]', AS_ROOT[0]];
const AS_ROW_RIGIDITY = ['[data-assumption-key="cost_rigidity"]', '[data-testid="assumptions-row"]', AS_ROOT[0]];
// Dialog — opened by AS_ADD. Unlike the first version of this guide, the take
// now SAVES: AS_SAVE is driven with `mutatingClick`, which refuses to run under
// READONLY, so this scenario can only ever be recorded against a throwaway
// stand. See the block comment on the scenario itself.
const AS_EDITOR = ['[data-testid="assumption-editor"]', "main"];
const AS_F_KEY = ['[data-testid="assumption-field-key"]', AS_EDITOR[0]];
const AS_F_VALUE = ['[data-testid="assumption-field-value"]', AS_EDITOR[0]];
const AS_F_SCOPE = ['[data-testid="assumption-field-scope"]', AS_EDITOR[0]];
const AS_F_NOTES = ['[data-testid="assumption-field-notes"]', AS_EDITOR[0]];
const AS_SAVE = ['[data-testid="assumption-save"]', AS_EDITOR[0]];

// ── Risk terminal — where an assumption stops being a premise and becomes a
// number. The guide crosses into it twice, before and after the save, and that
// pair of readings is the whole point of the take.
const TM_SIGNALS = ['[data-testid="signals-strip"]', "main"];
// The terminal opens on the year it considers current, which is not always the
// year the assumptions were written for — and an assumption is loaded by plan
// year. Recorded once on 2025 by accident, the take ran a scenario that could
// not see the row it had just saved and would have shown an unchanged number
// while the narration claimed a change. The period is now chosen explicitly.
const TM_YEAR_2026 = ['[data-testid="period-year-2026"]', '[data-testid="period-chips"]', "main"];
const TM_SIGNAL_DROUGHT = ['[data-testid="signal-drought"]', TM_SIGNALS[0]];
const TM_SCENARIO_DROUGHT = ['[data-testid="scenario-row-DROUGHT_2026"]', "main"];
const TM_RUN_CRISIS = ['[data-testid="scenario-run-crisis"]', "main"];
const TM_BRIEF = ['[data-testid="crisis-brief-panel"]', "main"];
const TM_WORST_HIT = ['[data-testid="crisis-worst-hit"]', TM_BRIEF[0]];
const TM_WORST_CPC = ['[data-testid="worst-hit-AZSEKER-CPC"]', TM_WORST_HIT[0]];

export default {
  // Assumptions (Fərziyyələr) — the FULL cycle, deliberately.
  //
  // The first take of this guide only talked: it hovered the Add button and
  // described a form nobody saw filled, because it was recorded against
  // production where the recorder degrades every click to a hover. The owner's
  // verdict was blunt and correct — "ты тут никаких действий не сделал, только
  // рассказываешь" — and then, more demanding still: save it for real and show
  // what it did to the company's numbers, moving to the section where those
  // numbers live.
  //
  // So this scenario WRITES. It saves a real assumption row and re-runs a real
  // crisis simulation over it, which means it can only be recorded against a
  // throwaway stand launched with ALLOW_MUTATIONS=1 — `mutatingClick` refuses
  // under READONLY, so there is no way to point this at prod by accident.
  //
  // The demonstration is measured, not asserted (verified 2026-08-07 against a
  // copy of the production database):
  //
  //   CPC under DROUGHT_2026, no sunk-cost share stated → 90 → 80,
  //     gross margin 23.9% → −2.2%   (the catalogue's generic 0.8 applied)
  //   the same company after `cost_rigidity = 0.20` is saved → 90 → 86,
  //     gross margin no longer collapses
  //
  // Six points of a crisis score, from one row a controller typed. That is the
  // whole argument for the section, and the take shows it happening rather
  // than describing it.
  "assumptions": {
    route: "/budgeting?tab=assumptions",
    title: {
      az: "Fərziyyələr — büdcənin əsas amilləri",
      en: "Assumptions — the drivers a budget is built on",
      ru: "Допущения — предпосылки, на которых собран бюджет",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Fərziyyələr bölməsidir. Burada hesabat deyil, büdcənin qurulduğu ilkin şərtlər saxlanılır: valyuta məzənnələri, sərfiyyat normaları, xərclərdə idxalın payı. Hesabat «nə qədər» sualına cavab verir, bu bölmə isə «niyə məhz bu qədər» sualına. Bu gün sadəcə danışmayacağam: bir amil yazacağam, yadda saxlayacağam və sonra sizə göstərəcəyəm ki, konkret şirkətin rəqəmləri necə dəyişdi.",
          en: "This is the Assumptions section. It holds no results — it holds the premises a budget was built from: exchange rates, consumption norms, the share of imported cost. A report answers how much; this section answers why that much. Today I will not merely describe it: I will enter one driver, save it, and then show you how a specific company's numbers changed because of it.",
          ru: "Это раздел «Допущения». Здесь не отчётность, а предпосылки, из которых собран бюджет: курсы валют, нормы расхода, доля импорта в затратах. Отчёт отвечает на вопрос «сколько», а этот раздел — «почему именно столько». Сегодня я не буду просто рассказывать: я впишу один драйвер, сохраню его и потом покажу, как из-за этого изменились цифры конкретной компании.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(AS_ROOT[0], { timeout: 20000 }).catch(() => {});
          await h.moveTo(AS_ROOT);
          await h.holdUntil(0.45);
          await h.hover(AS_DETAILS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Cədvələ baxaq. Hər sətrin tətbiq sahəsi var. Boz «Plan» nişanı o deməkdir ki, dəyər holdinqin bütün şirkətlərinə aid defolt dəyərdir. Şirkət kodu olan nişan isə əvəzetmədir: yalnız həmin şirkət üçün işləyir və plan defoltunu üstələyir. Beləliklə, bir parametr həm ümumi qaydanı, həm də istisnaları təsvir edir.",
          en: "Look at the table. Every row carries a scope. The grey Plan badge means the value is the default for every company in the holding. A badge with a company code is an override: it applies to that company alone and beats the plan default. One parameter therefore describes both the general rule and its exceptions.",
          ru: "Посмотрим на таблицу. У каждой строки есть область применения. Серый бейдж «План» означает значение по умолчанию для всех компаний холдинга. Бейдж с кодом компании — это переопределение: оно действует только для неё и перекрывает план-дефолт. Так один параметр описывает и общее правило, и исключения из него.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AS_ROW_PLAN);
          await h.holdUntil(0.4);
          await h.hover(AS_ROW_PLAN);
          await h.holdUntil(0.65);
          await h.hover(AS_ROW_COMPANY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İkinci amilə diqqət yetirin — batmış xərclərin payı. Bu, həcm düşəndə yerində qalan xərclərin hissəsidir. Kənd təsərrüfatında o yüksəkdir: toxum, gübrə və suvarma məhsuldan çox əvvəl xərclənir. Emal müəssisəsində isə əksinə ola bilər — həcm düşür, xammal alışı da düşür. Cədvəldə bu pay yalnız bir şirkət üçün göstərilib. Qalanları üçün sistem kataloqun ümumi dəyərini götürür. Məhz bunu indi düzəldəcəyik.",
          en: "Look at the second driver — the sunk-cost share: how much of the cost stays put when volume falls. In farming it is high; seed, fertiliser and irrigation are spent long before the harvest. In a processing plant it can be the opposite — volume falls and raw-material purchasing falls with it. In this table the share is stated for one company only. For the others the system falls back to a generic catalogue value. That is exactly what we are about to fix.",
          ru: "Обратите внимание на второй драйвер — долю невозвратных затрат. Это та часть затрат, которая остаётся на месте, когда падает объём. В сельском хозяйстве она высокая: семена, удобрения и полив тратятся задолго до урожая. А на перерабатывающем заводе может быть наоборот — падает объём, падают и закупки сырья. В таблице эта доля указана только для одной компании. Для остальных система берёт общее каталожное значение. Именно это мы сейчас и исправим.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AS_ROW_RIGIDITY);
          await h.holdUntil(0.5);
          await h.hover(AS_ROW_RIGIDITY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Amma əvvəlcə «əvvəl»i qeyd edək. Risk terminalına keçirəm. Birinci addım — dövrü seçmək: iki min iyirmi altıncı il, çünki fərziyyələr məhz həmin ilin planında yazılıb. Səhv il seçsəniz, hesablama sizin sətrinizi ümumiyyətlə görməyəcək. İndi quraqlıq ssenarisini cari fərziyyələrlə işə salacağam — bu, dəyişiklikdən əvvəlki vəziyyətdir.",
          en: "But first let us record the before. I move to the risk terminal. Step one is the period: twenty twenty-six, because that is the plan year the assumptions are written against. Pick the wrong year and the calculation will not see your row at all. Now I run the drought scenario on the current assumptions — the state before any change.",
          ru: "Но сначала зафиксируем «до». Перехожу в риск-терминал. Первый шаг — выбрать период: две тысячи двадцать шестой год, потому что допущения записаны именно в плане этого года. Выберете не тот год — расчёт вашу строку просто не увидит. Теперь запускаю сценарий засухи на текущих допущениях: это состояние до изменения.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.3);
          await h.goto("/budgeting/terminal");
          await p.waitForSelector(TM_SIGNALS[0], { timeout: 60000 }).catch(() => {});
          await h.moveTo(TM_YEAR_2026);
          await h.holdUntil(0.6);
          await h.safeClick(TM_YEAR_2026[0]);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Yuxarıdakı zolaq — canlı siqnallar. Quraqlıq xəbərdarlığına klikləyirəm: sistem özü müvafiq ssenarini açır. Siyahıdan «Quraqlıq — məhsul mənfi otuz faiz» seçirəm və «Böhranı işə sal» düyməsini basıram. Bu, real hesablamadır: hər şirkət üçün gəlir, maya dəyəri və marja yenidən hesablanır.",
          en: "The strip at the top is the live signal feed. I click the drought alert and the system opens the matching scenario itself. From the list I pick drought — harvest minus thirty per cent — and press Run crisis. This is a real computation: revenue, cost and margin are re-derived for every company.",
          ru: "Полоса сверху — живые сигналы. Кликаю по предупреждению о засухе, и система сама открывает соответствующий сценарий. В списке выбираю «Засуха — урожай минус тридцать процентов» и нажимаю «Запустить кризис». Это реальный расчёт: для каждой компании заново выводятся выручка, себестоимость и маржа.",
        },
        do: async (p, l, h) => {
          await h.moveTo(TM_SIGNAL_DROUGHT);
          await h.holdUntil(0.22);
          await h.safeClick(TM_SIGNAL_DROUGHT[0]);
          await p.waitForSelector(TM_SCENARIO_DROUGHT[0], { timeout: 30000 });
          await h.holdUntil(0.45);
          await h.safeClick(TM_SCENARIO_DROUGHT[0]);
          await p.waitForSelector(TM_RUN_CRISIS[0], { timeout: 20000 });
          await h.holdUntil(0.66);
          await h.safeClick(TM_RUN_CRISIS[0]);
          await p.waitForSelector(TM_BRIEF[0], { timeout: 180000 });
          // Fail loudly rather than hover nothing: `h.hover` walks its fallback
          // list, so a missing company chip would quietly land the cursor on the
          // container and the narration would name a number that is not there.
          await p.waitForSelector(TM_WORST_CPC[0], { timeout: 30000 });
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Nəticə hazırdır. Ən çox zərər görən şirkətlər arasında CPC var: kompozit balı doxsandan səksənə düşür. Bu rəqəmi yadda saxlayın — doxsandan səksənə. Bu hesablamada CPC üçün batmış xərclərin payı onun öz məlumatı deyil: şirkət heç nə bildirmədiyi üçün sistem kataloqun ümumi dəyərini — səksən faizi — tətbiq etdi.",
          en: "The result is in. Among the worst-hit companies is CPC: its composite score falls from ninety to eighty. Remember that pair — ninety to eighty. In this run the sunk-cost share used for CPC is not its own figure: because the company has stated nothing, the system applied the catalogue's generic eighty per cent.",
          ru: "Результат готов. Среди наиболее пострадавших — CPC: композитный балл падает с девяноста до восьмидесяти. Запомните эту пару — девяносто к восьмидесяти. В этом расчёте доля невозвратных затрат для CPC не её собственная: компания ничего не заявила, и система применила общее каталожное значение — восемьдесят процентов.",
        },
        do: async (p, l, h) => {
          await h.moveTo(TM_WORST_HIT);
          await h.holdUntil(0.35);
          await h.hover(TM_WORST_CPC);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi bu şirkət üçün öz dəyərini yazaq. Fərziyyələr bölməsinə qayıdıram və «Əlavə et» düyməsini basıram — forma açılır.",
          en: "Now let us state that company's own figure. I return to the Assumptions section and press Add — the form opens.",
          ru: "Теперь впишем для этой компании её собственное значение. Возвращаюсь в раздел «Допущения» и нажимаю «Добавить» — открывается форма.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.goto("/budgeting?tab=assumptions");
          await p.waitForSelector(AS_ROOT[0], { timeout: 30000 }).catch(() => {});
          await h.moveTo(AS_ADD);
          await h.holdUntil(0.6);
          await h.safeClick(AS_ADD[0]);
          await p.waitForSelector(AS_EDITOR[0], { timeout: 15000 });
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Ən vacib sahə — amilin özü. Onu siyahıdan seçirsiniz, əl ilə yazmırsınız. Siyahı iki hissəyə bölünüb: «hesablamalarda istifadə olunur» və «şərt kimi qeyd olunur». Birincidən seçim ssenariyə real təsir edir, ikincisi isə yalnız əsaslandırmanı saxlayır. «Batmış xərclərin payı»nı seçirəm — sistem kateqoriyanı və ölçü vahidini özü doldurur.",
          en: "The most important field is the driver itself. You pick it from a list rather than typing it, and the list is split in two: used in calculations, and recorded as a premise. A choice from the first genuinely affects the scenario; the second only stores the reasoning. I pick the sunk-cost share — the system fills in the category and the unit for me.",
          ru: "Самое важное поле — сам драйвер. Его выбирают из списка, а не печатают, и список разделён надвое: «участвуют в расчётах» и «фиксируются как предпосылка». Выбор из первой части реально влияет на сценарий, вторая только сохраняет обоснование. Выбираю «Доля невозвратных затрат» — система сама подставляет категорию и единицу измерения.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AS_F_KEY);
          await h.holdUntil(0.3);
          await h.safeSelect(AS_F_KEY[0], "cost_rigidity");
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Dəyər və tətbiq sahəsi. Burada əsas tələ var: pay kəsr kimi yazılır. Sıfır tam iki yazıram — iyirmi yox. İyirmi yazsanız, sistem sükutla yenidən hesablamayacaq: dəyəri istifadə etməkdən imtina edəcək və səbəbini açıq deyəcək. Tətbiq sahəsində CPC şirkətini seçirəm — dəyər yalnız ona aid olacaq. Aşağıdakı «Niyə» sahəsi rəqəmin özündən vacibdir: mənbə, metod, kimin razılaşdırdığı. Məhz bunu idarə heyətində soruşurlar.",
          en: "Value and scope. Here is the main trap: a share is written as a fraction. I type zero point two — not twenty. If you type twenty the system will not silently rescale it; it refuses the value and says why. For scope I select the company CPC, so the value applies to it alone. The Why field below matters more than the number itself: the source, the method, who agreed it. That is exactly what a board asks about.",
          ru: "Значение и область применения. Здесь главная ловушка: доля пишется дробью. Набираю ноль целых две десятых — не двадцать. Если написать двадцать, система не пересчитает молча: она откажется от значения и прямо скажет почему. В области применения выбираю компанию CPC — значение будет действовать только для неё. Поле «Почему» ниже важнее самого числа: источник, метод, кто согласовал. Именно это спрашивают на совете директоров.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AS_F_VALUE);
          await h.holdUntil(0.2);
          await h.safeFill(AS_F_VALUE[0], "0.2");
          await h.holdUntil(0.45);
          await h.safeSelect(AS_F_SCOPE[0], { labelContains: "CPC" });
          await h.holdUntil(0.66);
          await h.safeFill(AS_F_NOTES[0], "Xammal alışı həcmlə birlikdə azalır — satınalma müqavilələri üzrə");
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi yadda saxlayıram. Bu, real yazıdır — sətir cədvəldə öz tətbiq sahəsi nişanı ilə görünür və bundan sonra bütün hesablamalar onu oxuyur.",
          en: "Now I save it. This is a real write — the row appears in the table with its own scope badge, and from this moment every calculation reads it.",
          ru: "Теперь сохраняю. Это настоящая запись — строка появляется в таблице со своим бейджем области применения, и с этого момента её читают все расчёты.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AS_SAVE);
          await h.holdUntil(0.3);
          await h.mutatingClick(AS_SAVE[0]);
          await p.waitForSelector(AS_EDITOR[0], { state: "detached", timeout: 20000 }).catch(() => {});
          await h.holdUntil(0.7);
          await h.moveTo(AS_ROW_RIGIDITY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi ən vacib hissə. Terminala qayıdıram və eyni quraqlıq ssenarisini yenidən işə salıram — heç nə dəyişmədi, yalnız bir sətir əlavə olundu.",
          en: "Now the part that matters. I go back to the terminal and run the very same drought scenario again — nothing else changed, only that one row was added.",
          ru: "Теперь самое главное. Возвращаюсь в терминал и запускаю тот же самый сценарий засухи ещё раз — ничего больше не изменилось, добавилась только одна строка.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.2);
          await h.goto("/budgeting/terminal");
          await p.waitForSelector(TM_SIGNALS[0], { timeout: 60000 }).catch(() => {});
          await h.safeClick(TM_YEAR_2026[0]);
          await h.holdUntil(0.35);
          await h.safeClick(TM_SIGNAL_DROUGHT[0]);
          await p.waitForSelector(TM_SCENARIO_DROUGHT[0], { timeout: 30000 });
          await h.holdUntil(0.5);
          await h.safeClick(TM_SCENARIO_DROUGHT[0]);
          await p.waitForSelector(TM_RUN_CRISIS[0], { timeout: 20000 });
          await h.holdUntil(0.66);
          await h.safeClick(TM_RUN_CRISIS[0]);
          await p.waitForSelector(TM_BRIEF[0], { timeout: 180000 });
          // Fail loudly rather than hover nothing: `h.hover` walks its fallback
          // list, so a missing company chip would quietly land the cursor on the
          // container and the narration would name a number that is not there.
          await p.waitForSelector(TM_WORST_CPC[0], { timeout: 30000 });
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Baxın. CPC-nin balı artıq doxsandan səksənə deyil, doxsandan səksən altıya düşür. Altı bal fərq. Şirkət eynidir, ssenari eynidir, məlumatlar eynidir — dəyişən yalnız odur ki, şirkət öz xərc quruluşunu bəyan etdi. Ümumi kataloq dəyəri onu daha ağır göstərirdi.",
          en: "Look at it. CPC no longer falls from ninety to eighty — it falls from ninety to eighty-six. Six points of difference. Same company, same scenario, same data; the only thing that changed is that the company stated its own cost structure. The generic catalogue value had been making it look worse than it is.",
          ru: "Смотрите. CPC теперь падает не с девяноста до восьмидесяти, а с девяноста до восьмидесяти шести. Разница в шесть баллов. Компания та же, сценарий тот же, данные те же — изменилось только то, что компания заявила собственную структуру затрат. Общее каталожное значение делало её положение хуже, чем оно есть.",
        },
        do: async (p, l, h) => {
          await h.moveTo(TM_WORST_HIT);
          await h.holdUntil(0.3);
          await h.hover(TM_WORST_CPC);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Yekun sadədir. Fərziyyələr bölməsi hesabat deyil — ssenarilərin oxuduğu mənbədir. Doldurulmayan sətir yoxa çıxmır: onun yerinə ümumi dəyər tətbiq olunur və nəticə sizin biznesiniz haqqında yox, defolt haqqında olur. Buradakı bir neçə sətir ssenariləri kalkulyatordan əsaslandırılmış hesablamaya çevirir.",
          en: "The takeaway is simple. Assumptions is not a report — it is the source scenarios read. A row you do not fill in does not disappear: a generic value stands in for it, and the answer stops being about your business and becomes about a default. A handful of rows here turn the scenarios from a calculator into a grounded calculation.",
          ru: "Вывод простой. «Допущения» — это не отчёт, а источник, который читают сценарии. Незаполненная строка не исчезает: вместо неё подставляется общее значение, и ответ перестаёт быть про ваш бизнес и становится про дефолт. Несколько строк здесь превращают сценарии из калькулятора в обоснованный расчёт.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.goto("/budgeting?tab=assumptions");
          await p.waitForSelector(AS_ROOT[0], { timeout: 30000 }).catch(() => {});
          await h.moveTo(AS_ROOT);
          await h.holdUntil(0.6);
          await h.hover(AS_ROW_RIGIDITY);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "workspace": {
    route: "/budgeting?tab=workspace",
    title: {
      az: "İş sahəsi — plan və fakt P&L",
      en: "Workspace — plan versus actual P&L",
      ru: "Рабочая область — план и факт P&L",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Büdcələşdirmə bölməsinin əsas İş sahəsidir. Ekran bir seçilmiş büdcə planını fakt məlumatları ilə yanaşı göstərir və gəlir, maya dəyəri, əməliyyat xərcləri və əməliyyat mənfəəti üzrə rəhbər baxışı verir. Yuxarıdakı plan siyahısından il və ssenarini, yanındakı siyahıdan isə bütün holdinqi və ya ayrıca əməliyyat şirkətini seçmək olar.",
          en: "This is the main Budgeting Workspace. It places one selected budget plan beside realized actuals and gives management a single view of revenue, cost of goods sold, operating expenses and operating profit. The first selector chooses the year and plan; the second switches between the consolidated holding and an individual operating company.",
          ru: "Это основная Рабочая область раздела бюджетирования. Она ставит выбранный бюджетный план рядом с фактическими данными и даёт руководителю единый взгляд на выручку, себестоимость, операционные расходы и операционную прибыль. Первый список выбирает год и план, второй переключает весь холдинг или отдельную операционную компанию.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_TITLE);
          await h.holdUntil(0.35);
          await h.hover(WS_PLAN);
          await h.holdUntil(0.7);
          await h.moveTo(WS_COMPANY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Əvvəlcə dövr kontekstini oxuyun. Fakt yalnız ilin bir hissəsini əhatə edirsə, sarı məlumat sətri neçə ayın bağlandığını açıq deyir. Buna görə tam illik büdcəyə qarşı aşağı icra faizi avtomatik olaraq pis nəticə sayılmır; mövsümi şəkər və kənd təsərrüfatı biznesində ilin ilk ayları təbii olaraq daha zəif görünə bilər.",
          en: "Start with the period context. When actuals cover only part of the year, the amber note states exactly how many months are closed. A low execution percentage against a full-year budget is therefore not automatically a bad result; in seasonal sugar and agriculture businesses the early months can legitimately look light.",
          ru: "Начинайте с контекста периода. Если факт покрывает только часть года, жёлтая строка прямо указывает, сколько месяцев закрыто. Поэтому низкий процент исполнения против годового бюджета не означает автоматически плохой результат: в сезонном сахарном и аграрном бизнесе первые месяцы закономерно могут выглядеть слабо.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_CONTEXT);
          await h.holdUntil(0.5);
          await h.hover(WS_CONTEXT);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Dörd üst kart P&L-in qısa xülasəsidir. Gəlir kartı planı və fakt icrasını, maya dəyəri kartı ümumi marjanı, xərclər kartı əməliyyat büdcəsinin istifadəsini, son kart isə gəlirdən maya dəyəri və əməliyyat xərcləri çıxıldıqdan sonrakı əməliyyat mənfəətini göstərir. Rəqəmlər seçilmiş plan və şirkət filtrinə uyğun yenilənir.",
          en: "The four top cards are the P&L summary. Revenue shows the plan and actual execution; COGS shows the planned gross-margin basis; Expenses shows consumption of the operating budget; and the final card shows operating profit after revenue less COGS and operating expenses. Every figure follows the selected plan and company filter.",
          ru: "Четыре верхние карточки — это краткое P&L. Выручка показывает план и исполнение факта, Себестоимость — основу плановой валовой маржи, Расходы — использование операционного бюджета, а последняя карточка — операционную прибыль после вычета себестоимости и операционных расходов. Все цифры следуют выбранному плану и фильтру компании.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_REVENUE);
          await h.holdUntil(0.28);
          await h.hover(WS_COGS);
          await h.holdUntil(0.5);
          await h.hover(WS_EXPENSES);
          await h.holdUntil(0.72);
          await h.moveTo(WS_PROFIT);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Növbəti sətirdə şəlalə qrafiki büdcədən fakta keçidi izah edir: büdcə, proqnoz, fakt, fərq və il sonu proyeksiyası eyni ardıcıllıqda görünür. Sağdakı icra göstəricisi ayrıca xərc və gəlir faizlərini, üstəgəl ilin keçən hissəsini müqayisə edir. Bu, bir rəqəmə baxıb mövsümlülüyü unutmağın qarşısını alır.",
          en: "The next row explains the movement from budget to reality. The waterfall lays out budget, forecast, actual, variance and year-end projection in one sequence. The execution gauge beside it separates expense and revenue execution and compares them with elapsed time, preventing a single percentage from hiding the seasonal basis.",
          ru: "Следующий ряд объясняет переход от бюджета к реальности. Водопад последовательно показывает бюджет, прогноз, факт, отклонение и проекцию на конец года. Индикатор исполнения рядом разделяет исполнение расходов и выручки и сопоставляет их с прошедшей частью года, чтобы один процент не скрывал сезонную основу.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_WATERFALL);
          await h.holdUntil(0.4);
          await h.hover(WS_WATERFALL);
          await h.holdUntil(0.72);
          await h.moveTo(WS_GAUGE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Kateqoriyalar qrafiki fərqin harada yarandığını göstərir. Ən böyük gəlir və xərc sətirləri plan, proqnoz və fakt üzrə yanaşı verilir; kiçik uzun quyruq isə digər kateqoriyalarda birləşdirilir. Buradan diqqəti hansı məhsula, xərc ailəsinə və ya məsuliyyət sahəsinə yönəltmək lazım olduğunu tez görmək mümkündür.",
          en: "The category chart shows where the variance comes from. The largest revenue and expense lines appear side by side for plan, forecast and actual, while the long tail is grouped into Other. It is the fastest way to see which product, cost family or responsibility area deserves the next drill-down.",
          ru: "График по категориям показывает, откуда возникло отклонение. Крупнейшие строки выручки и расходов стоят рядом по плану, прогнозу и факту, а длинный хвост объединён в «Прочее». Так быстрее всего понять, какой продукт, семейство затрат или зона ответственности требует следующего разбора.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_CATEGORY_BARS);
          await h.holdUntil(0.5);
          await h.hover(WS_CATEGORY_BARS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Aşağıdakı idarəetmə sətrində heç nə bazaya yazmadan görünüşü daraltmaq olar. Axtarış kateqoriyanı tapır, növ filtri gəlirləri və xərcləri ayırır, Əhəmiyyətli düyməsi yalnız seçilmiş faiz və manat həddini keçən fərqləri saxlayır. Rəqəm formatı isə tam məbləğ ilə min və milyon qısa yazılışı arasında dəyişir.",
          en: "The control row narrows the view without writing anything to the database. Search finds a category, the type filter separates revenue from expenses, Material only keeps variances above the chosen percentage or manat threshold, and the number-format toggle switches between full amounts and compact thousands or millions.",
          ru: "Строка управления сужает представление без записи в базу. Поиск находит категорию, фильтр типа отделяет выручку от расходов, «Только существенные» оставляет отклонения выше выбранного процента или порога в манатах, а формат чисел переключает полные суммы на сокращённые тысячи и миллионы.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_CONTROLS);
          await h.holdUntil(0.35);
          await h.safeClick(WS_MATERIAL);
          await h.holdUntil(0.7);
          await h.hover(WS_CONTROLS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Siyahıdan Matris görünüşünə keçid yalnız ekrandakı təqdimatı dəyişir. Matris sazlanıbsa, plan şöbə ilə xərc növünün kəsişməsində görünür. Sazlanmayıbsa, ekran bunu açıq bildirir və ayrıca yaratma düyməsi göstərir. Bu təlimdə həmin düyməyə toxunmuruq: yalnız görünüşü yoxlayır, sətir yaratmır, məbləği dəyişmir və təsdiq prosesi başlatmırıq.",
          en: "Switching from List to Matrix changes only the on-screen presentation. When a matrix is configured, it places the plan at the intersection of department and cost type. When it is not configured, the page says so and offers a separate Generate action. This guide does not press that action: it only inspects the view and creates no line, amount change or approval workflow.",
          ru: "Переключение со Списка на Матрицу меняет только представление на экране. Если матрица настроена, план раскладывается по подразделениям и типам затрат. Если она не настроена, экран прямо сообщает об этом и отдельно предлагает создание. В этом гайде мы не нажимаем эту кнопку: только проверяем вид, не создаём строки, не меняем суммы и не запускаем согласование.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.3);
          await h.safeClick(WS_MATRIX_BUTTON);
          await p.waitForSelector('[data-testid="workspace-matrix"]', { timeout: 8000 });
          await h.holdUntil(0.65);
          await h.moveTo(WS_MATRIX);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Siyahıya qayıdanda əsas P&L cədvəli görünür. Gəlir, maya dəyəri və əməliyyat xərcləri ayrıca bölmələrdir; onların arasında ümumi mənfəət və əməliyyat mənfəəti kanonik düsturlarla hesablanır. Hər bölmədə plan, fakt və faiz fərqi yanaşıdır. Beləcə rəhbər xülasədən konkret hesab sətrinə qədər eyni məntiqi izləyir.",
          en: "Back in List view, the main P&L table becomes the audit trail. Revenue, COGS and operating expenses are separate sections, with gross profit and operating profit calculated between them using the canonical formulas. Plan, actual and percentage variance sit side by side, so management can move from the summary to a specific account line without changing logic.",
          ru: "После возврата в Список главная P&L-таблица становится дорожкой разбора. Выручка, себестоимость и операционные расходы разделены, а между ними по каноническим формулам рассчитаны валовая и операционная прибыль. План, факт и процент отклонения стоят рядом, поэтому от сводки можно перейти к конкретной строке счёта без смены логики.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(WS_LIST_BUTTON);
          await p.waitForSelector('[data-testid="workspace-table"]', { timeout: 8000 });
          await h.holdUntil(0.55);
          await h.moveTo(WS_TABLE);
          await h.holdUntil(0.78);
          await h.hover(WS_TABLE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İş sahəsinin əsas qaydası budur: əvvəl dövrü və şirkəti yoxlayın, sonra xülasə kartlarını oxuyun, fərqin mənbəyini qrafikdə tapın və yalnız bundan sonra cədvələ enin. Bu ardıcıllıq tam illik planı qismən faktla səhv müqayisə etmədən P&L riskini tez və dürüst izah etməyə imkan verir.",
          en: "The Workspace has one simple operating rhythm: verify period and company first, read the summary cards, locate the driver in the charts, and only then drill into the table. Following that order lets you explain P&L risk quickly without mistaking a partial-year actual for a completed full-year result.",
          ru: "У Рабочей области простой рабочий ритм: сначала проверьте период и компанию, затем прочитайте сводные карточки, найдите драйвер на графиках и только потом спускайтесь в таблицу. Такой порядок позволяет быстро объяснить риск P&L и не принять неполный годовой факт за завершённый результат всего года.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WS_KPIS);
          await h.holdUntil(0.5);
          await h.hover(WS_PROFIT);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "balance-sheet": {
    route: "/budgeting?tab=balance-sheet",
    title: {
      az: "Balans — sübut, struktur və detallar",
      en: "Balance Sheet — evidence, structure and detail",
      ru: "Баланс — источник, структура и детализация",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Büdcələşdirmə bölməsinin Balans görünüşüdür. Əvvəl yuxarıdakı mənbə qeydini oxuyun: seçilmiş büdcə planında ayrıca balans olmadıqda ekran eyni ilin uyğun Fakt planına keçir. Beləliklə, göstərilən aktiv, öhdəlik və kapital rəqəmlərinin hansı plan və dövrə aid olduğunu qərardan əvvəl dəqiq bilirsiniz.",
          en: "This is the Balance Sheet view inside Budgeting. Begin with the source note at the top: when the selected budget plan has no balance sheet of its own, the screen uses the matching Actuals plan for the same year. You therefore know exactly which plan and period support the displayed assets, liabilities and equity before interpreting them.",
          ru: "Это экран Баланса внутри Бюджетирования. Начните с примечания об источнике наверху: если у выбранного бюджетного плана нет собственного баланса, экран использует соответствующий план «Факт» того же года. Поэтому до интерпретации активов, обязательств и капитала вы точно знаете, какой план и период подтверждают эти цифры.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BS_ROOT, { timeout: 12000 });
          await h.moveTo(BS_ROOT);
          await h.holdUntil(0.45);
          await h.hover(BS_SOURCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Yaşıl məlumat sətri konsolidasiya sərhədini izah edir. Bu görünüş şirkətlərin sadə cəmi deyil: Reporting mənbəsində hazırlanmış rəsmi qrup balansıdır və qrupdaxili paylar eliminasiya olunub. Şirkət səviyyəli araşdırma lazım olduqda ayrıca drill-down istifadə edilməlidir; konsolidə edilmiş məbləği törəmə şirkətlərin kor-koranə cəmi ilə müqayisə etməyin.",
          en: "The green disclosure defines the consolidation boundary. This is not a simple addition of companies: it is the official group balance sheet prepared in Reporting, with intercompany interests eliminated. When entity-level analysis is required, use the separate drill-down; do not compare the consolidated amount with a blind sum of subsidiaries and call the difference an error.",
          ru: "Зелёное пояснение задаёт границу консолидации. Это не простая сумма компаний, а официальный групповой баланс из Reporting с элиминацией внутригрупповых долей. Для анализа отдельной организации используйте специальный drill-down; не сравнивайте консолидированную сумму с механической суммой дочерних компаний и не называйте разницу ошибкой.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BS_CONSOLIDATED);
          await h.holdUntil(0.5);
          await h.hover(BS_CONSOLIDATED);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Ekran son təsdiqlənmiş ayı sətir sayına görə müəyyən edir, məbləğin sıfırdan fərqli olmasına görə deyil. Buna görə mənbədə açıq sıfır varsa, o real sübut sayılır; heç bir sətir yoxdursa, xana tire və qrafik boşluğu kimi qalır. İyun məlumatının olmaması iyun balansının sıfır olması demək deyil.",
          en: "The screen identifies the latest evidenced month from source-row presence, not from whether a total happens to be non-zero. An explicit source zero therefore remains valid evidence, while a month with no rows stays a dash or a chart gap. Missing June data never becomes a claim that the June balance was zero, and missing sections cannot manufacture a ratio.",
          ru: "Последний подтверждённый месяц определяется по наличию исходных строк, а не по тому, отличается ли итог от нуля. Поэтому явный ноль в источнике остаётся доказательством, а месяц без строк показывается тире или разрывом графика. Отсутствие данных за июнь не превращается в утверждение, что июньский баланс равен нулю.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BS_KPIS);
          await h.holdUntil(0.5);
          await h.hover(BS_SOURCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Dörd kart son sübutlu ay üçün ümumi aktivləri, öhdəlikləri, kapitalı və borcun kapitala nisbətini göstərir. İşarə konvensiyası aktiv, öhdəlik və kapital birlikdə olduqda balans qalığı ilə müəyyən edilir. Kapital yoxdursa, sıfır və ya mənfidirsə, D/E yaşıl sağlam göstərici kimi görünmür; nəticə naməlum olaraq tire ilə qalır.",
          en: "The four cards summarize total assets, liabilities, equity and debt to equity for the latest evidenced month. The sign convention is inferred only when assets, liabilities and equity are all present and their balance residual can be compared. If equity is missing, zero or negative, D/E does not appear as a healthy green ratio; it remains unavailable as a dash.",
          ru: "Четыре карточки показывают активы, обязательства, капитал и отношение долга к капиталу за последний подтверждённый месяц. Соглашение о знаках определяется только при наличии всех трёх разделов через сравнение остатков баланса. Если капитал отсутствует, равен нулю или отрицателен, D/E не становится зелёным здоровым коэффициентом, а остаётся недоступным и показывается тире.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BS_ASSETS);
          await h.holdUntil(0.28);
          await h.hover(BS_LIABILITIES);
          await h.holdUntil(0.5);
          await h.hover(BS_EQUITY);
          await h.holdUntil(0.72);
          await h.moveTo(BS_DE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Aylıq struktur qrafiki üç bölməni eyni zaman oxunda müqayisə edir. Xətt yalnız həmin ay üzrə mənbə sübutu olduqda çəkilir; gələcək və ya yüklənməmiş aylar avtomatik sıfırla doldurulmur. Qrafiki oxuyarkən əvvəl son görünən ayı, sonra aktivlərlə öhdəlik və kapital arasındakı istiqaməti, sonda isə boşluqları yoxlayın.",
          en: "The monthly structure chart compares all three sections on one time axis. A series is drawn only where that month has source evidence; future or unimported months are not automatically filled with zeros. Read it by checking the last visible month first, then the direction of assets versus liabilities and equity, and finally any gaps that require source-data follow-up.",
          ru: "Помесячный график структуры сравнивает три раздела на одной временной оси. Серия рисуется только там, где за месяц есть исходные данные; будущие или неимпортированные месяцы не заполняются автоматическими нулями. Сначала проверьте последний видимый месяц, затем направление активов относительно обязательств и капитала, а после этого исследуйте разрывы в источнике.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BS_STRUCTURE);
          await h.holdUntil(0.5);
          await h.hover(BS_STRUCTURE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Aktivlərin tərkibi diaqramı son sübutlu ayda ən böyük hesabların payını göstərir. O, əsas konsentrasiyanı tez görmək üçün faydalıdır, lakin qiymətləndirmə və ya likvidlik hökmü deyil. Böyük pay gördükdə hesabın adını qeyd edin, sonra aşağıdakı detallı cədvəldə aylıq hərəkəti və mənbə sətirlərini ayrıca araşdırın.",
          en: "Asset composition shows the largest account shares in the latest evidenced month. It is useful for spotting concentration quickly, but it is not a valuation or liquidity verdict. When one slice dominates, note the account name and continue into the detail table below to inspect its monthly movement and underlying rows before drawing a conclusion.",
          ru: "Состав активов показывает крупнейшие доли счетов в последнем подтверждённом месяце. Диаграмма быстро выявляет концентрацию, но не является выводом о стоимости или ликвидности. Если один сегмент доминирует, запомните название счёта и перейдите в детальную таблицу, чтобы проверить его помесячное движение и исходные строки до вывода.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BS_COMPOSITION);
          await h.holdUntil(0.5);
          await h.hover(BS_COMPOSITION);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Detallı cədvəl rəhbər xülasəsinin audit yoludur. Aktivlər, öhdəliklər və kapital ayrıca bölmələrdə, aylar isə sütunlarda verilir. Nişandakı say aylıq baza sətirlərinin deyil, unikal hesabların sayıdır. Manager və admin üçün rəqəm xanaları redaktə oluna bilər, lakin bu təlim heç bir inputa fokus vermir və blur saxlamasını işə salmır.",
          en: "The detail table is the audit trail behind the management summary. Assets, liabilities and equity remain separate sections, with months across the columns. The badge counts unique accounts rather than repeated monthly database rows. Managers and administrators may see editable number fields, but this guide never focuses an input, changes a value, or triggers the save-on-blur behavior.",
          ru: "Детальная таблица — это дорожка проверки управленческой сводки. Активы, обязательства и капитал разделены, а месяцы расположены по столбцам. Нишан считает уникальные счета, а не повторяющиеся месячные строки базы. Менеджеры и администраторы могут видеть редактируемые поля, но гайд не фокусирует input, не меняет значение и не запускает сохранение по blur.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BS_DETAIL);
          await h.holdUntil(0.5);
          await h.hover(BS_EDIT_WARNING);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Bölmə başlıqları yalnız lokal görünüşü idarə edən əlçatan düymələrdir. Aktivlər və Öhdəlikləri indi yığıb yenidən açıram ki, uzun cədvəldə naviqasiyanı göstərim. Bu kliklər serverə yazmır, seçilmiş planı dəyişmir və maliyyə sətrinə toxunmur; onlar sadəcə uyğun hesab sətirlərini ekranda gizlədir və qaytarır.",
          en: "Section headers are accessible buttons that control only the local presentation. I now collapse and reopen Assets and Liabilities to demonstrate navigation through a long table. These clicks write nothing to the server, do not change the selected plan, and do not touch a financial row; they only hide and restore the matching account lines on screen.",
          ru: "Заголовки разделов — доступные кнопки, управляющие только локальным представлением. Сейчас я сворачиваю и снова раскрываю Активы и Обязательства, показывая навигацию по длинной таблице. Эти клики ничего не записывают на сервер, не меняют выбранный план и финансовые строки, а лишь скрывают и возвращают соответствующие счета на экране.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.18);
          await h.safeClick(BS_ASSETS_TOGGLE);
          await h.holdUntil(0.38);
          await h.safeClick(BS_ASSETS_TOGGLE);
          await h.holdUntil(0.58);
          await h.safeClick(BS_LIABILITIES_TOGGLE);
          await h.holdUntil(0.78);
          await h.safeClick(BS_LIABILITIES_TOGGLE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Kapital bölməsini də yığıb yenidən açaraq təhlükəsiz iş ardıcıllığını yekunlaşdırıram. Əvvəl planı, Fakt mənbəyini, konsolidasiya sərhədini və son sübutlu ayı təsdiqləyin; sonra KPI, struktur və hesab detallarını oxuyun. Sübut çatmırsa sıfır uydurmayın, inputu dəyişməyin və idxalı kor-koranə başlatmayın; təsdiqlənmiş mənbə faylını əvvəlcə preview edin.",
          en: "I finish by collapsing and reopening Equity, then restate the safe operating sequence: confirm the plan, Actuals source, consolidation boundary and latest evidenced month before reading KPIs, structure and account detail. When evidence is missing, do not invent a zero, edit an input, or launch an import blindly; preview the approved source workbook and resolve the gap first.",
          ru: "В завершение я сворачиваю и снова раскрываю Капитал. Безопасная последовательность такова: подтвердите план, источник «Факт», границу консолидации и последний доказанный месяц, затем читайте KPI, структуру и счета. Если данных не хватает, не придумывайте ноль, не меняйте input и не запускайте импорт вслепую; сначала проверьте утверждённый исходный файл в preview.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(BS_EQUITY_TOGGLE);
          await h.holdUntil(0.5);
          await h.safeClick(BS_EQUITY_TOGGLE);
          await h.holdUntil(0.75);
          await h.moveTo(BS_KPIS);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "cash-flow": {
    route: "/budgeting?tab=cash-flow",
    title: {
      az: "Pul axını — mənbədən aylıq balansa",
      en: "Cash Flow — from source entries to monthly balance",
      ru: "Денежный поток — от исходных записей к месячному балансу",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Büdcələşdirmə bölməsinin Pul axını sahəsidir. Yuxarıdakı dörd görünüş mənbə qeydlərini, aylıq pul axını icmalını, fəaliyyətlər üzrə hesabatı və gəlir-xərc plan-fakt analizini ayırır. Cari il sistem vaxtından seçilir; bu ekran təşkilat üzrə işləyir və yuxarıdakı büdcə planının Cash Flow məlumatını avtomatik məhdudlaşdırdığını güman etmək olmaz.",
          en: "This is the Cash Flow area inside Budgeting. The four views separate source entries, the monthly cash overview, the statement by operating activity, and a revenue-and-expense plan-versus-actual analysis. The current year follows system time; this surface is organization-wide, so you must not assume the budget plan selected elsewhere automatically scopes the Cash Flow ledger.",
          ru: "Это раздел «Денежный поток» внутри бюджетирования. Четыре представления разделяют исходные записи, месячный обзор денежных средств, отчёт по видам деятельности и анализ план-факт доходов и расходов. Текущий год берётся из системной даты; экран работает по организации, поэтому нельзя считать, что выбранный в другом месте бюджетный план автоматически ограничивает реестр Cash Flow.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CF_ROOT);
          await h.holdUntil(0.5);
          await h.hover(CF_HEADER);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İlk olaraq əsas icmalın sübut vəziyyətini yoxlayın. Real Cash Flow qeydləri varsa, qrafik və aylıq cədvəl görünür. Qeyd yoxdursa, ekran konkret il üçün məlumat olmadığını açıq bildirir. Boş vəziyyət sıfır daxilolma, sıfır ödəniş və ya sağlam balans demək deyil; o, hələ mənbə sübutunun daxil edilmədiyini göstərir.",
          en: "Start by checking the evidence state of the overview. When real Cash Flow entries exist, the chart and monthly table appear. When no entries exist, the page explicitly says that the selected year has no data. That empty state is not zero inflow, zero payment, or a healthy balance; it means the source evidence has not been supplied yet.",
          ru: "Начинайте с проверки состояния доказательств в обзоре. Когда существуют реальные записи Cash Flow, появляются график и месячная таблица. Если записей нет, экран прямо сообщает об отсутствии данных за выбранный год. Такое пустое состояние не означает нулевые поступления, нулевые платежи или здоровый баланс — исходные подтверждения ещё не загружены.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CF_OVERVIEW);
          await h.holdUntil(0.5);
          await h.hover(CF_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Mənbə qeydləri mövcud olduqda yuxarı kart yaşıl daxilolmaları və qırmızı ödənişləri sütunlarla, bağlanış balansını isə xəttlə göstərir. Başlıqdakı cəmlər seçilmiş ilin ümumi hərəkətini verir; hər hansı ayın bağlanış balansı mənfidirsə, pul kəsiri nişanı görünür. Boş vəziyyətdə bu rəqəmlər yaradılmır və sıfır kimi təqdim edilmir.",
          en: "When source entries are available, the upper card plots inflows as green bars, payments as red bars, and closing balance as a line. The header totals summarize movement for the selected year, and a cash-gap badge appears if any month closes below zero. In the empty state these numbers are not fabricated and are not presented as zeros.",
          ru: "Когда исходные записи доступны, верхняя карточка показывает поступления зелёными столбцами, платежи красными, а конечный баланс — линией. Итоги в заголовке суммируют движение выбранного года, и при отрицательном закрытии месяца появляется признак кассового разрыва. В пустом состоянии эти числа не создаются и не показываются как нули.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CF_TOTALS);
          await h.holdUntil(0.5);
          await h.hover(CF_TOTALS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Aylıq cədvəldə məntiq açılış balansından başlayır, daxilolma və ödənişlərdən xalis hərəkəti hesablayır və bağlanış balansına keçir. Növbəti ay əvvəlki ayın bağlanışı ilə əlaqəli olmalıdır. Cədvəl yalnız həqiqi qeydlər olduqda audit izi kimi istifadə edilir; boş ekranı on iki sıfır ay kimi şərh etmək düzgün deyil.",
          en: "The monthly table starts with opening balance, applies inflows and payments to calculate net movement, and arrives at closing balance. The next month should continue from the prior close. Use this table as an audit trail only when real entries exist; an empty screen must never be interpreted as twelve evidenced zero months.",
          ru: "Месячная таблица начинается с начального баланса, применяет поступления и платежи, рассчитывает чистое движение и приходит к конечному балансу. Следующий месяц должен продолжать предыдущее закрытие. Используйте таблицу как дорожку проверки только при наличии реальных записей; пустой экран нельзя трактовать как двенадцать подтверждённых нулевых месяцев.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CF_MONTHLY);
          await h.holdUntil(0.5);
          await h.hover(CF_MONTHLY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Sağdakı Büdcədən yarat düyməsi sadə görünüş filtri deyil. O, seçilmiş il üzrə yaradılmış Cash Flow qeydlərini yenidən qurur və təşkilatın uyğun büdcə planlarını emal edə bilər. Buna görə bu təlim düyməni yalnız göstərir, heç vaxt basmır. İstehsal məlumatında belə əməliyyat ayrıca preview, backup və sahib təsdiqi tələb edir.",
          en: "The Generate from budget button is not a harmless view filter. It rebuilds generated Cash Flow entries for the selected year and may process eligible budget plans across the organization. This guide therefore points to the control but never presses it. On production data, that operation requires its own preview, backup, bounded scope, and explicit owner approval.",
          ru: "Кнопка «Сгенерировать из бюджета» — не безобидный фильтр представления. Она перестраивает созданные системой записи Cash Flow за выбранный год и может обработать подходящие бюджетные планы всей организации. Поэтому гайд только показывает кнопку и никогда её не нажимает. На проде такая операция требует отдельного preview, резервной копии, ограниченного scope и явного разрешения владельца.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CF_GENERATE);
          await h.holdUntil(0.5);
          await h.hover(CF_GENERATE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Digər tabları mənbə ilə qarışdırmayın. PAH görünüşü Cash Flow qeydlərini əməliyyat, investisiya və maliyyələşdirmə fəaliyyətinə ayırır. Gəlir-xərc plan-fakt görünüşü isə satış və xərc proqnozlarını büdcə faktı ilə müqayisə edir; o, Cash Flow reyestrinin uzlaşdırılması deyil. Hər iki görünüş giriş olmadıqda naməlum vəziyyət göstərməlidir, sıfır hesabat yox.",
          en: "Do not confuse the supporting tabs with the source ledger. CFS groups Cash Flow entries into operating, investing, and financing activities. Revenue-and-expense plan versus actual compares sales and expense forecasts with budget actuals; it is not a reconciliation of Cash Flow entries. Both views must show an unknown empty state when their inputs are absent, never a fully populated zero report.",
          ru: "Не смешивайте вспомогательные вкладки с исходным реестром. ОДДС группирует записи Cash Flow по операционной, инвестиционной и финансовой деятельности. План-факт доходов и расходов сравнивает прогнозы продаж и затрат с бюджетным фактом; это не сверка записей Cash Flow. При отсутствии входов оба экрана должны показывать неизвестное пустое состояние, а не заполненный нулевой отчёт.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CF_TABS);
          await h.holdUntil(0.5);
          await h.hover(CF_TABS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Qeydlər görünüşü hesablamanın mənbəyinə enir: ay, daxilolma və ya ödəniş növü, fəaliyyət, təsvir və məbləğ. Manager və admin üçün bu sətirlər redaktə və yumşaq silmə idarələri daşıya bilər. Təlim yalnız lokal taba keçir; heç bir sahəyə fokus vermir, dəyəri dəyişmir, blur yaratmır və silmə düyməsinə toxunmur.",
          en: "Entries is the drill-down to calculation sources: month, inflow or payment type, activity, description, and amount. For managers and administrators these rows may expose inline editing and recoverable soft-delete controls. The guide only switches the local tab; it never focuses a field, changes a value, triggers blur, or touches a delete action.",
          ru: "«Записи» — это переход к источникам расчёта: месяц, тип поступления или платежа, деятельность, описание и сумма. Для менеджера и администратора строки могут содержать inline-редактирование и восстановимое мягкое удаление. Гайд лишь переключает локальную вкладку: не фокусирует поля, не меняет значения, не вызывает blur и не касается удаления.",
        },
        do: async (p, l, h) => {
          // Wait for the overview to finish rendering before aiming at the tab
          // bar. While this screen was empty the tabs mounted once and stayed
          // put; with a populated year (43,440 projected entries) the overview
          // re-renders as its data arrives and takes the tab bar with it, so
          // the click landed on a node that had already been swapped out —
          // "locator.click: Timeout … waiting for locator".
          //
          // A rendered overview is a positive signal that the data is in, which
          // is why this waits for it rather than for network silence: this page
          // polls, so a networkidle wait would have to swallow its own timeout,
          // and a scenario that swallows errors is how a broken take ships.
          await p.waitForSelector(CF_OVERVIEW, { timeout: 20000 });
          await p.waitForSelector(CF_TABS, { timeout: 20000 });
          await h.holdUntil(0.3);
          await h.safeClick(CF_ENTRIES_BUTTON);
          await p.waitForSelector(CF_ENTRIES_VIEW, { timeout: 15000 });
          await h.holdUntil(0.65);
          await h.moveTo(CF_ENTRIES_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İcmala qayıdanda düzgün iş ardıcıllığı belədir: əvvəl il və təşkilat scope-unu təsdiqləyin, sonra mənbə qeydlərinin mövcudluğunu yoxlayın, yalnız bundan sonra qrafik, aylıq balans və fəaliyyətlər üzrə hesabatı oxuyun. Məlumat yoxdursa, növbəti addım rəqəm uydurmaq və ya generatoru kor-koranə işə salmaq deyil, təsdiqlənmiş Cash Flow faylını preview ilə idxal etməkdir.",
          en: "Back in Overview, the safe operating sequence is simple: confirm year and organization scope, verify that source entries exist, and only then interpret the chart, monthly balances, and activity statement. If evidence is absent, the next step is not to invent zeros or run the generator blindly; it is to preview and import an approved Cash Flow source file.",
          ru: "После возврата в Обзор безопасный порядок прост: подтвердите год и scope организации, проверьте наличие исходных записей и только затем читайте график, месячные балансы и отчёт по деятельности. Если доказательств нет, следующий шаг — не придумывать нули и не запускать генератор вслепую, а сделать preview и импортировать утверждённый исходный файл Cash Flow.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(CF_TABS, { timeout: 20000 });
          await h.holdUntil(0.3);
          await h.safeClick(CF_OVERVIEW_BUTTON);
          await p.waitForSelector(CF_OVERVIEW, { timeout: 15000 });
          await h.holdUntil(0.65);
          await h.moveTo(CF_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "comparison": {
    route: "/budgeting?tab=comparison",
    title: {
      az: "Müqayisə — eyni əsaslı faktiki dövrlər",
      en: "Comparison — like-for-like actual periods",
      ru: "Сравнение — сопоставимые фактические периоды",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Büdcələşdirmə bölməsinin Müqayisə görünüşüdür. Ekran bütün təşkilat üzrə konsolidasiya olunmuş plan analitikasını yan-yana qoyur; ayrıca şirkət filtri tətbiq etmir. Yuxarıdakı mənşə qeydi əsas qaydanı bildirir: çatışmayan kateqoriya və ya faktiki sübut sıfır deyil və cədvəldə tire kimi qalmalıdır.",
          en: "This is the Comparison view in Budgeting. It places organization-wide consolidated plan analytics side by side and does not apply an individual company filter. The provenance disclosure states the governing rule: a missing category or missing actual evidence is not zero, so the detailed table must preserve it as a dash.",
          ru: "Это экран Сравнения в разделе Бюджетирования. Он ставит рядом консолидированную аналитику планов всей организации и не применяет фильтр отдельной компании. Пояснение об источнике закрепляет главное правило: отсутствующая категория или неподтверждённый факт не равны нулю и должны оставаться тире в детальной таблице.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(CMP_ROOT, { timeout: 12000 });
          await h.moveTo(CMP_PROVENANCE);
          await h.holdUntil(0.45);
          await h.hover(CMP_PICKER);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi iki məlumatla doldurulmuş uyğun illik faktiki dövrü seçirəm. Birinci seçim müqayisə əsasını sabitləyir: plan növü, illik və ya aylıq detallılıq, eləcə də ay və ya rüb yuvası eyni olmalıdır. Boş planlar, faktiki dövrü büdcə ilə və ya aylıq dövrü illik dövrlə qarışdıran kartlar avtomatik deaktiv olur.",
          en: "I now select two populated, compatible annual actuals periods. The first selection fixes the comparison basis: plan kind, annual or monthly granularity, and the relevant month or quarter slot must match. Empty plans and cards that would mix actuals with a budget, or a monthly period with an annual period, are automatically disabled.",
          ru: "Теперь я выбираю два заполненных совместимых годовых фактических периода. Первый выбор фиксирует основу сравнения: должны совпасть вид плана, годовая или месячная детализация и соответствующий месяц либо квартал. Пустые планы и карточки, смешивающие факт с бюджетом или месячный период с годовым, автоматически отключаются.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.22);
          await h.safeClick(CMP_PRIMARY);
          await h.holdUntil(0.45);
          await h.safeClick(CMP_SECONDARY);
          await p.waitForSelector(CMP_KPIS, { timeout: 15000 });
          await h.holdUntil(0.72);
          await h.moveTo(CMP_BASIS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Rəqəmləri oxumazdan əvvəl valyuta sübutunu yoxlayın. Təşkilatın təsdiqlənmiş baza valyutası yoxdursa, bütün məbləğlər qəsdən valyuta kodu və simvolu olmadan göstərilir; ekran manat, dollar və ya başqa vahid təxmin etmir. Bu qayda kartlara, qrafik etiketlərinə, tooltip-lərə, fərqlərə və cədvələ eyni şəkildə tətbiq olunur.",
          en: "Before reading the numbers, verify the currency evidence. If the organization has no confirmed base currency, every amount deliberately appears without a currency code or symbol; the view does not guess manat, dollars, or another unit. The same rule applies to cards, chart labels, tooltips, deltas, and the detailed table.",
          ru: "До чтения цифр проверьте подтверждение валюты. Если у организации нет установленной базовой валюты, все суммы намеренно показаны без кода и символа; экран не угадывает манаты, доллары или другую единицу. Одно правило действует для карточек, подписей графика, подсказок, разниц и детальной таблицы.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_CURRENCY);
          await h.holdUntil(0.5);
          await h.hover(CMP_PROVENANCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Yuxarı kartlar hər seçilmiş faktiki dövr üçün reallaşmış əməliyyat xərclərini göstərir; bu, büdcə, qarışıq ümumi məbləğ və ya EBITDA deyil. Faktiki planın öz sətirləri reallaşmış mənbə sayılır və ekran eyni rəqəmi ayrıca Büdcə və Faktiki sütunlarında təkrarlamır. Kateqoriya sayı ayrı hesab və növ sətirlərini göstərir.",
          en: "The upper cards show realized operating expense for each selected actuals period; this is not a budget, a mixed grand total, or EBITDA. An actuals plan's own lines are the realized source, and the screen does not repeat the same value in separate Budget and Actual columns. The category count reflects separate account-and-type rows.",
          ru: "Верхние карточки показывают реализованные операционные расходы каждого выбранного фактического периода; это не бюджет, не смешанный общий итог и не EBITDA. Собственные строки фактического плана являются реализованным источником, поэтому экран не дублирует одно значение в отдельных колонках Бюджет и Факт. Число категорий отражает отдельные строки счёта и типа.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_KPIS);
          await h.holdUntil(0.5);
          await h.hover(CMP_KPIS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Kateqoriya qrafiki bütün sətirləri gizlətmir: vizual sıxlığı idarə etmək üçün reallaşmış məbləğin ən böyük olduğu on hesab və növ sətirini göstərir, tam siyahı isə aşağıdakı cədvəldə qalır. Eyni görünən adlar hesab kodu ilə ayrılır; müxtəlif kodlu sətirlər birləşdirilmir və onların məbləği itmir.",
          en: "The category chart does not pretend to be the full ledger. To control visual density it shows the ten account-and-type rows with the largest realized amount, while the complete list remains in the table below. Duplicate display names are separated by account code, so distinct coded rows are never merged or silently omitted.",
          ru: "График категорий не выдаёт себя за полный реестр. Для читаемости он показывает десять строк счёта и типа с крупнейшей реализованной суммой, а полный список остаётся в таблице ниже. Одинаковые отображаемые названия разделяются кодом счёта, поэтому разные строки не склеиваются и не теряются.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_CHART);
          await h.holdUntil(0.5);
          await h.hover(CMP_CHART);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Sağdakı yekunlar yalnız reallaşmış əməliyyat xərclərini eyni əsasda müqayisə edir. Aşağıdakı fərq birinci faktiki dövrün məbləğini digər seçilmiş dövrlə tutur və böyük məbləği avtomatik yaxşı və ya pis rəngləmir. Müqayisə mənfəət marjasını xərc məbləğinə bölmür; sıfır müqayisə bazasında faiz isə tire qalır.",
          en: "The totals card compares realized operating expenses only, on one consistent basis. The delta below compares the first actuals period with the other selected period and does not color a larger amount as automatically good or bad. It never divides an operating-margin variance by expense, and a percentage with a zero comparison base remains a dash.",
          ru: "Карточка итогов сравнивает только реализованные операционные расходы на одной основе. Разница ниже сопоставляет первый фактический период с другим и не окрашивает большую сумму как автоматически хорошую или плохую. Она не делит отклонение маржи на расходы, а процент при нулевой базе остаётся тире.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_TOTALS);
          await h.holdUntil(0.5);
          await h.hover(CMP_TOTALS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Faktiki dövrlər rejimində cədvəl hər dövr üçün yalnız bir reallaşmış məbləğ sütunu göstərir. Büdcə, Faktiki və Fərq sütunlarını süni şəkildə təkrarlamır, çünki faktiki planın öz sətirləri reallaşmış məlumatdır. Materiallıq filtri də gizlənir: plan-fakt fərqi olmayan rejimdə belə filtrin mənası yoxdur və yanlış seçim təsiri yaratmamalıdır.",
          en: "In actuals-period mode, the table shows one realized amount column for each period. It does not manufacture duplicate Budget, Actual, and Variance columns because an actuals plan's own rows are the realized data. The materiality filter is also hidden: without a plan-versus-actual variance, that control has no valid meaning and should not imply one.",
          ru: "В режиме фактических периодов таблица показывает по одной колонке реализованной суммы для каждого периода. Она не создаёт дубли Бюджет, Факт и Отклонение, потому что собственные строки фактического плана и есть реализованные данные. Фильтр существенности также скрыт: без отклонения план-факт у него нет корректного смысла.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_TABLE);
          await h.holdUntil(0.5);
          await h.hover(CMP_TABLE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Detallı cədvəl seçilmiş faktiki dövrlərdəki hər hesab kodu və sətir növünü saxlayır. Sətir dövrlərdən birində yoxdursa, həmin dövrün xanası tire qalır və sıfır sayılmır. Mənbə sətrində açıq sıfır varsa, o adi sıfır kimi göstərilir və çatışmayan məlumatla qarışdırılmır.",
          en: "The detailed table retains every account-code and line-type identity across the selected actuals periods. If a row is absent from one period, that period's cell remains a dash and is not counted as zero. When the source row contains an explicit zero, the table displays an ordinary zero, keeping evidenced zero distinct from missing data.",
          ru: "Детальная таблица сохраняет каждую идентичность кода счёта и типа строки в выбранных фактических периодах. Если строка отсутствует в одном периоде, его ячейка остаётся тире и не считается нулём. Явный ноль в исходной строке показывается обычным нулём и не смешивается с отсутствием данных.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_ABSENCE);
          await h.holdUntil(0.5);
          await h.hover(CMP_TABLE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Sonda təhlükəsiz ardıcıllığı yekunlaşdırıram: müqayisə əsasını və təşkilat əhatəsini təsdiqləyin, hər iki dövrün dolu olduğunu yoxlayın, valyuta sübutunu oxuyun, reallaşmış əməliyyat xərci kartlarını və neytral fərqləri yoxlayın, sonra onluq qrafikdən tam hesab-kodu cədvəlinə enin. Tireləri sıfır və ya yaxşı nəticə kimi şərh etməyin.",
          en: "Finally, use this safe sequence: confirm comparison basis and organization scope, verify that both periods are populated, read the currency evidence, inspect realized operating-expense cards and neutral deltas, then move from the ten-row chart to the complete account-code table. Never interpret a dash as zero or as a favorable result, and never compare an empty plan.",
          ru: "В завершение используйте безопасный порядок: подтвердите основу сравнения и границы организации, убедитесь, что оба периода заполнены, прочитайте сведения о валюте, проверьте реализованные операционные расходы и нейтральные разницы, затем перейдите от графика десяти строк к полной таблице кодов счёта. Не трактуйте тире как ноль и не сравнивайте пустой план.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CMP_PROVENANCE);
          await h.holdUntil(0.5);
          await h.hover(CMP_TABLE);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "forecast": {
    route: "/budgeting?tab=forecast",
    title: {
      az: "Proqnoz — plan bazası və ssenarilər",
      en: "Forecast — plan baseline and scenarios",
      ru: "Прогноз — плановая база и сценарии",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Büdcələşdirmə bölməsinin Proqnoz görünüşüdür. Əvvəl yuxarıdakı mənşə qeydini oxuyun. Kursiv aylıq xanalar saxlanmış fakt deyil: onlar plan dövrünün büdcə sətirlərinin göstərilən aylara bərabər paylanmış bazasıdır. Qeyd uyğun saxlanmış aylıq düzəlişləri və seçilmiş dövrdən kənarda nəzərə alınmayan qeydləri ayrıca sayır; bu rəqəmlər faktiki tarixçə kimi təqdim edilmir.",
          en: "This is the Forecast view inside Budgeting. Begin with the provenance disclosure at the top. Italic monthly cells are not saved actuals: they are a baseline created by evenly distributing plan-period budget lines across the displayed months. The disclosure separately counts matching saved monthly overrides and ignored out-of-scope records, and none of these figures are presented as actual history.",
          ru: "Это экран Прогноза внутри Бюджетирования. Сначала прочитайте пояснение об источнике наверху. Месячные ячейки курсивом — не сохранённый факт, а базовая линия, полученная равномерным распределением строк бюджета периода по показанным месяцам. Пояснение отдельно считает подходящие сохранённые переопределения и игнорируемые записи вне выбранного периода, не выдавая эти суммы за фактическую историю.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(FC_ROOT, { timeout: 12000 });
          await h.moveTo(FC_ROOT);
          await h.holdUntil(0.45);
          await h.hover(FC_PROVENANCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Valyuta mənbə məlumatıdır, bəzək deyil. Təşkilatda baza valyutası qurulmayıbsa, ekran məbləğləri qəsdən valyuta vahidi olmadan göstərir və sarı xəbərdarlıq verir. Burada manat, dollar və ya başqa kodu təxmin etmək olmaz. Dörd KPI gəliri, maya dəyərini, əməliyyat xərclərini və EBITDA-nı eyni sübut sərhədində xülasə edir.",
          en: "Currency is source data, not decoration. If the organization has no configured base currency, amounts deliberately appear without a currency unit and an amber disclosure explains why. The screen must not guess manat, dollars, or another code. The four KPI cards then summarize revenue, COGS, operating expense, and EBITDA within that same evidence boundary.",
          ru: "Валюта — это исходные данные, а не оформление. Если у организации не настроена базовая валюта, суммы намеренно показаны без валютной единицы, а жёлтое пояснение объясняет причину. Экран не должен угадывать манаты, доллары или другой код. Четыре KPI суммируют доходы, себестоимость, операционные расходы и EBITDA в той же границе доказательств.",
        },
        do: async (p, l, h) => {
          await h.moveTo(FC_CURRENCY);
          await h.holdUntil(0.5);
          await h.hover(FC_KPIS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Baza ssenarisində kanonik P&L düsturlarını yoxlayın. Ümumi mənfəət gəlirdən yalnız maya dəyəri çıxılaraq hesablanır. EBITDA isə ümumi mənfəətdən əməliyyat xərclərini də çıxır. Maya dəyəri, xərc payları və EBITDA marjası yalnız müsbət gəlir olduqda faizlə göstərilir; gəlir sübutu yoxdursa, nisbət sıfır kimi uydurulmur.",
          en: "In the Base scenario, verify the canonical P&L formulas. Gross profit is revenue less COGS, while EBITDA is gross profit less operating expense. COGS share, expense share, and EBITDA margin are percentages only when revenue is positive; without positive revenue evidence the view leaves the ratio unavailable instead of manufacturing a zero or a misleading healthy percentage.",
          ru: "В базовом сценарии проверьте канонические формулы P&L. Валовая прибыль равна доходам минус себестоимость, а EBITDA — валовой прибыли минус операционные расходы. Доля себестоимости, доля расходов и маржа EBITDA показываются только при положительных доходах; без такого подтверждения коэффициент остаётся недоступным, а не превращается в выдуманный ноль.",
        },
        do: async (p, l, h) => {
          await h.moveTo(FC_KPIS);
          await h.holdUntil(0.5);
          await h.hover(FC_COMPARISON);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi Optimist görünüşə keçirəm; o yalnız ekrandakı lokal çarpanları tətbiq edir: gəlir arta, maya dəyəri və xərclər azala bilər. Bu klik bazaya yeni proqnoz yazmır və planı dəyişmir. Aylıq trenddə yaşıl sütun gəliri, narıncı sütun maya dəyəri ilə əməliyyat xərclərinin cəmini, bənövşəyi xətt isə eyni düsturla EBITDA-nı göstərir.",
          en: "Now I switch to Optimistic; it applies only the local on-screen multipliers, so revenue can rise while COGS and operating expense fall. This click does not save a new forecast or alter the plan. In the monthly trend, green bars are revenue, orange bars combine COGS and operating expenses, and the purple line is EBITDA from that same complete formula.",
          ru: "Теперь я переключаюсь на оптимистичный вид; он применяет только локальные экранные множители: доходы могут вырасти, а себестоимость и операционные расходы снизиться. Переключение не сохраняет новый прогноз и не меняет план. На месячном графике зелёные столбцы — доходы, оранжевые — все затраты, фиолетовая линия — EBITDA по той же полной формуле.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(FC_OPTIMISTIC);
          await h.holdUntil(0.55);
          await h.moveTo(FC_MONTHLY);
          await h.holdUntil(0.78);
          await h.hover(FC_COMPARISON);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi Pessimist ssenariyə keçirəm; bu, gəliri azaldıb xərcləri artıran lokal stress baxışıdır. Sağdakı müqayisə üç ssenarinin gəlirindən bütün xərcləri çıxaraq EBITDA nəticəsini eyni əsasda göstərir. Parametrlər düyməsi çarpanları açır, lakin bu təlim inputları açmır və dəyişmir, beləliklə istehsal məlumatında yeni məna yaratmır.",
          en: "Now I switch to Pessimistic, a local stress view that reduces revenue and increases costs. The comparison card evaluates all three scenarios on one basis by deducting every cost from revenue to reach EBITDA. The settings control exposes multipliers, but this guide never opens or edits an input, so it cannot create a new meaning in production data.",
          ru: "Теперь я переключаюсь на пессимистичный сценарий — локальный стресс-вид, который снижает доходы и повышает затраты. Карточка сравнения оценивает три сценария на одной основе, вычитая из доходов все затраты до EBITDA. Настройки открывают множители, но гайд не открывает и не меняет input, поэтому не создаёт новый смысл в производственных данных.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(FC_PESSIMISTIC);
          await h.holdUntil(0.55);
          await h.moveTo(FC_SETTINGS);
          await h.holdUntil(0.78);
          await h.hover(FC_PNL);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İndi Baza ssenarisinə qayıdıb P&L xülasəsini yoxlayıram. Hər ay üçün gəlir, bütün xərclər, EBITDA və marja göstərilir; aylıq sütunların cəmi sağdakı dövr yekunu ilə uyğun olmalıdır. Sonra Gəlir bölməsini açıb məbləğin hansı büdcə kateqoriyalarından gəldiyini izləyirik, lakin heç bir rəqəm xanasına toxunmuruq.",
          en: "Now I return to Base and inspect the P&L summary. Each month shows revenue, total costs, EBITDA, and margin, and the monthly columns must reconcile to the period total at the right. We then open Revenue to trace the amount into budget categories, but never click a numeric cell because that surface can enter an editable state.",
          ru: "Теперь я возвращаюсь в базовый сценарий и проверяю сводку P&L. Для каждого месяца показаны доходы, все затраты, EBITDA и маржа, а сумма месячных колонок должна сходиться с итогом периода справа. Затем раскрываем Доходы до бюджетных категорий, но не нажимаем числовые ячейки, потому что они могут перейти в режим редактирования.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(FC_BASE);
          await h.holdUntil(0.55);
          await h.safeClick(FC_REVENUE);
          await h.holdUntil(0.8);
          await h.moveTo(FC_MATRIX);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Gəlir bölməsini bağlayıb Maya dəyərini açıram və izah zamanı onu açıq saxlayıram. Maya dəyəri ümumi mənfəətdən əvvəl gəlirdən çıxılır; bu lokal keçid heç nə saxlamır. Bir kateqoriyada kursiv məbləğ görürsünüzsə, bu plan bazasıdır; adi üslubda açıq sıfır isə saxlanmış aylıq düzəliş ola bilər və itkin qeydlə qarışdırılmamalıdır.",
          en: "I close Revenue, open COGS, and keep its rows visible while explaining them. COGS is deducted from revenue before gross profit, and this local view change saves nothing. If a category amount is italic, it comes from the plan baseline; an explicit saved zero can instead be a real monthly override and must remain distinguishable from an absent entry.",
          ru: "Я закрываю Доходы, раскрываю Себестоимость и оставляю её строки видимыми на время объяснения. Себестоимость вычитается из доходов до валовой прибыли, а локальное изменение вида ничего не сохраняет. Курсивная сумма пришла из плановой базы; явный сохранённый ноль может быть месячным переопределением и должен отличаться от отсутствующей записи.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(FC_REVENUE);
          await h.holdUntil(0.55);
          await h.safeClick(FC_COGS);
          await h.holdUntil(0.8);
          await h.moveTo(FC_MATRIX);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Maya dəyərini bağlayıb Əməliyyat xərclərini açıram və sətirləri ekranda saxlayıram. Bu xərclər EBITDA hesablamasının son əsas hissəsidir. Matrisdəki aylıq EBITDA yuxarı P&L xülasəsi və trend xətti ilə uyğun olmalıdır; fərq yaranarsa, videonu yayımlamaq və rəqəmi şərh etmək olmaz, əvvəl düstur, mənbə və dövr uzlaşdırılmalıdır.",
          en: "I close COGS, open Operating expenses, and keep those rows on screen. They are the final major component of EBITDA. Monthly EBITDA in the matrix must agree with the upper P&L summary and trend line; if those surfaces ever disagree, the guide must not be published and the number must not be interpreted until formula, source, and period are reconciled.",
          ru: "Я закрываю Себестоимость, раскрываю Операционные расходы и оставляю строки на экране. Это последний крупный компонент EBITDA. Месячная EBITDA в матрице должна совпадать с верхней сводкой P&L и линией тренда; если экраны расходятся, гайд нельзя публиковать и цифру нельзя интерпретировать до сверки формулы, источника и периода.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.25);
          await h.safeClick(FC_COGS);
          await h.holdUntil(0.55);
          await h.safeClick(FC_EXPENSE);
          await h.holdUntil(0.8);
          await h.moveTo(FC_PNL);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Sonda Əməliyyat xərclərini bağlayıram. Təhlükəsiz iş ardıcıllığı belədir: əvvəl planı və dövrü təsdiqləyin, sonra saxlanmış düzəlişlərin sayını və valyuta sübutunu yoxlayın, daha sonra KPI, trend, ssenari müqayisəsi və detallı matrisi uzlaşdırın. Proqnoz qeydi yoxdursa, plan bazasını qərar üçün hazır tarixi proqnoz adlandırmayın; təsdiqlənmiş aylıq mənbəni əvvəl preview edin.",
          en: "Finally I close Operating expenses. The safe sequence is: confirm plan and period, check the saved-override count and currency evidence, then reconcile KPIs, trend, scenario comparison, and detailed matrix. When no forecast entries exist, do not call the plan baseline a decision-ready historical forecast; preview an approved monthly forecast source before any import or interpretation.",
          ru: "В завершение я закрываю Операционные расходы. Безопасная последовательность такова: подтвердите план и период, проверьте число сохранённых переопределений и валюту, затем сверьте KPI, тренд, сценарии и детальную матрицу. Если записей прогноза нет, не называйте плановую базу готовым для решений историческим прогнозом; до импорта и выводов сначала сделайте preview утверждённого месячного источника.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.2);
          await h.safeClick(FC_EXPENSE);
          await h.holdUntil(0.45);
          await h.moveTo(FC_PROVENANCE);
          await h.holdUntil(0.68);
          await h.hover(FC_KPIS);
          await h.holdUntil(0.88);
          await h.moveTo(FC_MATRIX);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "plans": {
    route: "/budgeting?tab=plans",
    title: {
      az: "Planlar — təşkilat üzrə nəzarət reyestri",
      en: "Plans — organization-wide control registry",
      ru: "Планы — реестр контроля организации",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Büdcələşdirmə bölməsinin Planlar reyestridir. Görünüş bütün təşkilat üzrə canlı planları, təsdiq vəziyyətini və versiyaları göstərir; ayrıca şirkət filtri tətbiq etmir. Yumşaq silinmiş planlar siyahıya daxil deyil. Yuxarıdakı mənşə qeydi bu scope-u açıq saxlayır ki, kartı ayrıca hüquqi şəxsin məlumatı kimi səhv oxumayasınız.",
          en: "This is the Plans registry inside Budgeting. It shows live plans, approval state, and versions across the organization and does not apply an individual-company filter. Soft-deleted plans are excluded. The provenance disclosure keeps that scope explicit, so a card is never mistaken for evidence belonging to one legal entity.",
          ru: "Это реестр Планов в разделе Бюджетирования. Он показывает активные планы, согласование и версии всей организации и не применяет фильтр отдельной компании. Мягко удалённые планы исключены. Пояснение об источнике явно закрепляет этот scope, чтобы карточку не приняли за данные одного юридического лица.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(PLANS_ROOT, { timeout: 12000 });
          await h.moveTo(PLANS_PROVENANCE);
          await h.holdUntil(0.5);
          await h.hover(PLANS_ROOT);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Başlıqdakı plan sayı reyestrdəki kartları sayır, maliyyə sətirlərini deyil. Hər kart ayrıca canlı sətir sübutunu göstərir. Sıfır sətir açıq şəkildə boş plan deməkdir; say metadata-sı gəlməyibsə, vəziyyət naməlum qalır. Naməlum dəyəri sıfıra çevirmək və boş planı doldurulmuş kimi şərh etmək olmaz.",
          en: "The count in the heading measures registry cards, not financial lines. Each card separately reports its live-line evidence. An explicit zero means the plan is empty; when count metadata is unavailable, the state remains unknown. Unknown must never be converted to zero, and an empty plan must not be interpreted as populated evidence.",
          ru: "Счётчик в заголовке считает карточки реестра, а не финансовые строки. Каждая карточка отдельно показывает число активных строк. Явный ноль означает пустой план; если метаданные количества не пришли, состояние остаётся неизвестным. Неизвестное нельзя превращать в ноль, а пустой план — считать заполненным доказательством.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_COUNT);
          await h.holdUntil(0.5);
          await h.hover(PLANS_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Kartın adı yalnız istifadəçi etiketidir və maliyyə mənasını sübut etmir. Növ sahəsi büdcə-planı faktiki nəticədən açıq ayırır; dövr sahəsi illik, rüblük və ya aylıq yuvanı göstərir. Müqayisə və qərar verməzdən əvvəl növü, ili və dövr detalını birlikdə yoxlayın, heç vaxt addan təxmin etməyin.",
          en: "A card name is only a user label and does not prove financial meaning. The kind field explicitly separates a budget plan from realized actuals, while the period identifies the annual, quarterly, or monthly slot. Before comparing or deciding, verify kind, year, and period granularity together; never infer them from the name.",
          ru: "Название карточки — лишь пользовательская метка и не доказывает финансовый смысл. Вид явно отделяет бюджетный план от реализованного факта, а период задаёт годовой, квартальный или месячный слот. Перед сравнением и выводами проверяйте вместе вид, год и детализацию периода; никогда не угадывайте их по названию.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_CARD);
          await h.holdUntil(0.5);
          await h.hover(PLANS_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Rəngli nöqtə və mətn maliyyə keyfiyyətini deyil, iş axınının vəziyyətini göstərir: qaralama, təsdiq gözləyən, təsdiqlənmiş, rədd edilmiş və ya bağlanmış. Göndərilmə və təsdiq tarixləri proses izidir. Təsdiqlənmiş status məlumatın tam, düzgün və qərar üçün hazır olduğunu avtomatik sübut etmir; sətir və mənbə sübutu ayrıca yoxlanmalıdır.",
          en: "The colored dot and label describe workflow state, not financial quality: draft, pending approval, approved, rejected, or closed. Submission and approval timestamps are process evidence. An approved status does not automatically prove that data is complete, correct, or decision-ready; line counts and source evidence still require a separate review.",
          ru: "Цветная точка и подпись описывают состояние процесса, а не качество финансов: черновик, ожидание, одобрение, отклонение или закрытие. Даты отправки и одобрения — след процесса. Статус «одобрен» сам по себе не доказывает полноту, корректность или готовность к решению; строки и источники проверяются отдельно.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_STATUS);
          await h.holdUntil(0.5);
          await h.hover(PLANS_CARD);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İş sahəsi üçün başlanğıc seçim ən yeni doldurulmuş büdcəyə üstünlük verir; beləliklə icra göstəricisi planı faktla düzgün müqayisə edə bilir. Boş kart reyestrdə görünməyə davam edir, lakin qərar mənbəyi sayılmır. Bu təlim heç bir Select və ya Active idarəsinə basmır, çünki seçim başqa iş görünüşünə keçir.",
          en: "The Workspace default prefers the newest populated budget, allowing execution to compare a plan with actuals on the correct basis. An empty card remains visible in the registry but is not decision evidence. This guide never presses Select or Active, because selection changes the active plan and navigates into another working view.",
          ru: "Стартовый выбор Рабочей области предпочитает новейший заполненный бюджет, чтобы исполнение корректно сопоставляло план с фактом. Пустая карточка остаётся видимой в реестре, но не является доказательством для решения. Гайд не нажимает Select или Active: выбор меняет активный план и переводит в другой рабочий экран.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_EVIDENCE);
          await h.holdUntil(0.5);
          await h.hover(PLANS_CARD);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Plan kartları pul məbləği göstərmir, buna görə onlarda valyuta tətbiq edilmir və manat, dollar və ya başqa vahid təxmin olunmur. Versiya fərqi yalnız təşkilatın təsdiqlənmiş baza valyutası olduqda əlçatan olur. Valyuta məlum deyilsə, müqayisə idarəsi gizli qalır; vahidsiz rəqəmlər təqdim edilmir.",
          en: "Plan cards contain no monetary amounts, so currency is not applicable there and the screen does not guess manat, dollars, or another unit. Version difference becomes available only when the organization has a confirmed base currency. If currency is unknown, the comparison control stays unavailable rather than presenting unitless financial numbers.",
          ru: "Карточки планов не содержат денежных сумм, поэтому валюта к ним неприменима и экран не угадывает манаты, доллары или другую единицу. Разница версий доступна только при подтверждённой базовой валюте организации. Если валюта неизвестна, сравнение остаётся недоступным и не показывает финансовые числа без единицы.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_CURRENCY);
          await h.holdUntil(0.5);
          await h.hover(PLANS_PROVENANCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Təsdiq paneli cari planın proses pilləsini, icazə verilən idarəetmələri və tarixçəni göstərir. Tarixçənin yükləmə xətası boş tarix kimi təqdim edilmir. Şərh sahəsi və göndər, təsdiqlə, rədd et, bağla və yenidən aç düymələri production-a yazır. Təlim yalnız panellərə işarə edir və heç bir idarəyə fokus vermir.",
          en: "The approval area shows the current workflow step, permitted controls, and recorded history. A history-loading error is never presented as an empty history. The comment field and submit, approve, reject, close, and reopen buttons write to production. This guide only points to the panels and never focuses or activates any control.",
          ru: "Область согласования показывает текущий шаг процесса, доступные действия и записанную историю. Ошибка загрузки истории не выдаётся за пустую историю. Поле комментария и кнопки отправки, одобрения, отклонения, закрытия и открытия записывают в production. Гайд только указывает на панели и не фокусирует и не активирует элементы.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_APPROVAL);
          await h.holdUntil(0.5);
          await h.hover(PLANS_APPROVAL_HISTORY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Versiya tarixçəsində hər qeyd ayrıca snapshot zənciridir, yeni faktiki dövr deyil. Yeni versiya mənbə planın büdcə və ya faktiki növünü saxlayır, nömrəni bütün canlı zəncir üzrə artırır və yumşaq silinmiş versiyaları göstərmir. Təlim New Version, versiya sətri və Diff idarəsinə basmır; bunlar ayrıca yoxlama tələb edir.",
          en: "In version history, each entry is a snapshot in one chain, not a new actual period. A new version preserves the source plan's budget-or-actual kind, increments the number across the complete live chain, and excludes soft-deleted versions. The guide never presses New Version, a version row, or Diff; those actions require separate review.",
          ru: "В истории каждая запись — снимок одной цепочки, а не новый фактический период. Новая версия сохраняет бюджетный или фактический вид источника, увеличивает номер по всей активной цепочке и исключает мягко удалённые версии. Гайд не нажимает «Новая версия», строку версии или Diff: эти действия требуют отдельной проверки.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_VERSION);
          await h.holdUntil(0.5);
          await h.hover(PLANS_VERSION);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Sonda təhlükəsiz baxış ardıcıllığı belədir: təşkilat scope-unu təsdiqləyin, plan sayını sətir sayından ayırın, növ və dövrü yoxlayın, sonra status, tarixçə və versiyaları oxuyun. Ad dəyişmə, yeni və sürüşkən plan, silmə, sıfırlama və proses düymələrinin hamısı yazma əməliyyatıdır. Bu READONLY təlimdə şəbəkə mutasiyası sıfır qalmalıdır.",
          en: "The safe review sequence is: confirm organization scope, separate the plan count from line counts, verify kind and period, then read status, approval history, and versions. Rename, new plan, rolling plan, delete, reset, and every workflow button are write operations. In this READONLY guide, the production mutation count must remain exactly zero.",
          ru: "Безопасный порядок таков: подтвердить scope организации, отделить число планов от числа строк, проверить вид и период, затем прочитать статус, историю и версии. Переименование, новый и скользящий план, удаление, сброс и все кнопки процесса являются записью. В этом READONLY-гайде число production-мутаций обязано остаться ровно нулевым.",
        },
        do: async (p, l, h) => {
          await h.moveTo(PLANS_MUTATIONS);
          await h.holdUntil(0.38);
          await h.hover(PLANS_COUNT);
          await h.holdUntil(0.7);
          await h.moveTo(PLANS_PROVENANCE);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "risk-terminal": {
    route: "/budgeting/terminal",
    title: {
      az: "Risk Terminal — ekspert baxışı",
      en: "Risk Terminal — expert overview",
      ru: "Risk Terminal — обзор экспертного режима",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Risk Terminalın ekspert rejimidir: holdinq şirkətlərini, göstərici matrisini, seçilmiş göstəricinin izahını və şirkət snapshot-ını eyni ekranda birləşdirən dörd panelli iş sahəsi. Bu səth sürətli araşdırma üçündür, lakin rəngli xanalar hələ ilkin və decision-grade deyil; daimi etibar xəbərdarlığını nəticə kimi yox, məhdudiyyət kimi oxumaq lazımdır.",
          en: "This is Risk Terminal in Expert mode: a four-panel workspace combining the holding company tree, indicator matrix, selected-indicator detail, and company snapshot on one screen. It is designed for rapid investigation, but the coloured cells are still provisional rather than decision-grade; the permanent trust warning is a limitation to respect, not a certification result.",
          ru: "Это экспертный режим Risk Terminal: четырёхпанельная рабочая область, где на одном экране объединены дерево компаний холдинга, матрица индикаторов, детали выбранного показателя и снимок компании. Экран предназначен для быстрого исследования, но цветные ячейки пока предварительные, не decision-grade; постоянное предупреждение о доверии нужно считать ограничением, а не сертификатом результата.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_ROOT, { timeout: 15000 });
          await p.waitForSelector(TERM_TOOLBAR, { timeout: 15000 });
          await h.moveTo(TERM_ROOT);
          await h.holdUntil(0.5);
          await h.hover(TERM_TOOLBAR);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Yuxarıdakı hotkey paneli ən çox istifadə olunan funksiyalara yol göstərir, command sətri isə şirkət, göstərici və əmrləri klaviatura ilə tapmağa imkan verir. Recompute, yeni plan, import və digər fəaliyyətlər production-a yaza bilər. Bu təlim yalnız idarəetmələrin yerini göstərir, heç bir əmri daxil etmir və heç bir yazma düyməsini basmır.",
          en: "The hotkey bar points to frequently used functions, while the command line can find companies, indicators, and commands from the keyboard. Recompute, new plan, import, and several other actions can write to production. This walkthrough only identifies the controls; it enters no command and activates none of the write-capable buttons.",
          ru: "Верхняя панель горячих действий показывает часто используемые функции, а командная строка позволяет искать компании, индикаторы и команды с клавиатуры. Recompute, новый план, импорт и ряд других действий могут записывать в production. Этот обзор только показывает расположение элементов, не вводит команд и не нажимает кнопки, способные изменить данные.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_TOOLBAR, { timeout: 15000 });
          await p.waitForSelector(TERM_COMMAND, { timeout: 15000 });
          await h.moveTo(TERM_TOOLBAR);
          await h.holdUntil(0.5);
          await h.hover(TERM_COMMAND);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Birinci panel holdinq iyerarxiyasını göstərir. Burada AZSEKER daxilində AZSF əməliyyat şirkətini seçirəm. Seçim yalnız brauzer vəziyyətini dəyişir: matris həmin şirkətə daralır və snapshot eyni konteksti götürür. Arxiv, data reset və ulduz idarələrinə toxunmuram; onlar ayrıca məqsəd və səlahiyyət tələb edir.",
          en: "Panel one is the holding hierarchy. I select the AZSF operating company inside AZSEKER. This selection changes browser state only: the matrix narrows to that company and the snapshot follows the same context. I do not touch archive, data-reset, or star controls, because those have separate intent and authorization requirements.",
          ru: "Первая панель показывает иерархию холдинга. Я выбираю операционную компанию AZSF внутри AZSEKER. Выбор меняет только состояние браузера: матрица сужается до этой компании, а снимок принимает тот же контекст. Я не трогаю архив, сброс данных и звёздочку, потому что у этих действий отдельные назначение и требования к полномочиям.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_TREE, { timeout: 15000 });
          await h.moveTo(TERM_TREE);
          await h.holdUntil(0.35);
          await p.waitForSelector(TERM_COMPANY, { timeout: 15000 });
          await h.safeClick(TERM_COMPANY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Dördüncü panel indi seçilmiş şirkətin snapshot-ını göstərir. Kompozit bal, marja göstəriciləri və əsas xəbərdarlıqlar eyni matris kontekstindən gəlir; ayrıca təsdiqlənmiş maliyyə hesabatı kimi təqdim edilmir. Dəyər yoxdursa tire və ya açıq empty state qalmalıdır. Risk etiketi və provenance işarəsi rəqəmin mənasını və etibar səviyyəsini məhdudlaşdırır.",
          en: "Panel four now shows the selected company's snapshot. Its composite score, margin indicators, and leading alerts come from the same matrix context; they are not presented as a separately certified financial statement. Missing evidence must remain a dash or an explicit empty state. Risk tags and provenance markers constrain how each figure may be interpreted.",
          ru: "Четвёртая панель теперь показывает снимок выбранной компании. Композитный балл, показатели маржи и главные предупреждения берутся из того же контекста матрицы, а не выдаются за отдельно подтверждённую отчётность. При отсутствии доказательства должны оставаться тире или явное пустое состояние. Метки риска и происхождения ограничивают интерпретацию каждого числа.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_SNAPSHOT, { timeout: 15000 });
          await h.moveTo(TERM_SNAPSHOT);
          await h.holdUntil(0.5);
          await h.hover(TERM_SNAPSHOT);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İkinci panel risk matrisidir. Sətirlər şirkətləri, sütunlar kanonik göstəriciləri göstərir; dairə, üçbucaq və kvadrat formaları statusu təkrar kodlayır, yəni rəng yeganə işarə deyil. N-A tətbiq olunmayan cütdür, tire sübutun olmadığını göstərir, sübut edilmiş sıfır isə real sıfır olaraq qalır. LEGACY və NOT DECISION-GRADE banneri görünərkən rəng yoxlama siqnalıdır, qərarın özü deyil.",
          en: "Panel two is the risk matrix. Rows are companies and columns are canonical indicators; circles, triangles, and squares repeat the status so colour is not the only encoding. N-A is not applicable, a dash is absent or unsupported, and an evidenced zero remains a real zero rather than either state. With the LEGACY and NOT DECISION-GRADE banner visible, colour supports review but is not a decision.",
          ru: "Вторая панель — матрица рисков. Строки соответствуют компаниям, столбцы — каноническим индикаторам; круги, треугольники и квадраты дублируют статус, чтобы цвет не был единственным кодом. N-A означает неприменимость, тире — отсутствие доказательства, а подтверждённый ноль остаётся реальным нулём. Пока виден баннер LEGACY и NOT DECISION-GRADE, цвет помогает проверке, но не является решением.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_TRUST, { timeout: 15000 });
          await p.waitForSelector(TERM_MATRIX, { timeout: 15000 });
          await h.moveTo(TERM_TRUST);
          await h.holdUntil(0.5);
          await h.hover(TERM_MATRIX);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "AZSF üçün Food Processing Gross Margin xanasını açıram. Bu klik yeni hesablamanı işə salmır və məlumat saxlamır; mövcud IndicatorValue identifikatorunu üçüncü panelə ötürür və detail API-dən hazır sübutu GET ilə oxuyur. Xana mövcud olmasaydı, terminal sıfır uydurmaq əvəzinə şirkət və göstərici kodları ilə no-data vəziyyəti göstərməli idi.",
          en: "I open the Food Processing Gross Margin cell for AZSF. The click does not recompute or save anything; it passes the existing IndicatorValue identifier to panel three and reads the prepared evidence through a GET detail request. If the cell did not exist, the terminal would show a no-data state with company and indicator codes instead of inventing zero.",
          ru: "Я открываю ячейку Food Processing Gross Margin для AZSF. Клик ничего не пересчитывает и не сохраняет: он передаёт существующий идентификатор IndicatorValue в третью панель и читает подготовленное доказательство через GET detail. Если бы ячейки не было, терминал показал бы no-data с кодами компании и индикатора, а не выдуманный ноль.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_CELL, { timeout: 15000 });
          // The heatmap body scrolls inside a ~94px port behind a two-line
          // sticky <thead>. A 30px row therefore has only a couple of pixels of
          // clearance, and the recorder lands on the wrong side of them: a bare
          // probe clicks this cell at y=411 in 134ms, while the recorder — same
          // page, same collapsed sidebar — arrives at y=413 and every attempt
          // dies with "<thead> subtree intercepts pointer events".
          //
          // Verified in that order, not assumed: centring the cell in its
          // scrollport did not help, and neither did collapsing the sidebar
          // (which was separately broken and is now fixed). The margin is the
          // problem.
          //
          // The header carries a column label and a hover tooltip and no
          // controls at all, and no scene targets it. Making it transparent to
          // the pointer changes nothing the viewer sees and nothing they could
          // have clicked. Preferred over forcing the click, which would let a
          // genuinely unreachable control pass unnoticed.
          await p.addStyleTag({ content: "#risk-heatmap-table thead { pointer-events: none; }" });
          await h.holdUntil(0.25);
          await h.safeClick(TERM_CELL);
          await p.waitForSelector('[data-testid="indicator-detail-result"]', { timeout: 15000 });
          await p.waitForSelector(TERM_DETAIL, { timeout: 15000 });
          await h.holdUntil(0.65);
          await h.moveTo(TERM_DETAIL);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Üçüncü panel seçilmiş göstəricinin dövrünü, vahidini, istiqamətini, hədlərini, provenance və audit vəziyyətini açır. Dördüncü paneldə AI Variance Explainer üçün yalnız təlimat görünür. Explain və Re-run pullu provider çağırışlarıdır və yalnız istifadəçinin açıq hərəkətindən sonra işləməlidir; xana seçimi və hover artıq avtomatik token sərf etmir, bu təlim də onları basmır.",
          en: "Panel three exposes the selected indicator's period, unit, direction, thresholds, provenance, and audit posture. Panel four shows only the instruction for AI Variance Explainer. Explain and Re-run are paid-provider calls and must run only after explicit user action; selecting or hovering a cell no longer spends tokens automatically, and this guide activates neither control.",
          ru: "Третья панель раскрывает период, единицу, направление, пороги, происхождение и состояние аудита выбранного индикатора. В четвёртой видна только инструкция для AI Variance Explainer. Explain и Re-run вызывают платного провайдера и должны работать лишь после явного действия пользователя; выбор или наведение на ячейку больше не расходуют токены автоматически, и гайд не запускает эти элементы.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_DETAIL, { timeout: 15000 });
          await p.waitForSelector(TERM_VARIANCE, { timeout: 15000 });
          await h.hover(TERM_DETAIL);
          await h.holdUntil(0.55);
          await h.moveTo(TERM_VARIANCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Dövr çipləri illik, rüblük və aylıq görünüşləri eyni seçilmiş period üzərindən dəyişir; time machine də həmin ümumi kontekstdən istifadə edir. Bu baxış heç bir periodu dəyişmir və ssenarini işə salmır. Mümkün şoku şərh etməzdən əvvəl periodu, mənbə təzəliyini və məlumat əhatəsini ayrıca yoxlamaq lazımdır.",
          en: "The period chips switch annual, quarterly, and monthly views through one shared selected-period context, and the time machine follows that same state. This overview changes no period and runs no simulation. Before interpreting any possible shock, verify the period, source freshness, and evidence coverage separately.",
          ru: "Чипы периода переключают годовой, квартальный и месячный виды через единый выбранный период, а time machine следует тому же состоянию. Этот обзор не меняет период и не запускает симуляцию. До толкования возможного шока нужно отдельно проверить период, свежесть источника и полноту доказательств.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_PERIODS, { timeout: 15000 });
          await h.moveTo(TERM_PERIODS);
          await h.holdUntil(0.5);
          await h.hover(TERM_PERIODS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Aşağıdakı audit ticker son qeydə alınmış hadisələri sadalayır, lakin onların əsas rəqəmlərini təsdiqləmir. Təhlükəsiz ardıcıllıq belədir: şirkəti seçin, periodu və etibar bannerini yoxlayın, detail və provenance-ni oxuyun, sonra yalnız səlahiyyət və məqsəd açıq təsdiqlənəndə yazma və ya pullu AI əməliyyatına keçin.",
          en: "At the bottom, the audit ticker lists recent recorded events but does not certify their underlying numbers. The safe sequence is: choose a company, verify period and trust banner, inspect detail and provenance, then use writes or paid AI only when authority and intent are explicitly confirmed.",
          ru: "Внизу audit ticker перечисляет недавние зарегистрированные события, но не сертифицирует лежащие в их основе цифры. Безопасный порядок: выбрать компанию, проверить период и баннер доверия, изучить детали и происхождение, затем применять запись или платный AI только при явно подтверждённых полномочиях и цели.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(TERM_AUDIT, { timeout: 10000 });
          await h.hover(TERM_AUDIT);
          await h.holdUntil(0.55);
          await p.waitForSelector(TERM_ROOT, { timeout: 15000 });
          await h.moveTo(TERM_ROOT);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  alerts: {
    route: "/budgeting/alerts/history",
    title: {
      az: "Alert qiymətləndirmə snapshot-u",
      en: "Alert evaluation snapshot",
      ru: "Снимок оценки алертов",
    },
    scenes: [
      {
        voice: {
          az: "Bu ekran tam alert tarixçəsi və real vaxt monitorinqi deyil. O, seçilmiş dövr üçün uğurla yadda saxlanmış son qiymətləndirmə görüntüsünü göstərir. Sonrakı görüntü yalnız uğurla yadda saxlananda eyni təşkilat və dövr üzrə əvvəlki dəsti atomik əvəz edir; saxlama xətası köhnə görüntünü saxlaya bilər. Təlim səhifəni yalnız oxuyur.",
          en: "This screen is not a complete alert history or a live monitor. It shows the latest successfully persisted evaluation snapshot for the selected period. A later snapshot atomically replaces the prior set for the same organization and period only when persistence succeeds; a persistence failure can leave the older snapshot in place. This walkthrough only reads the page.",
          ru: "Этот экран не является полной историей алертов или live-мониторингом. Он показывает последний успешно сохранённый снимок оценки выбранного периода. Следующий снимок атомарно заменяет прежний набор той же организации и периода только при успешном сохранении; ошибка сохранения может оставить старый снимок. Обзор только читает страницу.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_ROOT, { timeout: 15000 });
          await p.waitForSelector(ALERTS_HEADER, { timeout: 15000 });
          await h.hover(ALERTS_HEADER);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_FEED);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Mavi evidence boundary hər sətrin nəyi sübut etdiyini məhdudlaşdırır. Sətr yalnız snapshot saxlananda qaydanın uyğun gəldiyini göstərir; şərtin indi də aktual, təsdiqlənmiş, həll edilmiş və ya qərar üçün yararlı olduğunu göstərmir. Heç bir sətr olmadıqda qiymətləndiricinin həmin period üçün işlədiyi də sübut olunmur.",
          en: "The blue evidence boundary limits what each row can prove. A row shows only that a rule matched when this snapshot was stored; it does not prove the condition is current, acknowledged, resolved, financially material, or decision-grade. If no row exists, that absence also does not prove the evaluator ran for the period.",
          ru: "Синий блок границ доказательств ограничивает смысл каждой строки. Строка доказывает лишь совпадение правила в момент сохранения снимка; она не подтверждает актуальность, признание, устранение, финансовую существенность или пригодность для решения. Отсутствие строк также не доказывает, что оценка за период вообще выполнялась.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_SCOPE, { timeout: 15000 });
          await h.hover(ALERTS_SCOPE);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_SUMMARY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Filtr sahəsi mövcud saxlanmış görüntünü dəqiq texniki Rule ID üzrə daraldır. Bu, sərbəst mətn axtarışı, status dəyişməsi və ya riskin yenidən hesablanması deyil. Dəqiq illik, rüblük və ya aylıq dövr URL-dən gəlir, ilkin siyahı isə təşkilat və istifadəçinin şirkət icazələri daxilində serverdən oxunur. Bu səhnə formanı göndərmir.",
          en: "The filter area narrows the current stored snapshot by an exact technical Rule ID. It is not free-text search, a status change, or a risk recomputation. The exact annual, quarterly, or monthly period comes from the URL, while the initial feed is read from the server within organization and company scope. This scene does not submit the form.",
          ru: "Область фильтра сужает текущий сохранённый снимок по точному техническому Rule ID. Это не полнотекстовый поиск, не изменение статуса и не пересчёт риска. Точный годовой, квартальный или месячный период берётся из URL, а исходная лента читается с сервера в пределах организации и доступных компаний. Сцена не отправляет форму.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_FILTER, { timeout: 15000 });
          await h.hover(ALERTS_FILTER);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_RULE_INPUT);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Rule ID input-u yalnız dəqiq identifikator qəbul edir, məsələn company-mostly-red. Dəyəri bilmirsinizsə, nəticəni təxmin etməyin: əvvəl qayda kataloqundan və ya saxlanmış sətirdən ID-ni yoxlayın. Təlim input-u doldurmur; buna görə browser state-i dəyişmir, əlavə sorğu göndərmir və nəticələri gizlətmir.",
          en: "The Rule ID input expects an exact identifier such as company-mostly-red. If the value is unknown, do not guess it: confirm the identifier from the rule catalog or a stored row first. The guide does not fill this input, so it changes no browser state, sends no additional request, and hides no results.",
          ru: "Поле Rule ID ожидает точный идентификатор, например company-mostly-red. Если значение неизвестно, не угадывайте: сначала подтвердите ID по каталогу правил или сохранённой строке. Гайд не заполняет поле, поэтому не меняет состояние браузера, не отправляет дополнительных запросов и не скрывает результаты.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_RULE_INPUT, { timeout: 15000 });
          await h.hover(ALERTS_RULE_INPUT);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_APPLY);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Apply filter düyməsi yalnız daxil edilmiş Rule ID ilə yeni read-only GET sorğusu göndərir və ilk səhifəni əvəz edir. O, indikatorları recompute etmir, alert-i acknowledged etmir, məlumat yazmır və AI provider çağırmır. Təhlükəsiz guide düymənin mənasını göstərir, lakin onu basmır və serverə yeni sorğu göndərmir.",
          en: "Apply filter sends only a new read-only GET using the entered Rule ID and replaces the first result page. It does not recompute indicators, acknowledge an alert, write data, or invoke an AI provider. This safe guide points to the control without pressing it, so it sends no new filter request to the server.",
          ru: "Кнопка Apply filter отправляет только новый read-only GET с введённым Rule ID и заменяет первую страницу результатов. Она не пересчитывает индикаторы, не подтверждает алерт, не записывает данные и не вызывает AI-провайдера. Безопасный гайд лишь показывает кнопку, но не нажимает её и не отправляет запрос.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_APPLY, { timeout: 15000 });
          await h.hover(ALERTS_APPLY);
          await h.holdUntil(0.55);
          await p.waitForSelector(ALERTS_FILTER_DISCLOSURE, { timeout: 15000 });
          await h.moveTo(ALERTS_FILTER_DISCLOSURE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Reset filter input-u təmizləyir və həmin periodun filtrsiz ilk səhifəsini yenidən GET ilə oxuyur. Bu reset məlumatları silən admin reset deyil və alert vəziyyətini dəyişmir. Bununla belə, guide reproduktiv qalmaq üçün düyməni basmır; sadəcə onun read-only sərhədini aşağıdakı açıqlama ilə birlikdə göstərir.",
          en: "Reset filter clears the input and reads the unfiltered first page for the same period with another GET. This is not an administrative reset that deletes data, and it does not change alert state. Even so, the guide avoids pressing it to remain reproducible and only highlights its read-only boundary beside the disclosure.",
          ru: "Reset filter очищает поле и новым GET читает первую нефильтрованную страницу того же периода. Это не административный reset с удалением данных и он не меняет состояние алерта. Тем не менее гайд не нажимает кнопку ради воспроизводимости, а только показывает её read-only границу рядом с пояснением.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_RESET, { timeout: 15000 });
          await h.hover(ALERTS_RESET);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_FILTER_DISCLOSURE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Severity badge qayda konfiqurasiyasındakı prioritetdir. Critical, warning və information formaları rənglə yanaşı fərqli simvollardan istifadə edir; tanınmayan dəyər ayrıca unknown kimi göstərilir və info kimi maskalanmır. Bu etiket ehtimal hesabı, audit rəyi və ya maliyyə materiality ölçüsü deyil, ona görə ayrıca sübutla yoxlanmalıdır.",
          en: "A severity badge represents configured rule priority. Critical, warning, and information use distinct shapes as well as color, while an unrecognized value is shown separately as unknown rather than disguised as information. This label is not a probability estimate, audit opinion, or financial-materiality measure, so the underlying evidence still requires separate review.",
          ru: "Значок severity отражает настроенный приоритет правила. Critical, warning и information различаются не только цветом, но и формой; неизвестное значение показывается отдельно как unknown, а не маскируется под info. Эта метка не является вероятностью, аудиторским мнением или оценкой финансовой существенности, поэтому доказательства проверяются отдельно.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_READING, { timeout: 15000 });
          await p.waitForSelector(ALERTS_READ_SEVERITY, { timeout: 15000 });
          await h.hover(ALERTS_READ_SEVERITY);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_EVENT_ROW);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Built-in qaydalar saxlanmış message key və parametrlərdən istifadə edərək seçilmiş dildə yenidən göstərilir; buna görə standart mesajlar İngiliscə donub qalmır. Custom qaydalarda uyğun translation olmadıqda saxlanmış mənbə dilində mətn fallback ola bilər. Mesaj interpretasiyadır, rəqəmlərin provenance və freshness yoxlamasını əvəz etmir.",
          en: "Built-in rules are rendered in the selected language from stored message keys and parameters, so standard messages are not frozen in English. A custom rule can fall back to its stored source-language text when no translation contract exists. The message remains an interpretation and does not replace provenance, freshness, or reconciliation checks on the underlying figures.",
          ru: "Встроенные правила отображаются на выбранном языке из сохранённых ключей и параметров, поэтому стандартные сообщения не застывают на английском. Для пользовательского правила без контракта перевода возможен fallback к сохранённому исходному тексту. Сообщение остаётся интерпретацией и не заменяет проверку происхождения, свежести и сверки исходных цифр.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_READ_MESSAGE, { timeout: 15000 });
          await h.hover(ALERTS_READ_MESSAGE);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_EVENT_ROW);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Əgər snapshot əlli sətirdən böyükdürsə, Load more növbəti səhifəni cursor ilə oxuyur və mövcud siyahıya əlavə edir. O, əvvəlki recompute run-unu açmır və immutable tarix yaratmır. Ekrandakı ən son saxlanma vaxtını data freshness ilə qarışdırmayın; source period və lineage ayrıca yoxlanmalıdır.",
          en: "When a stored snapshot exceeds fifty rows, Load more reads the next cursor page and appends it to the current list. It does not open an older recompute run and does not create immutable history. Do not confuse the displayed storage time with source-data freshness; the source period, lineage, and current condition must still be checked separately.",
          ru: "Если сохранённый снимок превышает пятьдесят строк, Load more читает следующую cursor-страницу и добавляет её к текущему списку. Он не открывает прежний запуск recompute и не создаёт неизменяемую историю. Не путайте время сохранения со свежестью источника: период, происхождение и текущее состояние проверяются отдельно.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_READ_PAGINATION, { timeout: 15000 });
          await h.hover(ALERTS_READ_PAGINATION);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_RESULTS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Risk Terminal keçidi yalnız alert dəqiq bir şirkət və bir indikator göstərdikdə görünür. Keçid həmin şirkət, indikator və dövr xanasını həll edir; server icazəni və xananın mövcudluğunu yenidən yoxlayır. Naviqasiya özü AI izahı yaratmır. Çoxşirkətli və ya çoxindikatorlu alert-də qeyri-dəqiq cütü təxmin etmək əvəzinə keçid gizlədilir.",
          en: "A Risk Terminal link appears only when an alert identifies exactly one company and exactly one affected indicator. The resolver rechecks authorization and cell existence for that company, indicator, and period. Navigation itself does not generate an AI explanation. Multi-company or multi-indicator alerts withhold the link instead of guessing an invalid pair.",
          ru: "Ссылка в Risk Terminal появляется только когда алерт относится ровно к одной компании и одному индикатору. Resolver повторно проверяет доступ и наличие ячейки компании, индикатора и периода. Сама навигация не создаёт AI-объяснение. Для алертов с несколькими компаниями или индикаторами ссылка скрывается, чтобы не угадывать неверную пару.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(ALERTS_READ_DEEPLINK, { timeout: 15000 });
          await h.hover(ALERTS_READ_DEEPLINK);
          await h.holdUntil(0.55);
          await h.moveTo(ALERTS_SCOPE);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "board-deck": {
    route: "/budgeting/board-deck",
    title: {
      az: "Board Deck: sübut sərhədləri",
      en: "Board Deck: evidence boundaries",
      ru: "Board Deck: границы доказательности",
    },
    scenes: [
      {
        voice: {
          az: "Board Deck seçilmiş period üçün istifadəçinin icazə verdiyi əməliyyat şirkətlərinin risk snapshot-udur. Səhifənin açılma vaxtı məlumat mənbələrinin təzəliyi deyil və ekran audit olunmuş konsolidə maliyyə hesabatı sayılmır. Bu təlim yalnız real elementlər üzərində cursor gəzdirir; heç bir düymə basmır, məlumat yazmır və provider çağırmır.",
          en: "Board Deck is a risk snapshot for the selected period and the operational entities this user is allowed to see. The page assembly time is not source-data freshness, and this screen is not audited consolidated financial statements. This walkthrough only moves the cursor across real controls; it presses nothing, writes nothing, and invokes no provider.",
          ru: "Board Deck — это снимок рисков выбранного периода по операционным компаниям, доступным пользователю. Время сборки страницы не является свежестью источников, а экран не заменяет аудированную консолидированную отчётность. Гайд только перемещает курсор по реальным элементам: ничего не нажимает, не записывает и не вызывает провайдера.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_ROOT, { timeout: 15000 });
          await p.waitForSelector(BOARD_HERO, { timeout: 15000 });
          await h.hover(BOARD_HERO);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_HEADLINE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Evidence boundary əhatəni açıq göstərir: full scope və ya istifadəçinin alt-qrupu. Burada persisted indikator sətirlərinin sayı gözlənilən company-by-indicator matris yerləri ilə müqayisə olunur. Çatışmayan slot sıfır deyil, yaşıl deyil və təxminlə doldurulmur; coverage və lineage ayrıca yoxlanmadan bu snapshot decision-grade adlandırılmamalıdır.",
          en: "The evidence boundary names the scope explicitly: full visible scope or the user's subgroup. It compares persisted indicator rows with expected company-by-indicator matrix slots. A missing slot is not zero, not green, and is never imputed; coverage and lineage still require review before anyone treats the snapshot as decision-grade.",
          ru: "Блок доказательности явно показывает охват: весь доступный scope или подгруппу пользователя. Число сохранённых строк индикаторов сопоставляется с ожидаемыми слотами матрицы компания-на-индикатор. Отсутствующий слот — не ноль и не зелёный статус, он не заполняется догадкой; до проверки покрытия и происхождения снимок нельзя считать decision-grade.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_EVIDENCE, { timeout: 15000 });
          await h.hover(BOARD_EVIDENCE);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_SCORE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Hero balı sıfırdan yüzə qədərdir. Holding səviyyəsində yalnız hesablanmış əməliyyat şirkətlərinin bərabər çəkili ortası götürülür; balı olmayan şirkətlər orta hesabdan çıxarılır və caption iştirak edən sayını göstərir. Şirkət balının daxilində konfiqurasiya edilmiş indikator çəkiləri və keyfiyyət risk cərimələri tətbiq olunur.",
          en: "The hero score runs from zero to one hundred. At holding level it is an equal-weight mean of scored operational entities only; entities without a score are skipped, and the caption discloses the contributing count. Within each entity score, configured indicator weights and qualitative risk penalties apply.",
          ru: "Hero-балл лежит в диапазоне от нуля до ста. На уровне холдинга это среднее с равным весом только по оценённым операционным компаниям; компании без балла исключаются, а caption показывает число участников. Внутри балла компании учитываются настроенные веса индикаторов и качественные штрафы риска.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_SCORE, { timeout: 15000 });
          await h.hover(BOARD_SCORE);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_HERO);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Üç metric card cari scoped snapshot-u kontekstləşdirir. Red cells yalnız saxlanmış qırmızı statuslardır; denominator gözlənilən bütün matris slotlarıdır. Red sub-companies kompozit bandı göstərir. Indicators tracked isə tətbiq olunan indikator təriflərinin sayıdır, onların hər biri üçün təzə və reconciled evidence olduğunu sübut etmir.",
          en: "Three metric cards contextualize the current scoped snapshot. Red cells counts only persisted red statuses, while its denominator is all expected matrix slots. Red sub-companies reflects the composite band. Indicators tracked counts applicable definitions, not proof that every definition has fresh, reconciled evidence.",
          ru: "Три карточки дают контекст текущему scoped-снимку. Красные ячейки считают только сохранённые red-статусы, тогда как denominator — все ожидаемые слоты матрицы. Красные субкомпании относятся к composite band. Число отслеживаемых индикаторов — это число применимых определений, а не доказательство свежих и сверенных данных по каждому из них.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_METRICS, { timeout: 15000 });
          await h.hover(BOARD_METRICS);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_RED_CELLS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Trend ayrıca persisted aylıq periodları göstərir və boş aylar qrafikdə boş qalır; sistem onları interpolasiya etmir. Müqayisəni formula baxımından uyğun saxlamaq üçün aylıq ballar cari indikator çəkiləri və cari keyfiyyət cərimələri ilə yenidən hesablanır. Buna görə bu qrafik point-in-time risk-tag tarixçəsi deyil və illik hero periodu ilə eyni grain kimi oxunmamalıdır.",
          en: "The trend uses separate persisted monthly periods and leaves missing months as gaps rather than interpolating them. To keep the formula comparable, monthly scores are recalculated with current indicator weights and current qualitative penalties. It is therefore not point-in-time risk-tag history and must not be read as the same grain as an annual hero period.",
          ru: "Тренд использует отдельные сохранённые месячные периоды и оставляет отсутствующие месяцы пробелами без интерполяции. Для сопоставимости формулы месячные баллы пересчитываются с текущими весами индикаторов и текущими качественными штрафами. Поэтому это не point-in-time история risk tags и не тот же grain, что годовой hero-период.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_TREND, { timeout: 15000 });
          await h.hover(BOARD_TREND);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_TREND_LAST);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "AI bölməsi xərc sərhədini daimi göstərir. Adi page load, dil dəyişikliyi, PPTX, PDF və print yalnız exact-snapshot cache-ni oxuyur; cache miss provider çağırmır. Generate və Refresh ayrıca manager-only POST əməliyyatıdır, Anthropic xərcinə, narrative cache yazısına və audit event-ə səbəb ola bilər. Təlim həmin düyməni heç vaxt basmır.",
          en: "The AI panel makes the cost boundary permanent. Ordinary page loads, language changes, PPTX, PDF, and print read only the exact-snapshot cache; a cache miss never calls a provider. Generate and Refresh are separate manager-only POST actions that may spend Anthropic budget, write narrative cache, and emit an audit event. This guide never presses them.",
          ru: "AI-блок постоянно показывает границу расходов. Обычная загрузка, смена языка, PPTX, PDF и печать только читают кэш точного снимка; cache miss не вызывает провайдера. Generate и Refresh — отдельные manager-only POST-действия, способные потратить бюджет Anthropic, записать кэш обзора и audit event. Гайд их никогда не нажимает.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_AI, { timeout: 15000 });
          await h.hover(BOARD_AI);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Keşlənmiş narrative varsa, model və prompt versiyası ilə birlikdə göstərilir; exact source snapshot hash ilə əlaqələndirilir. İyirmi dörd saatdan köhnə sətir stale kimi işarələnir, lakin avtomatik yenilənmir. Narrative yoxdursa deterministic metrics qalır və sistem uydurma mətn yaratmır. AI mətni həmişə underlying source və fact-check warning ilə birlikdə nəzərdən keçirilməlidir.",
          en: "When cached narrative exists, it is attributed to a model and prompt version and tied to the exact source snapshot hash. A row older than twenty-four hours is marked stale but is not auto-refreshed. With no narrative, deterministic metrics remain and the system fabricates no text. AI prose still requires review against underlying sources and any fact-check warning.",
          ru: "Если кэшированный обзор есть, он снабжён моделью и версией prompt и связан с hash точного исходного снимка. Запись старше двадцати четырёх часов помечается stale, но не обновляется автоматически. Без обзора остаются детерминированные метрики, текст не выдумывается. AI-текст всё равно нужно сверять с источниками и предупреждениями fact-check.",
        },
        do: async (p, l, h) => {
          await h.hover(BOARD_AI);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_EVIDENCE);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Top Alerts cari scoped snapshot üzərində konfiqurasiya edilmiş qaydalardan ən yüksək prioritetli üç match-i göstərir. Severity ehtimal və ya maliyyə materiality ölçüsü deyil. Heç bir match yoxdursa mesaj yalnız qaydanın işə düşmədiyini deyir; bütün indikatorların yaşıl, məlumatın tam və ya riskin həll edildiyini iddia etmir.",
          en: "Top Alerts shows up to three highest-priority matches from configured rules evaluated on the current scoped snapshot. Severity is not probability or financial materiality. If there are no matches, the message says only that no configured rule triggered; it does not claim all indicators are green, data is complete, or risk is resolved.",
          ru: "Top Alerts показывает до трёх наиболее приоритетных совпадений настроенных правил на текущем scoped-снимке. Severity не является вероятностью или финансовой существенностью. Если совпадений нет, сообщение означает только отсутствие срабатывания правил; оно не утверждает, что все индикаторы зелёные, данные полны или риск устранён.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_ALERTS, { timeout: 15000 });
          await h.hover(BOARD_ALERTS);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_ALERTS_LIST);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Qualitative Risk Flags subsidy dependency, non-transparent structure və data absence kimi daxili classification-ları göstərir. Hər flag sabit kompozit cərimə daşıyır və scoped şirkət üzrə görünür. Bunlar Moody's, S and P, FactSet və ya auditor tərəfindən yoxlanmış xarici faktlar deyil. Boş state belə riskin araşdırıldığını sübut etmir.",
          en: "Qualitative Risk Flags surfaces internal classifications such as subsidy dependency, non-transparent structure, and data absence. Each flag carries a fixed composite penalty and is shown within company scope. These are not external facts verified by Moody's, S&P, FactSet, or an auditor. Even an empty state does not prove that the risks were investigated.",
          ru: "Qualitative Risk Flags показывает внутренние классификации: зависимость от субсидий, непрозрачную структуру и недостаток данных. Каждая метка несёт фиксированный штраф к composite и ограничена доступными компаниями. Это не внешние факты, проверенные Moody's, S&P, FactSet или аудитором. Даже пустое состояние не доказывает, что риски исследованы.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_FLAGS, { timeout: 15000 });
          await h.hover(BOARD_FLAGS);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_ALERTS);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Footer PPTX və PDF eksportu, browser print və Risk Terminal keçidini birləşdirir. Eksportlar həmin scoped snapshot və varsa cache-only narrative istifadə edir, AI yaratmır. Təhlükəsiz review ardıcıllığı: period və scope-u təsdiqləyin, coverage və gaps-i oxuyun, alert və flags mənbələrini yoxlayın, sonra səlahiyyətli paylaşma qərarı verin. Bu scene kontrolleri yalnız göstərir.",
          en: "The footer groups PPTX and PDF export, browser print, and the Risk Terminal link. Exports use this scoped snapshot and cache-only narrative when available; they never generate AI. A safe review sequence is to confirm period and scope, read coverage and gaps, inspect alert and flag sources, and only then make an authorized sharing decision. This scene only points to the controls.",
          ru: "Footer объединяет экспорт PPTX и PDF, browser print и переход в Risk Terminal. Экспорты используют этот scoped-снимок и только кэшированный обзор, если он есть; AI не генерируется. Безопасный порядок: подтвердить период и scope, изучить покрытие и пробелы, проверить источники алертов и меток и лишь затем принять уполномоченное решение о передаче. Сцена только показывает контролы.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(BOARD_FOOTER, { timeout: 15000 });
          await h.hover(BOARD_FOOTER);
          await h.holdUntil(0.55);
          await h.moveTo(BOARD_ROOT);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "ai-import": {
    route: "/budgeting/admin/ai-import",
    title: {
      az: "Məlumat idxalı — kitabdan hesabata qədər",
      en: "Data Import — from workbook to reported figures",
      ru: "Импорт данных — от книги до отчётных цифр",
    },
    scenes: [
      {
        voice: {
          az: "Bu, Məlumat idxalı ekranıdır — bütün maliyyə kitablarının sistemə girdiyi vahid nöqtə. Yuxarıdakı sətir bütün yolu bir cümlədə deyir: açıq yükləmə, sonra saxlanmış şablon və ya süni intellekt klassifikatoru, sonra adapterin ilkin baxışı, insan yoxlaması və yalnız bundan sonra ayrıca tətbiq addımı. İndi həmin yolu əvvəldən sona qədər real fayl ilə keçirik.",
          en: "This is the Data Import screen, the single point where every financial workbook enters the system. The line at the top states the whole path in one sentence: an explicit upload, then a saved template or the AI classifier, then the adapter's preview, human review, and only after that a separate apply step. We are now going to walk that path end to end with a real file.",
          ru: "Это экран импорта данных — единая точка входа для всех финансовых книг. Строка вверху описывает весь путь одной фразой: явная загрузка, затем сохранённый шаблон или ИИ-классификатор, затем предварительный разбор адаптера, проверка человеком и только после этого отдельный шаг применения. Сейчас мы пройдём этот путь целиком на реальном файле.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(AI_ROOT, { timeout: 30000 });
          await h.moveTo(AI_TITLE);
          await h.holdUntil(0.4);
          await h.hover(AI_PIPELINE);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Mavi qeyd üç fərqli riski ayırır. Səhifəyə baxmaq heç nə yazmır. Faylı seçmək brauzerdə lokal əməliyyatdır. Analiz faylın məzmununu serverə göndərir və pullu təchizatçını çağıra bilər. Tətbiq isə artıq bazaya yazır. Bunlar eyni çəkidə düymələr deyil, ona görə hər birinin qarşısında dayanıb düşünmək lazımdır.",
          en: "The blue note separates three different risks. Looking at this page writes nothing. Choosing a file is a local browser operation. Analysis sends the file's contents to the server and may call a paid provider. Apply actually writes to the database. These are not buttons of equal weight, so each one deserves a deliberate pause.",
          ru: "Синяя заметка разделяет три разных риска. Просмотр страницы не пишет ничего. Выбор файла — локальная операция в браузере. Анализ отправляет содержимое файла на сервер и может вызвать платного провайдера. Применение уже пишет в базу. Это кнопки разного веса, и перед каждой стоит осознанно остановиться.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_SAFETY);
          await h.holdUntil(0.5);
          await h.hover(AI_SAFETY);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Növbəti sual həmişə verilir: idxaldan əvvəl köhnə məlumatı silmək lazımdırmı? Cavab — xeyr. Faylı yenidən yükləmək həmin faylın əhatə etdiyi illəri və şirkətləri əvəzləyir, köhnə sətirlər isə arxivə keçir. Məlumatların silinməsi tamamilə ayrı və dağıdıcı əməliyyatdır, onu heç bir kitab geri qaytarmır. Ona görə düzəliş lazım olanda əvvəlcə sadəcə yenidən idxal edin.",
          en: "The next question always comes up: should you delete the old data first? No. Re-uploading a file replaces the years and companies that file covers, and the previous rows are archived. Deleting data is a completely separate, destructive operation that no workbook can undo. So when something needs correcting, re-import first.",
          ru: "Следующий вопрос возникает всегда: нужно ли сначала удалить старые данные? Нет. Повторная загрузка файла заменяет годы и компании, которые этот файл покрывает, а прежние строки уходят в архив. Удаление данных — совершенно отдельная разрушительная операция, которую не отменит ни одна книга. Поэтому, когда нужно что-то исправить, сначала просто импортируйте заново.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_CLEANUP);
          await h.holdUntil(0.55);
          await h.hover(AI_CLEANUP);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "İndi silməni göstərək ki, onun necə qorunduğu görünsün. Ekran addım-addım gedir: nə etmək istədiyiniz, hansı şirkət, hansı məlumat və hansı illər. Heç bir addım atlanmır və heç nə susmaqla seçilmir. Bu, təsadüfən yanlış şeyi silməyi çətinləşdirmək üçün belə qurulub.",
          en: "Now let us show a deletion, so you can see how it is guarded. The screen walks you through it: what you want to do, which company, which data and which years. No step is skipped and nothing is chosen for you by default. It is built this way to make deleting the wrong thing by accident hard.",
          ru: "Теперь покажем удаление, чтобы было видно, как оно защищено. Экран ведёт по шагам: что вы хотите сделать, какая компания, какие данные и какие годы. Ни один шаг не пропускается, и ничего не выбирается за вас по умолчанию. Так сделано, чтобы случайно удалить не то было трудно.",
        },
        do: async (p, l, h) => {
          // A <Link> to /budgeting/admin/data-archive — a GET navigation, which
          // is what safeClick is for. A plain click would hover under READONLY
          // and the page would never move.
          await h.safeClick(AI_RESET_CTA);
          await p.waitForSelector(DD_TASK_CHOOSER, { timeout: 20000 });
          await h.holdUntil(0.3);
          await h.hover(DD_TASK_CHOOSER);
          await h.holdUntil(0.5);
          // Шаг за шагом, как о том и говорит озвучка: сначала задача…
          await h.safeClick(DD_TASK_CLEAR_YEAR);
          await p.waitForSelector(DD_COMPANY_PICKER, { timeout: 20000 });
          await h.holdUntil(0.72);
          // …затем компания. Выбор раскрывает следующий шаг с годами.
          await h.safeClick(DD_COMPANY_OPTION);
          await p.waitForSelector(DD_YEAR_CHIPS, { timeout: 20000 });
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Ən vacib düymə buradadır — «Yoxla». O, heç nə silmir. O, silinəcəyin dəqiq siyahısını verir: neçə sətir, hansı illər, hansı şirkət, nəyi geri qaytarmaq mümkün olacaq və nəyi yox. Bunu oxumadan təsdiq etməyin — sistem zərəri əvvəlcədən göstərir, çünki sonra göstərmək gecdir.",
          en: "The most important button is here — Check. It deletes nothing. It hands you the exact list of what would go: how many rows, which years, which company, what could be brought back and what could not. Do not confirm without reading it — the system shows you the damage in advance, because showing it afterwards is too late.",
          ru: "Самая важная кнопка здесь — «Проверить». Она ничего не удаляет. Она отдаёт точный список того, что уйдёт: сколько строк, какие годы, какая компания, что можно будет вернуть, а что нет. Не подтверждайте, не прочитав: система показывает ущерб заранее, потому что показывать его потом уже поздно.",
        },
        do: async (p, l, h) => {
          await h.moveTo(DD_YEAR_CHIPS);
          await h.holdUntil(0.2);
          await h.safeClick(DD_YEAR_CHIP);
          await p.waitForSelector(DD_CHECK, { timeout: 20000 });
          await h.holdUntil(0.4);
          await h.mutatingClick(DD_CHECK);
          await p.waitForSelector(DD_BLAST_RADIUS, { timeout: 30000 });
          await h.holdUntil(0.6);
          await h.hover(DD_BLAST_RADIUS);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Təsdiq ayrıca addımdır və qəsdən çətindir: səbəb yazmalı, ekrandakı təsdiq kodunu əl ilə köçürməli, geri qaytarılmayan hər sətri ayrıca qəbul etməli və hazırlıq sayğacını gözləməlisiniz. Dördü də tamamlanmayana qədər düymə işləmir. Bu təlim burada dayanır və təsdiqi basmır: məqsəd qoruyucunun necə göründüyünü göstərmək, onu keçməyi öyrətmək deyil.",
          en: "Confirmation is a separate step and deliberately awkward: you type a reason, copy the confirmation code shown on screen by hand, acknowledge every irreversible line on its own, and wait out an arming countdown. Until all four are done the button stays dead. This guide stops here and does not press it: the point is to show you what the guard looks like, not to teach you through it.",
          ru: "Подтверждение — отдельный шаг, и он намеренно неудобный: нужно написать причину, вручную переписать код подтверждения с экрана, отдельно принять каждую безвозвратную строку и дождаться отсчёта готовности. Пока не выполнены все четыре условия, кнопка не работает. Этот гайд здесь останавливается и не нажимает её: задача — показать, как выглядит защита, а не провести через неё.",
        },
        do: async (p, l, h) => {
          // 2026-08-04 — сознательно НЕ подтверждаем. Кнопка заблокирована до
          // тех пор, пока не введены причина и точный код подтверждения, не
          // отмечены безвозвратные строки и не истёк отсчёт. Пройти этот
          // заслон на камеру технически можно, но тогда получится пошаговое
          // руководство по самой разрушительной операции продукта. Показываем,
          // что защита есть и из чего состоит; проходить её зритель будет сам,
          // осознанно. Решение владельца, 2026-08-04.
          await h.hover(DD_CONFIRM_STRIP);
          await h.holdUntil(0.45);
          await h.moveTo(DD_BLAST_RADIUS);
          // Возврат на экран импорта идёт ДО последнего holdUntil: навигация
          // занимает секунды, и после почти закончившейся фразы она оставила бы
          // между сценами тишину.
          await h.holdUntil(0.72);
          await p.goto(new URL("/budgeting/admin/ai-import", p.url()).href, { waitUntil: "domcontentloaded" });
          await p.waitForSelector(AI_TABS, { timeout: 20000 });
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Aşağıda dörd rejim var. Bir neçə fayl əsas iş rejimidir və ekran məhz onunla açılır: bir neçə kitabı tək qrup kimi qəbul edir, aralarındakı ziddiyyətləri göstərir və hamısını birlikdə tətbiq edir. Bir fayl rejimi yalnız təsnifat verir — diqqət edin, analizdən sonra o bazaya yazmır, bu bilərəkdən söndürülüb. İstənilən fayl və çox vərəqli rejimlər sütun uyğunlaşdırması əlavə edir. İşi isə əsas rejimdə görürük.",
          en: "There are four modes below. Multiple files is the working mode and the screen opens on it: it takes several workbooks as one group, shows the conflicts between them and applies them together. The single-file mode gives classification only — note that after analysis it does not write to the database, which is disabled on purpose. Any file and multi-sheet add column mapping. The actual work happens in the main mode.",
          ru: "Ниже четыре режима. «Несколько файлов» — основной рабочий режим, и экран открывается именно на нём: он принимает несколько книг как одну группу, показывает противоречия между ними и применяет их вместе. Режим одного файла даёт только классификацию — обратите внимание, после анализа он не пишет в базу, это отключено намеренно. «Любой файл» и «многолистовой» добавляют сопоставление колонок. Работу же делаем в основном режиме.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_TABS);
          await h.holdUntil(0.3);
          await h.safeClick(AI_TAB_SINGLE);
          await h.holdUntil(0.55);
          await h.moveTo(AI_TAB_UNIVERSAL);
          await h.hover(AI_TAB_MULTISHEET);
          await h.holdUntil(0.8);
          await h.safeClick(AI_TAB_MULTI);
          await p.waitForSelector(AI_DROP, { timeout: 15000 });
        },
      },
      {
        voice: {
          az: "İş həmişə ildən başlayır. İdxal ili açıq şəkildə seçilir və kitabın əhatə etdiyi illə üst-üstə düşməlidir; yanındakı qeyd bunu xatırladır. Yanlış il seçilsə, adapterlər bütün vərəqləri sükutla ataraq boş nəticə verə bilər. Kitabda bir neçə il varsa, hər il üçün ayrıca keçid edin: təhlükəsizlik yoxlamalarının bir hissəsi yalnız birinci ili görür.",
          en: "The work always starts with the year. The import year is chosen explicitly and has to match the year the workbook covers; the hint beside it says exactly that. If the wrong year is selected, the adapters can silently drop every sheet and commit nothing. When a workbook spans several years, run one pass per year: some of the safety checks only ever look at the first year.",
          ru: "Работа всегда начинается с года. Год импорта выбирается явно и должен совпадать с годом, который покрывает книга; подсказка рядом говорит ровно об этом. Если выбрать не тот год, адаптеры могут молча отбросить все листы и записать пустоту. Если книга охватывает несколько лет, делайте отдельный прогон на каждый год: часть проверок безопасности видит только первый год.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_YEAR);
          await h.holdUntil(0.45);
          await h.hover(AI_YEAR);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "İndi kitabı yükləmə sahəsinə veririk. Fayl siyahıda adı və ölçüsü ilə görünür; on fayla qədər seçmək və hər birini ayrıca silmək olar. Bu anda kitab hələ brauzerdən çıxmayıb: heç nə göndərilməyib, heç nə yazılmayıb. Yükləmə sahəsi faylı sadəcə yaddaşda saxlayır və analiz düyməsini aktivləşdirir.",
          en: "Now we hand the workbook to the drop zone. The file appears in the list with its name and size; up to ten files can be selected and each one removed individually. At this moment the workbook still has not left the browser: nothing has been sent and nothing written. The drop zone simply holds the file in memory and enables the analysis button.",
          ru: "Теперь отдаём книгу в зону загрузки. Файл появляется в списке с именем и размером; можно выбрать до десяти файлов и удалить каждый по отдельности. В этот момент книга ещё не покинула браузер: ничего не отправлено и ничего не записано. Зона загрузки просто держит файл в памяти и включает кнопку анализа.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_DROP);
          await h.holdUntil(0.3);
          await p.setInputFiles(AI_FILE_INPUT, importWorkbook());
          await p.waitForSelector('[data-testid="file-row-0"]', { timeout: 15000 });
          await h.holdUntil(0.6);
          await h.moveTo(AI_FILE_ROW);
          await h.hover(AI_FILE_ROW);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Yanındakı seçim pullu klassifikatoru keçməyə imkan verir: eyni quruluşlu kitab üçün əvvəl təsdiqlənmiş şablon varsa, uyğunlaşdırma yenidən istifadə olunur. İndi birinci addımı başladıram. Bu, hələ idxal deyil — ilkin baxışdır: sistem vərəqləri tanıyır, şirkətləri və hesabları uyğunlaşdırır, nəticəni ekranda göstərir və bazaya heç nə yazmır.",
          en: "The option beside it lets you skip the paid classifier: when an approved template exists for a workbook of the same shape, the mapping is reused. Now I start step one. This is not the import yet, it is a preview: the system recognizes the sheets, matches companies and accounts, shows the result on screen, and writes nothing to the database.",
          ru: "Опция рядом позволяет обойтись без платного классификатора: если для книги той же структуры есть утверждённый шаблон, сопоставление переиспользуется. Теперь запускаю первый шаг. Это ещё не импорт, а предварительный разбор: система распознаёт листы, сопоставляет компании и счета, показывает результат на экране и ничего не пишет в базу.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_TEMPLATE);
          await h.hover(AI_TEMPLATE);
          await h.holdUntil(0.5);
          await h.mutatingClick(AI_ANALYZE);
          await p.waitForSelector(
            '[data-testid="preview-result"], [data-testid="error-banner"]',
            { timeout: 240000 },
          );
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "İlkin baxış hər vərəq üçün nəyi tanıdığını və nə qədər əmin olduğunu göstərir. Yaşıl işarə yüksək etibarlılıq, kəhrəba orta, qırmızı isə aşağı deməkdir. Aşağı etibarlılıq gördükdə klassifikatora inanmayın: vərəqin adını aydınlaşdırın və ya sətirləri özünüz yoxlayın. Nəticə bəyəndiyiniz kimidirsə, onu şablon kimi saxlaya bilərsiniz — növbəti dəfə eyni kitab pullu təsnifat olmadan keçəcək.",
          en: "The preview shows what it recognized in each sheet and how confident it is. Green means high confidence, amber medium, red low. When you see low confidence, do not trust the classifier: clarify the sheet name or check the rows yourself. If the result is what you expect, you can save it as a template, and next time the same workbook passes without paid classification.",
          ru: "Предварительный разбор показывает, что распознано в каждом листе и насколько система уверена. Зелёный — высокая уверенность, янтарный — средняя, красный — низкая. Если видите низкую уверенность, не доверяйте классификатору: уточните имя листа или проверьте строки сами. Если результат такой, как вы ожидали, его можно сохранить шаблоном — и в следующий раз та же книга пройдёт без платной классификации.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_PREVIEW);
          await h.holdUntil(0.5);
          await h.hover(AI_PREVIEW);
          await h.holdUntil(0.85);
          await h.moveTo(AI_ROUTING);
        },
      },
      {
        voice: {
          az: "Aşağıda idxal diaqnostikası var. O, ilkin baxışı sizin əvəzinizə oxuyur və iki şeyi ayırır: nəyin sadəcə diqqət tələb etdiyini və nəyin tətbiqi bloklandığını. Nişanlarda hansı yoxlamanın işlədiyi və nəticənin bloklayıcı olub-olmadığı yazılır. Bir şey bloklayırsa, düzəlişi burada aparın — diaqnostika problemi gizlətmir, onu adlandırır və növbəti addımı təklif edir.",
          en: "Below sits the import diagnostics. It reads the preview for you and separates two things: what merely deserves attention and what actually blocks the apply. The badges name which check ran and whether its verdict is blocking. If something blocks, fix it here — the diagnostics never hide a problem, they name it and propose the next step.",
          ru: "Ниже находится диагностика импорта. Она читает предварительный разбор за вас и разделяет две вещи: что просто требует внимания, а что блокирует применение. На бейджах написано, какая проверка отработала и является ли её вердикт блокирующим. Если что-то блокирует, исправляйте здесь — диагностика не прячет проблему, а называет её и предлагает следующий шаг.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_DOCTOR);
          await h.holdUntil(0.5);
          await h.hover(AI_DOCTOR_STATUS);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Ayrıca şirkət aliasları paneli var. Bu, modelin öyrədilməsi deyil — sadəcə uyğunluq cədvəlidir: faylınızdakı qısaltmanı sistemdəki şirkətə bağlayır. Tam kod və son defisdən sonrakı hissə onsuz da tanınır; alias yalnız fayl başqa şey yazanda lazım olur — tam ad, kiril yazılışı və ya səhv yazılmış qısaltma. Bir dəfə yazırsınız, sonrakı bütün idxallar onu bilir.",
          en: "There is a separate company aliases panel. This is not model training, it is simply a lookup table: it binds the abbreviation used in your file to the company in the system. The full code and the part after the last hyphen are recognized anyway; an alias is only needed when the file says something else — a full name, a Cyrillic spelling, or a misspelled abbreviation. You write it once and every later import knows it.",
          ru: "Отдельно есть панель алиасов компаний. Это не обучение модели, а просто таблица соответствий: она связывает сокращение из вашего файла с компанией в системе. Полный код и часть после последнего дефиса распознаются и так; алиас нужен только когда в файле написано что-то иное — полное название, кириллическое написание или сокращение с опечаткой. Записываете один раз, и все следующие импорты его знают.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_ALIASES);
          await h.holdUntil(0.5);
          await h.hover(AI_ALIASES_BTN);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "İndi ikinci addım — qrupların tətbiqi. Məhz bu düymə bazaya yazır və yalnız ilkin baxış hazır olanda görünür. İdxal atomikdir: ya bütün qrup keçir, ya da heç nə yazılmır, buna görə yarımçıq nəticə qalmır. Yazıdan sonra sətirlər bazadan geri oxunur və fayl ilə tutuşdurulur — hər uyğunsuzluq hər şeyi geri qaytarır.",
          en: "Now step two, applying the groups. This is the button that writes to the database, and it appears only once a preview exists. The import is atomic: either the whole group goes through or nothing is written, so you are never left with a half-finished result. After the write the rows are read back from the database and compared with the file, and any mismatch rolls everything back.",
          ru: "Теперь второй шаг — применение групп. Именно эта кнопка пишет в базу, и она появляется только когда готов предварительный разбор. Импорт атомарен: либо проходит вся группа, либо не записывается ничего, поэтому недоделанного результата не остаётся. После записи строки читаются обратно из базы и сверяются с файлом — любое расхождение откатывает всё.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_APPLY);
          await h.holdUntil(0.4);
          await h.mutatingClick(AI_APPLY);
          await p.waitForSelector(
            '[data-testid="apply-result"], [data-testid="error-banner"]',
            { timeout: 300000 },
          );
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Sonda qəbz gəlir. O, ümumi «uğurlu» sözü deyil: neçə sətrin hansı şirkət və il üzrə yazıldığını, geri oxuma yoxlamasının nəticəsini və mənfəət-zərər hesabatına keçidi göstərir. Ekran bir neçə saniyədən sonra sizi oraya özü aparır, istəsəniz qalmaq da olar. Hər idxaldan sonra rəqəmləri kitabla tutuşdurun. Nəyisə səhv gedibsə, silməyə tələsməyin — düzəldilmiş faylı eyni il üçün yenidən yükləmək kifayətdir.",
          en: "At the end comes the receipt. It is not a generic success message: it shows how many rows were written for which company and year, the result of the read-back check, and a link into the profit and loss report. The screen takes you there itself after a few seconds, and you can choose to stay instead. After every import, compare the figures with the workbook. If something went wrong, do not rush to delete — re-uploading the corrected file for the same year is enough.",
          ru: "В конце приходит квитанция. Это не общее слово «успешно»: она показывает, сколько строк записано, по какой компании и году, результат обратной сверки и переход в отчёт о прибылях и убытках. Экран сам открывает его через несколько секунд, при желании можно остаться. После каждого импорта сверяйте цифры с книгой. Если что-то пошло не так, не спешите удалять — достаточно загрузить исправленный файл за тот же год заново.",
        },
        do: async (p, l, h) => {
          await h.moveTo(AI_RECEIPT);
          await h.holdUntil(0.45);
          await h.hover(AI_RECEIPT);
          await h.holdUntil(0.75);
          await h.moveTo(AI_OPEN_PNL);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "data-control": {
    route: "/budgeting/admin/companies-readiness",
    title: {
      az: "Məlumat nəzarəti",
      en: "Data control",
      ru: "Контроль данных",
    },
    scenes: [
      {
        route: "/budgeting/admin/companies-readiness",
        voice: {
          az: "Məlumat nəzarəti səkkiz ayrı admin ekranını bir iş ardıcıllığında birləşdirir. Başlanğıc nöqtəsi şirkətlərin məlumat hazırlığıdır: burada hər əməliyyat şirkətinin P&L, balans, qarşı tərəflər, əməliyyat metrikləri, strateji kontekst, hesablanmış indikatorlar və valyuta sübutu üzrə əhatəsi görünür. Bu bal qərar üçün sertifikat deyil, məlumat toplama xəritəsidir.",
          en: "Data control brings eight admin screens into one operating sequence. Start with Company Data Readiness, which maps each operating company's coverage across P&L, balance sheet, counterparties, operational metrics, strategic context, computed indicators, and evidenced currency data. This score is an onboarding map, not certification that the underlying numbers are current, reconciled, or decision-grade.",
          ru: "Группа «Контроль данных» объединяет восемь админ-экранов в одну рабочую последовательность. Начинайте с готовности компаний: здесь показано покрытие P&L, баланса, контрагентов, операционных метрик, стратегического контекста, рассчитанных индикаторов и валютных доказательств. Этот балл является картой сбора данных, а не подтверждением актуальности, сверки или пригодности цифр для решений.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_READINESS, { timeout: 15000 });
          await h.hover(DC_READINESS);
          await h.holdUntil(0.55);
          await h.moveTo(DC_READINESS_TABLE);
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/companies-readiness",
        voice: {
          az: "Cədvəldə ən aşağı hazırlıq əvvəl göstərilir. Hər səviyyə mətn və işarə ilə verilir, rəng tək məna daşımır. Sətir açılanda sahələr üzrə boşluqlar görünür, indikator boşluqları keçidi isə həmin şirkət üçün daha konkret mənbə siyahısına aparır. Balans yalnız şirkətə birbaşa bağlanmış sətirlərdən, FX isə təsdiqlənmiş baza və tam xarici valyuta sübutundan kredit alır.",
          en: "The table places the lowest-readiness companies first. Every level has text and a glyph, so colour is never the only signal. Expanding a row reveals area-level gaps, while the Indicator Backlog link leads to the specific missing sources for that company. Balance-sheet credit now requires rows directly scoped to the company, and FX credit requires one confirmed base plus complete foreign-currency evidence.",
          ru: "Таблица сначала показывает компании с самой низкой готовностью. Каждый уровень обозначен текстом и символом, поэтому цвет не является единственным сигналом. Разворот строки раскрывает пробелы по областям, а ссылка на пробелы индикаторов ведёт к конкретным источникам компании. Баланс засчитывается только по строкам этой компании, а FX только при подтверждённой базе и полном валютном доказательстве.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_READINESS_TABLE, { timeout: 15000 });
          await h.hover(DC_READINESS_TABLE);
          await h.holdUntil(0.55);
          await h.moveTo(DC_READINESS);
          await h.holdUntil(0.72);
          // Navigate under this scene's own narration. Left to the recorder's
          // between-scene step, the page load would land in the silence between
          // two takes — eight screens, eight dead pauses.
          await h.goto("/budgeting/admin/indicator-backlog");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/indicator-backlog",
        voice: {
          az: "İndikator məlumat boşluqları cari illik dövr üçün hansı tətbiq olunan indikatorlarda saxlanmış dəyər olduğunu, hansılarında mənbə çatışmadığını göstərir. Universal və sənaye indikatorları terminaldakı eyni tətbiq qaydasından keçir, şirkət üzrə açıq override isə üstün sayılır. Dövr yuxarıda görünür; bu ekran coverage göstərir, təzəlik, reconciliation və ya mənbə keyfiyyətini təsdiqləmir.",
          en: "Indicator Backlog shows, for the displayed annual period, which applicable indicators have a stored value and which still lack a required source. Universal and industry indicators use the same applicability contract as the terminal, with explicit company overrides taking precedence. The period is visible at the top; this is coverage evidence, not proof of freshness, reconciliation, or source quality.",
          ru: "Экран пробелов индикаторов показывает за указанный год, какие применимые индикаторы имеют сохранённое значение, а каким ещё нужен источник. Универсальные и отраслевые индикаторы используют тот же договор применимости, что и терминал, а явное правило компании имеет приоритет. Период показан сверху; это покрытие, а не доказательство свежести, сверки или качества источника.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_BACKLOG, { timeout: 15000 });
          await p.waitForSelector(DC_BACKLOG_PERIOD, { timeout: 15000 });
          await h.hover(DC_BACKLOG_PERIOD);
          await h.holdUntil(0.55);
          await h.moveTo(DC_BACKLOG);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/indicator-health");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/indicator-health",
        voice: {
          az: "Indicator Health başqa sualı cavablandırır: məhz göstərilən dövrdə hesablamalar hansı vəziyyətdədir və unknown hüceyrələri hansı səbəbdən yaranıb. Xülasə artıq bütün tarixçəni bir sayda qarışdırmır; period açıq görünür. Aşağıdakı kateqoriyalar external feed, ingest boşluğu, formula edge case və düzgün leaf rollup kimi səbəbləri ayırır. Inline entry və source düymələri yazır, bu təlim onlara toxunmur.",
          en: "Indicator Health answers a different question: for the displayed period, what computation states exist and why did unknown cells occur? The summary no longer mixes every historical row into one count; its period is explicit. Categories separate external feeds, ingestion gaps, formula edge cases, and valid leaf rollups. Inline entry and source actions can write or refresh data, so this guide activates none of them.",
          ru: "Indicator Health отвечает на другой вопрос: какие состояния расчётов есть именно за показанный период и почему появились неизвестные ячейки. Сводка больше не смешивает всю историю в одном числе, её период указан явно. Категории разделяют внешние источники, пробелы импорта, граничные случаи формул и корректные leaf-rollup. Inline-ввод и действия с источниками могут писать данные, поэтому гайд их не запускает.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_HEALTH, { timeout: 15000 });
          await p.waitForSelector(DC_HEALTH_PERIOD, { timeout: 15000 });
          await h.hover(DC_HEALTH_PERIOD);
          await h.holdUntil(0.55);
          await h.moveTo(DC_HEALTH);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/statement-controls");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/statement-controls",
        voice: {
          az: "Statement Controls altı kanonik arifmetik əlaqəni göstərir, lakin daimi banner onun statusunu məhdudlaşdırır: shadow, provisional və qərar üçün deyil. Lineage və təsdiqlənmiş metodologiya qapıları tamamlanmayınca burada pass və fail qərarı verilmir. Ayrıca ətraflı video bu ekranı addım-addım izah edir; qrup icmalında biz Run düyməsini basmır və heç bir nəticəni sertifikat kimi təqdim etmirik.",
          en: "Statement Controls evaluates six canonical arithmetic relationships, but its permanent banner limits the claim: shadow, provisional, and not decision-grade. Until lineage and approved methodology gates are complete, it does not certify a pass or fail. A separate detailed guide explains this screen step by step; this group overview does not press Run or present any result as assurance.",
          ru: "Statement Controls оценивает шесть канонических арифметических связей, но постоянный баннер ограничивает вывод: shadow, provisional и не для решений. Пока не завершены происхождение данных и утверждение методологии, экран не сертифицирует pass или fail. Отдельный подробный гайд разбирает его пошагово; в групповом обзоре мы не нажимаем Run и не выдаём результат за assurance.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_STATEMENT, { timeout: 15000 });
          await p.waitForSelector(DC_STATEMENT_BANNER, { timeout: 15000 });
          await h.hover(DC_STATEMENT_BANNER);
          await h.holdUntil(0.55);
          await h.moveTo(DC_STATEMENT);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/ifrs-conformance");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/ifrs-conformance",
        voice: {
          az: "IFRS Conformance idxaldan sonra IAS 1 strukturunu diaqnostika edir, audit rəyi vermir. Şirkət seçildikdə balansın ən son dövrü tapılır; yalnız həmin dövrdə tək plan müəyyən olunarsa P&L eyni plan və ayadək YTD sətirləri ilə yoxlanır. Eyni tarixdə bir neçə plan varsa ekran qarışdırmaq əvəzinə abstain edir. Yaşıl nəticə belə mənbə rəqəmlərinin düzgünlüyünü ayrıca təsdiqləmir.",
          en: "IFRS Conformance diagnoses IAS 1 structure after import; it is not an audit opinion. When a company is selected, the latest balance-sheet period is found, and P&L is checked only when one plan can be identified, using that same plan year-to-date through the balance-sheet month. Multiple plans at the same date now cause abstention instead of mixing. Even green structure does not verify source accuracy.",
          ru: "IFRS Conformance диагностирует структуру IAS 1 после импорта, но не является аудиторским заключением. После выбора компании берётся последний период баланса, а P&L проверяется только при одном определённом плане, по этому же плану YTD до месяца баланса. Несколько планов на одну дату теперь приводят к отказу от вывода, а не к смешению. Даже зелёная структура не подтверждает точность источника.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_IFRS, { timeout: 15000 });
          await h.hover(DC_IFRS);
          await h.holdUntil(0.55);
          await h.moveTo(DC_TITLE);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/compliance");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/compliance",
        voice: {
          az: "Compliance & Legal Hub idxal edilmiş audit finding və məhkəmə işlərini filtr, mənbə və statusla göstərir. Bunlar təşkilatın saxlanmış registr qeydləridir, hüquqi rəy və ya tamlıq zəmanəti deyil. Assign, deadline və comment nəzarətləri yazma əməliyyatıdır; email və CSV isə xarici çıxış yaradır. Bu READONLY icmal yalnız mövcud evidence snapshot-u göstərir və heç bir düyməni aktivləşdirmir.",
          en: "Compliance and Legal Hub presents imported audit findings and court cases with filters, source, and status. These are stored register records, not legal advice or a guarantee that the register is complete. Assign, deadline, and comment controls write data, while email and CSV create external output. This read-only overview shows only the existing evidence snapshot and activates none of those controls.",
          ru: "Compliance and Legal Hub показывает импортированные аудиторские замечания и судебные дела с фильтрами, источником и статусом. Это сохранённые записи реестра, а не юридическое заключение и не гарантия полноты. Assign, deadline и comment записывают данные, а email и CSV создают внешний вывод. READONLY-обзор показывает только текущий снимок доказательств и ничего не запускает.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_COMPLIANCE, { timeout: 15000 });
          await h.hover(DC_COMPLIANCE);
          await h.holdUntil(0.55);
          await h.moveTo(DC_TITLE);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/drift");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/drift",
        voice: {
          az: "Drift Dashboard üç əməliyyat siqnalını ayırır: reference feed təzəliyi, son reconciliation drift hadisələri və dayanan onboarding. Təzəlik kartındakı yaş yalnız mənbənin son uğurlu müşahidəsindən keçən vaxtdır; o, məzmunun iqtisadi cəhətdən doğru olduğunu sübut etmir. Yuxarıdakı Refresh sadəcə hesabatı GET ilə yeniləyir, kartlardakı Refresh now isə provider işi və yazı başlada bilər, ona görə toxunulmur.",
          en: "Drift Dashboard separates three operational signals: reference-feed freshness, recent reconciliation drift events, and stalled onboarding. Age on a freshness card means time since the last successful observation; it does not prove that the content is economically correct. The top Refresh only reloads the report by GET, while card-level Refresh now can start provider work and writes, so this guide never clicks it.",
          ru: "Drift Dashboard разделяет три операционных сигнала: свежесть справочных источников, недавние события reconciliation drift и остановленный onboarding. Возраст на карточке означает время после последнего успешного наблюдения, но не доказывает экономическую корректность содержания. Верхний Refresh лишь перечитывает отчёт через GET, а Refresh now на карточках может запустить provider и запись, поэтому гайд его не нажимает.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_DRIFT, { timeout: 15000 });
          await p.waitForSelector(DC_DRIFT_FRESHNESS, { timeout: 15000 });
          await h.hover(DC_DRIFT_FRESHNESS);
          await h.holdUntil(0.55);
          await h.moveTo(DC_DRIFT);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/intel-health");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/intel-health",
        voice: {
          az: "Intel Health crawler müşahidəsini göstərir: sağlamlıq statusu, son işləmə, çıxış dili, son otuz gündə element sayı, yeddi günlük paylanma və mənbə qarışığı. Bu ekran xəbərin həqiqiliyini və sentiment nəticəsinin qərar üçün yararlı olduğunu təsdiqləmir; yalnız ingestion prosesinin nə etdiyini göstərir. Boş və ya stale status zamanı terminalda xəbər sübutu olmadığını dürüst qəbul etmək lazımdır.",
          en: "Intel Health observes the crawler itself: health status, last run, output language, items over thirty days, seven-day distribution, and source mix. It does not certify that an article is true or that sentiment is decision-grade; it shows what the ingestion process actually produced. An empty or stale status means the terminal must treat news evidence as absent or old, not silently healthy.",
          ru: "Intel Health наблюдает за самим crawler: статус, последний запуск, язык результата, число материалов за тридцать дней, распределение по семи дням и набор источников. Он не подтверждает истинность статьи и пригодность sentiment для решений, а показывает фактический результат ingestion. Пустой или stale статус означает, что терминал должен считать новостное доказательство отсутствующим или старым, а не здоровым.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_INTEL, { timeout: 15000 });
          await p.waitForSelector(DC_INTEL_SUMMARY, { timeout: 15000 });
          await h.hover(DC_INTEL_SUMMARY);
          await h.holdUntil(0.55);
          await h.moveTo(DC_INTEL);
          await h.holdUntil(0.72);
          await h.goto("/budgeting/admin/companies-readiness");
          await h.holdUntil(0.92);
        },
      },
      {
        route: "/budgeting/admin/companies-readiness",
        voice: {
          az: "Praktik ardıcıllıq belədir: əvvəl şirkət readiness ilə geniş boşluğu tapın, sonra Backlog-da konkret mənbə və sahibini görün, Indicator Health-də dövr üzrə hesablama səbəbini yoxlayın, Statement və IFRS kontrollarında əlaqələri araşdırın, Compliance, Drift və Intel ilə sübutun vəziyyətini tamamlayın. Yalnız bundan sonra write, refresh, email və ya AI addımına səlahiyyət və niyyətlə keçin.",
          en: "The practical sequence is: find the broad company gap in Readiness, identify the exact source and owner in Backlog, inspect the period-specific computation reason in Indicator Health, examine relationships in Statement and IFRS controls, then complete the evidence picture with Compliance, Drift, and Intel. Only after that should an authorized user choose a write, refresh, email, or AI action with explicit intent.",
          ru: "Практическая последовательность такая: найти общий пробел компании в Readiness, определить точный источник и владельца в Backlog, проверить причину расчёта за период в Indicator Health, изучить связи в Statement и IFRS controls, затем дополнить картину через Compliance, Drift и Intel. Только после этого уполномоченный пользователь явно выбирает запись, refresh, email или AI-действие.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(DC_READINESS, { timeout: 15000 });
          await h.hover(DC_READINESS);
          await h.holdUntil(0.55);
          await h.moveTo(DC_TITLE);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  "statement-controls": {
    route: "/budgeting/admin/statement-controls",
    title: {
      az: "Hesabat kontrolları (kölgə rejimi)",
      en: "Statement controls (shadow)",
      ru: "Контроли отчётности (теневой режим)",
    },
    scenes: [
      // 1 — What the section IS + WHY (honest data-health X-ray).
      {
        voice: {
          az: "Bu — «Hesabat kontrolları» bölməsidir: şirkətin idxal edilmiş maliyyə hesabatlarının məlumat sağlamlığını göstərən dürüst rentgendir. Hər hansı rəqəmi qərar üçün yararlı saymadan əvvəl bu ekran altı arifmetik yoxlama aparır və altdakı məlumatların nəyi təsdiqlədiyini, nəyi isə təsdiqləmədiyini dəqiq göstərir. Bu, xam idxal ilə real qərar arasında dayanan həqiqət qatıdır.",
          en: "This is Statement Controls — an honest data-health X-ray of a company's imported financial statements. Before any figure is treated as decision-grade, this screen runs six arithmetic checks and shows you exactly what the underlying data can, and cannot, support. It is the truth layer that sits between raw imports and any decision you make.",
          ru: "Это «Контроли отчётности» — честный рентген качества импортированных финансовых отчётов компании. Прежде чем считать хоть одну цифру пригодной для решений, этот экран запускает шесть арифметических проверок и показывает, что данные действительно подтверждают, а что нет. Это слой правды между сырым импортом и любым вашим решением.",
        },
        do: async (p, l, h) => {
          await h.moveTo(TITLE);
          await h.holdUntil(0.45);
          await h.hover(BANNER);
          await h.holdUntil(0.92);
        },
      },
      // 2 — The permanent SHADOW/PROVISIONAL banner: why no pass/fail yet.
      {
        voice: {
          az: "Diqqət edin — daimi bannerə: kölgə, ilkin, qərar üçün deyil. Burada heç nə «keçdi» və ya «keçmədi» kimi işarələnmir və rənglər qəsdən neytral qalır. Sabitlənmiş siyasətə görə rəqəmlər yalnız ilkin, bir dövr geridədir və hesabatın heç bir sətri hələ mənbə izini daşımır — buna görə də nəticəni təsdiqləmək dürüst olmazdı.",
          en: "Notice the permanent banner: shadow, provisional, not decision-grade. Nothing here shows a pass or a fail, and the colours stay neutral on purpose. Under the pinned policy the figures are only T-minus-one provisional, and no statement row yet carries lineage, so certifying a result would be dishonest.",
          ru: "Обратите внимание на постоянный баннер: теневой, предварительный, не для решений. Здесь ничего не помечается как «пройдено» или «не пройдено», и цвета намеренно остаются нейтральными. По закреплённой политике цифры лишь предварительные, с задержкой в один период, а ни одна строка отчёта пока не несёт происхождения данных — поэтому выносить вердикт было бы нечестно.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BANNER);
          await h.holdUntil(0.5);
          await h.hover(BANNER_DETAIL);
          await h.holdUntil(0.92);
        },
      },
      // 3 — Pick the company (AZSEKER / AZSF) from the selector.
      {
        voice: {
          az: "Gəlin işə salaq. Şirkət seçimindən AZSEKER-i seçirəm — kodu A-Z-S-F. Kontrollar həmişə bir şirkətin öz idxal olunmuş hesabatları üzərində işləyir, ona görə də indi görəcəyiniz hər rəqəm həmin qurumun real məlumatıdır, heç nə simulyasiya deyil.",
          en: "Let's put it to work. From the company selector I choose AZSEKER — code A-Z-S-F. The controls always run against one company's own imported statements, so every number you're about to see is real data from that entity, nothing simulated.",
          ru: "Запустим на практике. В выборе компании я беру AZSEKER — код A-Z-S-F. Контроли всегда работают с собственными импортированными отчётами одной компании, поэтому все цифры, которые вы сейчас увидите, — это реальные данные этой организации, ничего смоделированного.",
        },
        do: async (p, l, h) => {
          await h.holdUntil(0.28);
          await selectCompany(p, h);
          await h.holdUntil(0.6);
          await h.moveTo(PERIOD_INPUT);
          await p.fill(PERIOD_INPUT, DEMO_PERIOD).catch(() => {});
          await h.holdUntil(0.85);
          await h.moveTo(RUN_BTN);
          await h.holdUntil(0.92);
        },
      },
      // 4 — Run the six controls on real statement data.
      {
        voice: {
          az: "İndi «Kontrolları işə sal» düyməsini basıram. Bir keçiddə mühərrik altı kanonik yoxlamanı hesablayır — balans, pul axını cəmi, pulun balansla əlaqəsi, bölüşdürülməmiş mənfəət, xalis mənfəət əlaqəsi və xarici valyuta çevrilməsi — hər biri seçilmiş dövr üçün şirkətin real hesabat sətirləri üzərində.",
          en: "Now I press Run controls. In one pass the engine evaluates all six canonical checks — balance sheet, cash-flow sum, cash to balance sheet, retained earnings, net-income link and foreign-currency translation — each against the company's actual statement rows for the selected period.",
          ru: "Теперь нажимаю «Запустить контроли». За один проход движок вычисляет все шесть канонических проверок — баланс, сумму денежных потоков, связь денег с балансом, нераспределённую прибыль, связь чистой прибыли и валютный пересчёт — каждую по реальным строкам отчётов компании за выбранный период.",
        },
        do: async (p, l, h) => {
          await h.moveTo(RUN_BTN);
          // Клик у самого начала фразы: расчёт контролей занимает ~16 с, и всё
          // это время должно идти ПОД озвучку. При клике на 40% фразы её
          // остатка не хватало и между сценами оставалась пауза 4.4 с.
          await h.holdUntil(0.12);
          await h.safeClick(RUN_BTN);
          // Ожидание идёт СРАЗУ за кликом: расчёт занимает больше времени, чем
          // остаток фразы, и если ждать после holdUntil(0.92), сцена
          // переваливает за свою озвучку и между сценами возникает тишина.
          // Поймано проверкой silencedetect: пауза 13.9 с на 87-й секунде.
          await p.waitForSelector(RESULT, { timeout: 15000 }).catch(() => {});
          await h.holdUntil(0.92);
        },
      },
      // 5 — The balance-sheet card: delta, tolerance, source rows.
      {
        voice: {
          az: "Balans kontrolunu götürək. O, təsdiqlənmiş baza vahidi olduqda işarəli fərqi, əks halda vahidin əlçatmaz olduğunu, müqayisə dözümlülüyünü və hər tərəfdəki mənbə sətirlərinin sayını göstərir. Beləcə siz yalnız fərqi deyil, onu yaradan məlumatın həcmini və balansların necə oxunduğunu bildirən işarə konvensiyasını görürsünüz.",
          en: "Take the balance-sheet control. It shows the signed delta in the confirmed base unit when one is available, otherwise the unit stays unavailable, alongside the comparison tolerance and the source-row counts behind each side. You see the gap, its evidence volume, and the sign convention used to read the balances.",
          ru: "Возьмём контроль баланса. Он показывает знаковую разницу в подтверждённой базовой единице, если она доступна; иначе единица остаётся неизвестной. Рядом указаны допуск и число исходных строк с каждой стороны, поэтому видны само расхождение, объём его доказательств и соглашение о знаках.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(RESULT, { timeout: 12000 }).catch(() => {});
          await h.moveTo(CARD_BS);
          await h.holdUntil(0.5);
          await h.hover(CARD_BS);
          await h.holdUntil(0.92);
        },
      },
      // 6 — The sign-convention / residuals disclosure line.
      {
        voice: {
          az: "Bu açıqlama sətrini gözdən qaçırmaq asandır, amma vacibdir: o, aşkarlanmış işarə konvensiyasını — sınaq balansı və ya təbii — adlandırır və hər iki qalığı yan-yana yazır. Beləcə kontrol xam cəmlərin hər hansı müqayisədən əvvəl necə şərh olunduğu barədə dürüst qalır.",
          en: "This disclosure line is easy to miss but important: it names the detected sign convention — trial-balance or natural — and prints both residuals side by side. That's how the control stays honest about how the raw sums were interpreted before any comparison was made.",
          ru: "Эту строку раскрытия легко пропустить, но она важна: она называет обнаруженное соглашение о знаках — пробный баланс или естественное — и печатает оба остатка рядом. Так контроль остаётся честным в том, как именно были истолкованы исходные суммы до любого сравнения.",
        },
        do: async (p, l, h) => {
          await h.moveTo(SIGN_CONV);
          await h.holdUntil(0.5);
          await h.hover(SIGN_CONV);
          await h.holdUntil(0.92);
        },
      },
      // 7 — A blocked card (cash_flow_sum) + its missing-evidence list.
      {
        voice: {
          az: "İndi bloklanmış kart pul axını cəmidir. Onun nə «keçdi», nə də «keçmədi» statusu var, çünki seçilmiş məlumat sahəsi və dövr üçün puldakı xalis dəyişiklik ayrıca mənbə sətri ilə təsdiqlənməyib. Aşağıdakı komponent siyahısı bu girişi çatışmayan kimi göstərir. Kart sınıq deyil; sübut olmadıqda təxmin etməkdən imtina edir.",
          en: "Now consider the blocked cash-flow-sum card. It carries no pass or fail because net change in cash is not evidenced by a separate source line for this selected scope and period. The component list below marks that input as missing. The card is not broken; it refuses to guess when evidence is absent.",
          ru: "Теперь рассмотрим заблокированную карточку суммы денежных потоков. У неё нет статуса «пройдено» или «не пройдено»: для выбранной области данных и периода чистое изменение денежных средств не подтверждено отдельной исходной строкой. Список компонентов помечает этот вход как отсутствующий. Карточка не сломана; без доказательств она отказывается угадывать.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CARD_CFS);
          await h.holdUntil(0.35);
          await h.hover(CARD_CFS);
          await h.holdUntil(0.68);
          await h.moveTo(CFS_REASON);
          await h.holdUntil(0.92);
        },
      },
      // 8 — net_income_link / fx_translation card + fx rate-dates staleness line.
      {
        voice: {
          az: "Xalis mənfəət əlaqəsi və valyuta çevrilməsi kartları daha da irəli gedir. Çevrilmə kontrolu hər xarici valyuta üçün bir dəfə işləyir və müstəqil məzənnə tarix aralığını, üstəgəl köhnəlmiş, keçirilmiş sətirlərin sayını yazır — beləcə məzənnələrdəki hər hansı köhnəlmə birbaşa sizə açıqlanır, cəmin içində gizlənmir.",
          en: "The net-income link and the currency-translation cards go further. The translation control runs once per foreign currency and prints the independent rate-date range with a count of stale, carried-forward rows — so any staleness in the exchange rates is disclosed to you directly, not hidden inside the total.",
          ru: "Карточки связи чистой прибыли и валютного пересчёта идут дальше. Контроль пересчёта выполняется для каждой иностранной валюты и печатает диапазон дат независимого курса вместе с числом устаревших, перенесённых строк — так любая устарелость курсов раскрывается вам напрямую, а не прячется внутри итога.",
        },
        do: async (p, l, h) => {
          await h.moveTo(CARD_NI);
          await h.holdUntil(0.35);
          await h.hover(CARD_FX);
          await h.holdUntil(0.68);
          await h.moveTo(FX_DATES);
          await h.holdUntil(0.92);
        },
      },
      // 9 — The explainer footer + its concrete limitations.
      {
        voice: {
          az: "Nəhayət, aşağıdakı izahat bloku burada hələ heç nəyin niyə «keçə» və ya «keçməyə» bilmədiyini açıqlayır və bu mövqeyin arxasındakı konkret məhdudiyyətləri sadalayır. Onu bir dəfə oxuyun — bütün ekran aydınlaşır: o, qəsdən ehtiyatlıdır və bu məlumatın bu gün nəyi sübut edə biləcəyinin tavanını göstərir.",
          en: "Finally the explainer footer spells out why nothing here can pass or fail yet, and lists the concrete limitations behind that stance. Read it once and the whole screen makes sense: it is deliberately conservative, telling you the ceiling of what this data can prove today.",
          ru: "Наконец, пояснительный блок внизу объясняет, почему здесь пока ничто не может быть «пройдено» или «не пройдено», и перечисляет конкретные ограничения за этой позицией. Прочитайте его один раз — и весь экран становится понятен: он намеренно консервативен и показывает потолок того, что эти данные способны доказать сегодня.",
        },
        do: async (p, l, h) => {
          await h.moveTo(WHY);
          await h.holdUntil(0.5);
          await h.hover(WHY);
          await h.holdUntil(0.92);
        },
      },
      // 10 — Wrap on the banner: the section's honest promise.
      {
        voice: {
          az: "Beləliklə, «Hesabat kontrolları» budur: hökm yox, şəffaf sübut qatı. O, arifmetikanı göstərir, çatışmayanı adlandırır və real mənbə izi gələnə qədər ilkin qalır — beləcə bir rəqəm nəhayət qərar üçün yararlı olduqda, siz onun buna layiq olduğunu biləcəksiniz.",
          en: "So that's Statement Controls: not a verdict, but a transparent evidence layer. It shows the arithmetic, names what's missing, and stays provisional until real lineage arrives — so when a number finally does become decision-grade, you'll know it earned it.",
          ru: "Вот что такое «Контроли отчётности»: не приговор, а прозрачный слой доказательств. Он показывает арифметику, называет то, чего не хватает, и остаётся предварительным, пока не появится настоящее происхождение данных — чтобы, когда цифра наконец станет пригодной для решений, вы знали, что она это заслужила.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BANNER);
          await h.holdUntil(0.5);
          await h.hover(WHY);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
  // ── Indicator backlog (İndikator məlumat boşluqları) ──────────────────────
  // READONLY-safe by construction: every control on this page is client state.
  // The owner chips and the hide-complete toggle only re-filter an already
  // rendered list; the page itself issues a single GET. The three buttons on an
  // entity card are deliberately NEVER clicked — CSV builds a local blob (a
  // silent download, nothing to see), "write to owners" opens a mailto: in a new
  // tab and would wreck the take, and "upload file" navigates away to AI Import.
  // The narration explains all three instead.
  "indicator-backlog": {
    route: "/budgeting/admin/indicator-backlog",
    title: {
      az: "İndikator məlumat boşluqları",
      en: "Indicator data gaps",
      ru: "Пробелы в данных по индикаторам",
    },
    scenes: [
      {
        voice: {
          az: "Bu ekran bir suala cavab verir: holdinqin risk mənzərəsini qurmaq üçün hansı məlumat çatışmır və onu kim verməlidir. Yuxarıdakı qeyd sərhədi dəqiq göstərir: burada yalnız saxlanmış dəyərlərin əhatəsi var. Bu, məlumatın təzə, üzləşdirilmiş və ya keyfiyyətli olduğunu təsdiqləmir — sadəcə deyir ki, dəyər var, yoxsa yoxdur.",
          en: "This screen answers one question: which data is missing before the holding's risk picture can be built, and who is supposed to supply it. The note at the top states the boundary precisely — what you see here is the coverage of stored values only. It is not a claim that the data is fresh, reconciled or good quality; it only says a value exists, or it does not.",
          ru: "Этот экран отвечает на один вопрос: каких данных не хватает, чтобы собрать картину рисков холдинга, и кто должен их предоставить. Заметка вверху точно очерчивает границу: здесь показан только охват сохранённых значений. Это не подтверждение того, что данные свежие, сверенные или качественные, — лишь факт, что значение есть или его нет.",
        },
        do: async (p, l, h) => {
          await p.waitForSelector(IB_PERIOD, { timeout: 30000 });
          await h.moveTo(IB_TITLE);
          await h.holdUntil(0.45);
          await h.hover(IB_PERIOD);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Beş rəqəm bütün mənzərəni verir. Neçə aktiv törəmə şirkət nəzərə alınır, onlara cəmi neçə indikator tətbiq olunur, neçəsinin saxlanmış dəyəri var, neçəsi mənbə məlumatını gözləyir və nəticədə holdinqin hazırlığı faizlə. Altdakı zolaq həmin nisbəti göz üçün çəkir: qırmızı hissə hələ bağlanmamış boşluqdur.",
          en: "Five numbers give the whole picture: how many active subsidiaries are counted, how many indicators apply to them in total, how many already have a stored value, how many are still waiting for source data, and the resulting holding readiness as a percentage. The bar underneath draws that same ratio, so the red part is simply the gap that is still open.",
          ru: "Пять чисел дают всю картину: сколько активных дочерних компаний учтено, сколько индикаторов к ним применимо, у скольких уже есть сохранённое значение, сколько ждут данных от источника и какая в итоге готовность холдинга в процентах. Полоса под ними рисует то же соотношение: красная часть — это ещё не закрытый пробел.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_KPI_ENTITIES);
          await h.holdUntil(0.25);
          await h.hover(IB_KPI_APPLICABLE);
          await h.holdUntil(0.45);
          await h.hover(IB_KPI_PRESENT);
          await h.holdUntil(0.6);
          await h.hover(IB_KPI_MISSING);
          await h.holdUntil(0.78);
          await h.moveTo(IB_KPI_READINESS);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "İkinci rəqəmə diqqət edin: bu, sistemdəki bütün indikatorların kataloqu deyil. Burada yalnız həmin şirkətlərə bu gün tətbiq olunanlar sayılır — sahəyə, fəaliyyət növünə və şirkətin konfiqurasiyasına görə. Ona görə şirkət əlavə ediləndə və ya sahə dəyişəndə məxrəc də dəyişir, və faizi müxtəlif dövrlər arasında kor-koranə müqayisə etmək olmaz.",
          en: "Look closely at the second number: it is not a catalogue of every indicator in the system. It counts only those that apply to these companies today, by industry, activity and each company's configuration. So the denominator moves when a company is added or an industry changes, which means the percentage cannot be compared blindly across different periods.",
          ru: "Присмотритесь ко второму числу: это не каталог всех индикаторов системы. Здесь считаются только те, что применимы к этим компаниям сегодня — по отрасли, виду деятельности и настройке самой компании. Поэтому знаменатель меняется, когда добавляют компанию или меняют отрасль, и процент нельзя вслепую сравнивать между разными периодами.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_KPI_APPLICABLE);
          await h.holdUntil(0.5);
          await h.hover(IB_KPI_APPLICABLE);
          await h.holdUntil(0.85);
          await h.moveTo(IB_PROGRESS);
        },
      },
      {
        voice: {
          az: "Aşağıda boşluqlar məlumat sahibinə görə qruplaşdırılır — yəni siyahı dərhal tapşırıq növbəsinə çevrilir. Kəsik sarı haşiyəli nişana diqqət edin: orada məsul şəxsi ümumiyyətlə təyin edilməmiş boşluqlar sayılır. Bu, birinci işdir: sahibi olmayan boşluq heç kimin gündəliyində deyil və öz-özünə bağlanmayacaq. İndi həmin nişana basıram.",
          en: "Below, the gaps are grouped by data owner, which turns the list straight into a work queue. Notice the chip with the dashed amber outline: it counts the gaps with no responsible person assigned at all. That is job number one — a gap with no owner is on nobody's agenda and will not close by itself. I am clicking that chip now.",
          ru: "Ниже пробелы сгруппированы по владельцу данных — и список сразу превращается в очередь задач. Обратите внимание на чип с пунктирной янтарной рамкой: в нём считаются пробелы, у которых вообще не назначен ответственный. Это задача номер один: пробел без владельца не стоит ни у кого в плане и сам не закроется. Нажимаю на этот чип.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_BY_OWNER);
          await h.holdUntil(0.4);
          await h.hover(IB_OWNER_UNKNOWN);
          await h.holdUntil(0.62);
          await h.safeClick(IB_OWNER_UNKNOWN);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Sağdakı sayğac filtrdən sonra neçə şirkətin qaldığını göstərir. Diqqət edin: burada rəqəm dəyişmir, dördü də yerində qalır. Bu, filtrin işləmədiyi demək deyil — əksinə, cavabdır: sahibi təyin olunmamış boşluqlar hər dörd şirkətdə var. Tam hazır şirkətləri gizlədəndə də siyahı azalmır, çünki hələ heç biri yüz faizə çatmayıb.",
          en: "The counter on the right shows how many companies are left after filtering. Watch it closely: the number does not move, all four stay. That is not a broken filter — it is the answer. Gaps with no assigned owner exist in every one of the four companies. Hiding the fully ready ones changes nothing either, because not a single company has reached a hundred percent yet.",
          ru: "Счётчик справа показывает, сколько компаний осталось после фильтра. Присмотритесь: число не меняется, все четыре на месте. Это не сломанный фильтр, а ответ: пробелы без назначенного владельца есть у всех четырёх компаний. Скрытие полностью готовых тоже ничего не убирает — ни одна компания пока не дошла до ста процентов.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_FILTERS);
          await h.holdUntil(0.35);
          await h.hover(IB_SHOWN_COUNT);
          await h.holdUntil(0.55);
          await h.safeClick(IB_HIDE_COMPLETE);
          await h.holdUntil(0.78);
          await h.safeClick(IB_HIDE_COMPLETE);
          await h.safeClick(IB_OWNER_UNKNOWN);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Filtrlərdən sonra iş vahidi şirkət kartıdır. Başlıqda kodu, adı və sahə nişanı var, yanında isə üç rəqəm: neçə indikator saxlanılıb, neçəsi çatışmır və əhatə faizi. Altdakı zolaq eyni nisbəti təkrarlayır. Beləcə hansı şirkətin ən çox geridə qaldığını siyahını oxumadan, bir baxışla görmək olur.",
          en: "Once filtered, the unit of work is the company card. Its header carries the code, the name and an industry badge, and beside them three numbers: how many indicators are stored, how many are missing and the resulting coverage. The bar underneath repeats that ratio, so you can see at a glance which company is furthest behind without reading a single row.",
          ru: "После фильтров единица работы — карточка компании. В её шапке код, название и отраслевой бейдж, а рядом три числа: сколько индикаторов сохранено, сколько отсутствует и какой в итоге охват. Полоса под ними повторяет то же соотношение, поэтому видно с первого взгляда, какая компания отстаёт сильнее всех, не читая ни одной строки.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_ENTITY_CARD);
          await h.holdUntil(0.45);
          await h.hover(IB_ENTITY_SUMMARY);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Kartın içi iki sütuna bölünür. Solda artıq dəyəri olan indikatorlar var — bu, artıq bağlanmış hissədir. Sağda isə çatışmayanlar, və bu sütun daha vacibdir: hər sətir yanında hansı məlumatın tələb olunduğunu və kimin cavabdeh olduğunu yazır. Yəni sual «nə yoxdur» deyil, «kimdən nəyi istəmək lazımdır» şəklində qoyulur.",
          en: "Inside, the card splits into two columns. On the left are the indicators that already have a value — the part that is closed. On the right are the missing ones, and that column matters more: each row names the input that is required and who is accountable for it. The question stops being what is missing and becomes what to ask, and from whom.",
          ru: "Внутри карточка делится на две колонки. Слева индикаторы, у которых значение уже есть, — это закрытая часть. Справа отсутствующие, и эта колонка важнее: в каждой строке указано, какие данные требуются и кто за них отвечает. Вопрос перестаёт быть «чего нет» и становится «что и у кого запросить».",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_ENTITY_PRESENT);
          await h.holdUntil(0.4);
          await h.hover(IB_ENTITY_MISSING);
          await h.holdUntil(0.9);
        },
      },
      {
        voice: {
          az: "Kartın sağ küncündə üç düymə var və hər biri fərqli iş görür. CSV çatışmayanların siyahısını fayl kimi endirir — sorğunu məktuba əlavə etmək üçün. İkincisi hazır məktub şablonlarını açır, hər məlumat sahibinə ayrıca. Üçüncüsü isə həmin şirkət seçilmiş halda AI avtomatik idxala aparır. Bu təlimdə heç birinə basmıram: ikincisi poçt proqramını açır, üçüncüsü isə səhifədən çıxarır.",
          en: "Three buttons sit in the card's corner and each does something different. CSV downloads the list of missing items as a file, so the request can be attached to a message. The second opens prepared e-mail drafts, one per data owner. The third takes you into AI Auto Import with that company already selected. This guide presses none of them: the second opens your mail client and the third leaves the page.",
          ru: "В углу карточки три кнопки, и каждая делает своё. CSV выгружает список отсутствующего файлом, чтобы приложить запрос к письму. Вторая открывает готовые черновики писем — по одному на каждого владельца данных. Третья ведёт в AI автоматический импорт с уже выбранной компанией. В этом гайде я не нажимаю ни одну: вторая откроет почтовую программу, а третья уведёт со страницы.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_ENTITY_ACTIONS);
          await h.holdUntil(0.35);
          await h.hover(IB_CSV);
          await h.holdUntil(0.58);
          await h.hover(IB_EMAIL);
          await h.holdUntil(0.8);
          await h.moveTo(IB_UPLOAD);
          await h.holdUntil(0.92);
        },
      },
      {
        voice: {
          az: "Ardıcıllıq belədir: əvvəl dövrü yoxlayın, sonra sahibi naməlum boşluqları götürün, filtrlə diqqəti daraldın, ən aşağı əhatəli şirkəti seçin və məlumatı ya məktubla istəyin, ya da faylı idxal edin. Uğurlu idxal uyğun boşluqları avtomatik bağlayır və faiz özü qalxır. Və sonda sərhədi unutmayın: bu rəqəm əhatəni ölçür, məlumatın keyfiyyətini yox.",
          en: "The working order is this: check the period first, then take the gaps with an unknown owner, narrow the view with filters, pick the company with the lowest coverage, and either request the data by e-mail or import the file. A successful import closes the matching gaps automatically and the percentage rises on its own. And remember the boundary at the end: this number measures coverage, not the quality of the data.",
          ru: "Рабочий порядок такой: сначала проверьте период, затем возьмите пробелы с неизвестным владельцем, сузьте фильтрами, выберите компанию с наименьшим охватом и либо запросите данные письмом, либо импортируйте файл. Успешный импорт закрывает соответствующие пробелы сам, и процент поднимается без ручной правки. И помните про границу: это число измеряет охват, а не качество данных.",
        },
        do: async (p, l, h) => {
          await h.moveTo(IB_KPI_READINESS);
          await h.holdUntil(0.5);
          await h.hover(IB_PROGRESS);
          await h.holdUntil(0.92);
        },
      },
    ],
  },
};

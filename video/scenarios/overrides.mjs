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
      const hit = opts.find((o) => /azseker|azsf/i.test(o.textContent || "")) || opts[0];
      return hit ? hit.value : "";
    })
    .catch(() => "");
  if (value) {
    const sel = await h.firstLocator(COMPANY_SELECT);
    await sel?.selectOption(value).catch(() => {});
  }
  await h.sleep(400);
};

export default {
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
          await h.hover(WS_PLAN);
          await h.moveTo(WS_COMPANY);
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
          await h.hover(WS_CONTEXT);
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
          await h.hover(WS_COGS);
          await h.hover(WS_EXPENSES);
          await h.moveTo(WS_PROFIT);
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
          await h.hover(WS_WATERFALL);
          await h.moveTo(WS_GAUGE);
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
          await h.hover(WS_CATEGORY_BARS);
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
          await h.safeClick(WS_MATERIAL);
          await h.hover(WS_CONTROLS);
        },
      },
      {
        voice: {
          az: "Siyahıdan Matris görünüşünə keçid yalnız ekrandakı təqdimatı dəyişir. Matris sazlanıbsa, plan şöbə ilə xərc növünün kəsişməsində görünür. Sazlanmayıbsa, ekran bunu açıq bildirir və ayrıca yaratma düyməsi göstərir. Bu təlimdə həmin düyməyə toxunmuruq: yalnız görünüşü yoxlayır, sətir yaratmır, məbləği dəyişmir və təsdiq prosesi başlatmırıq.",
          en: "Switching from List to Matrix changes only the on-screen presentation. When a matrix is configured, it places the plan at the intersection of department and cost type. When it is not configured, the page says so and offers a separate Generate action. This guide does not press that action: it only inspects the view and creates no line, amount change or approval workflow.",
          ru: "Переключение со Списка на Матрицу меняет только представление на экране. Если матрица настроена, план раскладывается по подразделениям и типам затрат. Если она не настроена, экран прямо сообщает об этом и отдельно предлагает создание. В этом гайде мы не нажимаем эту кнопку: только проверяем вид, не создаём строки, не меняем суммы и не запускаем согласование.",
        },
        do: async (p, l, h) => {
          await h.safeClick(WS_MATRIX_BUTTON);
          await p.waitForSelector('[data-testid="workspace-matrix"]', { timeout: 8000 });
          await h.moveTo(WS_MATRIX);
        },
      },
      {
        voice: {
          az: "Siyahıya qayıdanda əsas P&L cədvəli görünür. Gəlir, maya dəyəri və əməliyyat xərcləri ayrıca bölmələrdir; onların arasında ümumi mənfəət və əməliyyat mənfəəti kanonik düsturlarla hesablanır. Hər bölmədə plan, fakt və faiz fərqi yanaşıdır. Beləcə rəhbər xülasədən konkret hesab sətrinə qədər eyni məntiqi izləyir.",
          en: "Back in List view, the main P&L table becomes the audit trail. Revenue, COGS and operating expenses are separate sections, with gross profit and operating profit calculated between them using the canonical formulas. Plan, actual and percentage variance sit side by side, so management can move from the summary to a specific account line without changing logic.",
          ru: "После возврата в Список главная P&L-таблица становится дорожкой разбора. Выручка, себестоимость и операционные расходы разделены, а между ними по каноническим формулам рассчитаны валовая и операционная прибыль. План, факт и процент отклонения стоят рядом, поэтому от сводки можно перейти к конкретной строке счёта без смены логики.",
        },
        do: async (p, l, h) => {
          await h.safeClick(WS_LIST_BUTTON);
          await p.waitForSelector('[data-testid="workspace-table"]', { timeout: 8000 });
          await h.moveTo(WS_TABLE);
          await h.hover(WS_TABLE);
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
          await h.hover(WS_PROFIT);
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
          await h.hover(BS_SOURCE);
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
          await h.hover(BS_CONSOLIDATED);
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
          await h.hover(BS_SOURCE);
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
          await h.hover(BS_LIABILITIES);
          await h.hover(BS_EQUITY);
          await h.moveTo(BS_DE);
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
          await h.hover(BS_STRUCTURE);
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
          await h.hover(BS_COMPOSITION);
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
          await h.hover(BS_EDIT_WARNING);
        },
      },
      {
        voice: {
          az: "Bölmə başlıqları yalnız lokal görünüşü idarə edən əlçatan düymələrdir. Aktivlər və Öhdəlikləri indi yığıb yenidən açıram ki, uzun cədvəldə naviqasiyanı göstərim. Bu kliklər serverə yazmır, seçilmiş planı dəyişmir və maliyyə sətrinə toxunmur; onlar sadəcə uyğun hesab sətirlərini ekranda gizlədir və qaytarır.",
          en: "Section headers are accessible buttons that control only the local presentation. I now collapse and reopen Assets and Liabilities to demonstrate navigation through a long table. These clicks write nothing to the server, do not change the selected plan, and do not touch a financial row; they only hide and restore the matching account lines on screen.",
          ru: "Заголовки разделов — доступные кнопки, управляющие только локальным представлением. Сейчас я сворачиваю и снова раскрываю Активы и Обязательства, показывая навигацию по длинной таблице. Эти клики ничего не записывают на сервер, не меняют выбранный план и финансовые строки, а лишь скрывают и возвращают соответствующие счета на экране.",
        },
        do: async (p, l, h) => {
          await h.safeClick(BS_ASSETS_TOGGLE);
          await h.safeClick(BS_ASSETS_TOGGLE);
          await h.safeClick(BS_LIABILITIES_TOGGLE);
          await h.safeClick(BS_LIABILITIES_TOGGLE);
        },
      },
      {
        voice: {
          az: "Kapital bölməsini də yığıb yenidən açaraq təhlükəsiz iş ardıcıllığını yekunlaşdırıram. Əvvəl planı, Fakt mənbəyini, konsolidasiya sərhədini və son sübutlu ayı təsdiqləyin; sonra KPI, struktur və hesab detallarını oxuyun. Sübut çatmırsa sıfır uydurmayın, inputu dəyişməyin və idxalı kor-koranə başlatmayın; təsdiqlənmiş mənbə faylını əvvəlcə preview edin.",
          en: "I finish by collapsing and reopening Equity, then restate the safe operating sequence: confirm the plan, Actuals source, consolidation boundary and latest evidenced month before reading KPIs, structure and account detail. When evidence is missing, do not invent a zero, edit an input, or launch an import blindly; preview the approved source workbook and resolve the gap first.",
          ru: "В завершение я сворачиваю и снова раскрываю Капитал. Безопасная последовательность такова: подтвердите план, источник «Факт», границу консолидации и последний доказанный месяц, затем читайте KPI, структуру и счета. Если данных не хватает, не придумывайте ноль, не меняйте input и не запускайте импорт вслепую; сначала проверьте утверждённый исходный файл в preview.",
        },
        do: async (p, l, h) => {
          await h.safeClick(BS_EQUITY_TOGGLE);
          await h.safeClick(BS_EQUITY_TOGGLE);
          await h.moveTo(BS_KPIS);
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
          await h.hover(CF_HEADER);
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
          await h.hover(CF_EVIDENCE);
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
          await h.hover(CF_TOTALS);
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
          await h.hover(CF_MONTHLY);
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
          await h.hover(CF_GENERATE);
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
          await h.hover(CF_TABS);
        },
      },
      {
        voice: {
          az: "Qeydlər görünüşü hesablamanın mənbəyinə enir: ay, daxilolma və ya ödəniş növü, fəaliyyət, təsvir və məbləğ. Manager və admin üçün bu sətirlər redaktə və yumşaq silmə idarələri daşıya bilər. Təlim yalnız lokal taba keçir; heç bir sahəyə fokus vermir, dəyəri dəyişmir, blur yaratmır və silmə düyməsinə toxunmur.",
          en: "Entries is the drill-down to calculation sources: month, inflow or payment type, activity, description, and amount. For managers and administrators these rows may expose inline editing and recoverable soft-delete controls. The guide only switches the local tab; it never focuses a field, changes a value, triggers blur, or touches a delete action.",
          ru: "«Записи» — это переход к источникам расчёта: месяц, тип поступления или платежа, деятельность, описание и сумма. Для менеджера и администратора строки могут содержать inline-редактирование и восстановимое мягкое удаление. Гайд лишь переключает локальную вкладку: не фокусирует поля, не меняет значения, не вызывает blur и не касается удаления.",
        },
        do: async (p, l, h) => {
          await h.safeClick(CF_ENTRIES_BUTTON);
          await p.waitForSelector(CF_ENTRIES_VIEW, { timeout: 8000 });
          await h.moveTo(CF_ENTRIES_EVIDENCE);
        },
      },
      {
        voice: {
          az: "İcmala qayıdanda düzgün iş ardıcıllığı belədir: əvvəl il və təşkilat scope-unu təsdiqləyin, sonra mənbə qeydlərinin mövcudluğunu yoxlayın, yalnız bundan sonra qrafik, aylıq balans və fəaliyyətlər üzrə hesabatı oxuyun. Məlumat yoxdursa, növbəti addım rəqəm uydurmaq və ya generatoru kor-koranə işə salmaq deyil, təsdiqlənmiş Cash Flow faylını preview ilə idxal etməkdir.",
          en: "Back in Overview, the safe operating sequence is simple: confirm year and organization scope, verify that source entries exist, and only then interpret the chart, monthly balances, and activity statement. If evidence is absent, the next step is not to invent zeros or run the generator blindly; it is to preview and import an approved Cash Flow source file.",
          ru: "После возврата в Обзор безопасный порядок прост: подтвердите год и scope организации, проверьте наличие исходных записей и только затем читайте график, месячные балансы и отчёт по деятельности. Если доказательств нет, следующий шаг — не придумывать нули и не запускать генератор вслепую, а сделать preview и импортировать утверждённый исходный файл Cash Flow.",
        },
        do: async (p, l, h) => {
          await h.safeClick(CF_OVERVIEW_BUTTON);
          await p.waitForSelector(CF_OVERVIEW, { timeout: 8000 });
          await h.moveTo(CF_EVIDENCE);
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
          await h.hover(CMP_PICKER);
        },
      },
      {
        voice: {
          az: "İndi iki məlumatla doldurulmuş uyğun illik faktiki dövrü seçirəm. Birinci seçim müqayisə əsasını sabitləyir: plan növü, illik və ya aylıq detallılıq, eləcə də ay və ya rüb yuvası eyni olmalıdır. Boş planlar, faktiki dövrü büdcə ilə və ya aylıq dövrü illik dövrlə qarışdıran kartlar avtomatik deaktiv olur.",
          en: "I now select two populated, compatible annual actuals periods. The first selection fixes the comparison basis: plan kind, annual or monthly granularity, and the relevant month or quarter slot must match. Empty plans and cards that would mix actuals with a budget, or a monthly period with an annual period, are automatically disabled.",
          ru: "Теперь я выбираю два заполненных совместимых годовых фактических периода. Первый выбор фиксирует основу сравнения: должны совпасть вид плана, годовая или месячная детализация и соответствующий месяц либо квартал. Пустые планы и карточки, смешивающие факт с бюджетом или месячный период с годовым, автоматически отключаются.",
        },
        do: async (p, l, h) => {
          await h.safeClick(CMP_PRIMARY);
          await h.safeClick(CMP_SECONDARY);
          await p.waitForSelector(CMP_KPIS, { timeout: 15000 });
          await h.moveTo(CMP_BASIS);
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
          await h.hover(CMP_PROVENANCE);
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
          await h.hover(CMP_KPIS);
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
          await h.hover(CMP_CHART);
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
          await h.hover(CMP_TOTALS);
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
          await h.hover(CMP_TABLE);
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
          await h.hover(CMP_TABLE);
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
          await h.hover(CMP_TABLE);
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
          await h.hover(FC_PROVENANCE);
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
          await h.hover(FC_KPIS);
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
          await h.hover(FC_COMPARISON);
        },
      },
      {
        voice: {
          az: "İndi Optimist görünüşə keçirəm; o yalnız ekrandakı lokal çarpanları tətbiq edir: gəlir arta, maya dəyəri və xərclər azala bilər. Bu klik bazaya yeni proqnoz yazmır və planı dəyişmir. Aylıq trenddə yaşıl sütun gəliri, narıncı sütun maya dəyəri ilə əməliyyat xərclərinin cəmini, bənövşəyi xətt isə eyni düsturla EBITDA-nı göstərir.",
          en: "Now I switch to Optimistic; it applies only the local on-screen multipliers, so revenue can rise while COGS and operating expense fall. This click does not save a new forecast or alter the plan. In the monthly trend, green bars are revenue, orange bars combine COGS and operating expenses, and the purple line is EBITDA from that same complete formula.",
          ru: "Теперь я переключаюсь на оптимистичный вид; он применяет только локальные экранные множители: доходы могут вырасти, а себестоимость и операционные расходы снизиться. Переключение не сохраняет новый прогноз и не меняет план. На месячном графике зелёные столбцы — доходы, оранжевые — все затраты, фиолетовая линия — EBITDA по той же полной формуле.",
        },
        do: async (p, l, h) => {
          await h.safeClick(FC_OPTIMISTIC);
          await h.moveTo(FC_MONTHLY);
          await h.hover(FC_COMPARISON);
        },
      },
      {
        voice: {
          az: "İndi Pessimist ssenariyə keçirəm; bu, gəliri azaldıb xərcləri artıran lokal stress baxışıdır. Sağdakı müqayisə üç ssenarinin gəlirindən bütün xərcləri çıxaraq EBITDA nəticəsini eyni əsasda göstərir. Parametrlər düyməsi çarpanları açır, lakin bu təlim inputları açmır və dəyişmir, beləliklə istehsal məlumatında yeni məna yaratmır.",
          en: "Now I switch to Pessimistic, a local stress view that reduces revenue and increases costs. The comparison card evaluates all three scenarios on one basis by deducting every cost from revenue to reach EBITDA. The settings control exposes multipliers, but this guide never opens or edits an input, so it cannot create a new meaning in production data.",
          ru: "Теперь я переключаюсь на пессимистичный сценарий — локальный стресс-вид, который снижает доходы и повышает затраты. Карточка сравнения оценивает три сценария на одной основе, вычитая из доходов все затраты до EBITDA. Настройки открывают множители, но гайд не открывает и не меняет input, поэтому не создаёт новый смысл в производственных данных.",
        },
        do: async (p, l, h) => {
          await h.safeClick(FC_PESSIMISTIC);
          await h.moveTo(FC_SETTINGS);
          await h.hover(FC_PNL);
        },
      },
      {
        voice: {
          az: "İndi Baza ssenarisinə qayıdıb P&L xülasəsini yoxlayıram. Hər ay üçün gəlir, bütün xərclər, EBITDA və marja göstərilir; aylıq sütunların cəmi sağdakı dövr yekunu ilə uyğun olmalıdır. Sonra Gəlir bölməsini açıb məbləğin hansı büdcə kateqoriyalarından gəldiyini izləyirik, lakin heç bir rəqəm xanasına toxunmuruq.",
          en: "Now I return to Base and inspect the P&L summary. Each month shows revenue, total costs, EBITDA, and margin, and the monthly columns must reconcile to the period total at the right. We then open Revenue to trace the amount into budget categories, but never click a numeric cell because that surface can enter an editable state.",
          ru: "Теперь я возвращаюсь в базовый сценарий и проверяю сводку P&L. Для каждого месяца показаны доходы, все затраты, EBITDA и маржа, а сумма месячных колонок должна сходиться с итогом периода справа. Затем раскрываем Доходы до бюджетных категорий, но не нажимаем числовые ячейки, потому что они могут перейти в режим редактирования.",
        },
        do: async (p, l, h) => {
          await h.safeClick(FC_BASE);
          await h.safeClick(FC_REVENUE);
          await h.moveTo(FC_MATRIX);
        },
      },
      {
        voice: {
          az: "Gəlir bölməsini bağlayıb Maya dəyərini açıram və izah zamanı onu açıq saxlayıram. Maya dəyəri ümumi mənfəətdən əvvəl gəlirdən çıxılır; bu lokal keçid heç nə saxlamır. Bir kateqoriyada kursiv məbləğ görürsünüzsə, bu plan bazasıdır; adi üslubda açıq sıfır isə saxlanmış aylıq düzəliş ola bilər və itkin qeydlə qarışdırılmamalıdır.",
          en: "I close Revenue, open COGS, and keep its rows visible while explaining them. COGS is deducted from revenue before gross profit, and this local view change saves nothing. If a category amount is italic, it comes from the plan baseline; an explicit saved zero can instead be a real monthly override and must remain distinguishable from an absent entry.",
          ru: "Я закрываю Доходы, раскрываю Себестоимость и оставляю её строки видимыми на время объяснения. Себестоимость вычитается из доходов до валовой прибыли, а локальное изменение вида ничего не сохраняет. Курсивная сумма пришла из плановой базы; явный сохранённый ноль может быть месячным переопределением и должен отличаться от отсутствующей записи.",
        },
        do: async (p, l, h) => {
          await h.safeClick(FC_REVENUE);
          await h.safeClick(FC_COGS);
          await h.moveTo(FC_MATRIX);
        },
      },
      {
        voice: {
          az: "Maya dəyərini bağlayıb Əməliyyat xərclərini açıram və sətirləri ekranda saxlayıram. Bu xərclər EBITDA hesablamasının son əsas hissəsidir. Matrisdəki aylıq EBITDA yuxarı P&L xülasəsi və trend xətti ilə uyğun olmalıdır; fərq yaranarsa, videonu yayımlamaq və rəqəmi şərh etmək olmaz, əvvəl düstur, mənbə və dövr uzlaşdırılmalıdır.",
          en: "I close COGS, open Operating expenses, and keep those rows on screen. They are the final major component of EBITDA. Monthly EBITDA in the matrix must agree with the upper P&L summary and trend line; if those surfaces ever disagree, the guide must not be published and the number must not be interpreted until formula, source, and period are reconciled.",
          ru: "Я закрываю Себестоимость, раскрываю Операционные расходы и оставляю строки на экране. Это последний крупный компонент EBITDA. Месячная EBITDA в матрице должна совпадать с верхней сводкой P&L и линией тренда; если экраны расходятся, гайд нельзя публиковать и цифру нельзя интерпретировать до сверки формулы, источника и периода.",
        },
        do: async (p, l, h) => {
          await h.safeClick(FC_COGS);
          await h.safeClick(FC_EXPENSE);
          await h.moveTo(FC_PNL);
        },
      },
      {
        voice: {
          az: "Sonda Əməliyyat xərclərini bağlayıram. Təhlükəsiz iş ardıcıllığı belədir: əvvəl planı və dövrü təsdiqləyin, sonra saxlanmış düzəlişlərin sayını və valyuta sübutunu yoxlayın, daha sonra KPI, trend, ssenari müqayisəsi və detallı matrisi uzlaşdırın. Proqnoz qeydi yoxdursa, plan bazasını qərar üçün hazır tarixi proqnoz adlandırmayın; təsdiqlənmiş aylıq mənbəni əvvəl preview edin.",
          en: "Finally I close Operating expenses. The safe sequence is: confirm plan and period, check the saved-override count and currency evidence, then reconcile KPIs, trend, scenario comparison, and detailed matrix. When no forecast entries exist, do not call the plan baseline a decision-ready historical forecast; preview an approved monthly forecast source before any import or interpretation.",
          ru: "В завершение я закрываю Операционные расходы. Безопасная последовательность такова: подтвердите план и период, проверьте число сохранённых переопределений и валюту, затем сверьте KPI, тренд, сценарии и детальную матрицу. Если записей прогноза нет, не называйте плановую базу готовым для решений историческим прогнозом; до импорта и выводов сначала сделайте preview утверждённого месячного источника.",
        },
        do: async (p, l, h) => {
          await h.safeClick(FC_EXPENSE);
          await h.moveTo(FC_PROVENANCE);
          await h.hover(FC_KPIS);
          await h.moveTo(FC_MATRIX);
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
          await h.hover(PLANS_ROOT);
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
          await h.hover(PLANS_EVIDENCE);
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
          await h.hover(PLANS_EVIDENCE);
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
          await h.hover(PLANS_CARD);
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
          await h.hover(PLANS_CARD);
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
          await h.hover(PLANS_PROVENANCE);
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
          await h.hover(PLANS_APPROVAL_HISTORY);
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
          await h.hover(PLANS_VERSION);
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
          await h.hover(PLANS_COUNT);
          await h.moveTo(PLANS_PROVENANCE);
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
          await h.hover(TERM_TOOLBAR);
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
          await h.hover(TERM_COMMAND);
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
          await p.waitForSelector(TERM_COMPANY, { timeout: 15000 });
          await h.safeClick(TERM_COMPANY);
          await h.sleep(500);
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
          await h.hover(TERM_SNAPSHOT);
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
          await h.hover(TERM_MATRIX);
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
          await h.safeClick(TERM_CELL);
          await h.sleep(600);
          await p.waitForSelector('[data-testid="indicator-detail-result"]', { timeout: 15000 });
          await p.waitForSelector(TERM_DETAIL, { timeout: 15000 });
          await h.moveTo(TERM_DETAIL);
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
          await h.moveTo(TERM_VARIANCE);
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
          await h.hover(TERM_PERIODS);
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
          await p.waitForSelector(TERM_ROOT, { timeout: 15000 });
          await h.moveTo(TERM_ROOT);
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
          await h.sleep(300);
          await h.hover(BANNER);
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
          await h.hover(BANNER_DETAIL);
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
          await selectCompany(p, h);
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
          await h.safeClick(RUN_BTN);
          await p.waitForSelector(RESULT, { timeout: 15000 }).catch(() => {});
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
          await h.hover(CARD_BS);
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
          await h.hover(SIGN_CONV);
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
          await h.hover(CARD_CFS);
          await h.moveTo(CFS_REASON);
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
          await h.hover(CARD_FX);
          await h.moveTo(FX_DATES);
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
          await h.hover(WHY);
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
        },
      },
    ],
  },
};

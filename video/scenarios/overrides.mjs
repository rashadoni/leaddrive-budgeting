/**
 * Hand-authored, per-section guide scenarios (rich, real-UI walkthroughs).
 * produce-guides.mjs loads this; an entry here WINS over browser-guided.json.
 *
 * Shape: export default { "<slug>": { route, title{lang}, scenes:[
 *   { voice:{az,en,ru}, do: async (page, lang, h) => { ... } } ] } }
 *
 * h helpers move the VISIBLE cursor to a real element, then act:
 *   h.hover(sel) · h.click(sel) · h.moveTo(sel) · h.fill(sel,text) · h.sleep(ms)
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
const RUN_BTN = [
  "main button:has-text('Run controls')",
  "main button:has-text('Запустить контроли')",
  "main button:has-text('Kontrolları işə sal')",
  "main button:has-text('Running')",
  "main button:has-text('Выполняется')",
  "main button:has-text('İcra olunur')",
];
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
const WS_MATERIAL = ['[data-testid="workspace-material-filter"]', WS_CONTROLS[0]];
const WS_MATRIX_BUTTON = ['[data-testid="workspace-view-matrix"]', WS_CONTROLS[0]];
const WS_LIST_BUTTON = ['[data-testid="workspace-view-list"]', WS_CONTROLS[0]];
const WS_MATRIX = ['[data-testid="workspace-matrix"]', "main"];
const WS_TABLE = ['[data-testid="workspace-table"]', "main table", "main"];

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
          await h.click(WS_MATERIAL);
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
          await h.click(WS_MATRIX_BUTTON);
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
          await h.click(WS_LIST_BUTTON);
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
          await h.click(RUN_BTN);
          await p.waitForSelector(RESULT, { timeout: 15000 }).catch(() => {});
        },
      },
      // 5 — The balance-sheet card: delta, tolerance, source rows.
      {
        voice: {
          az: "Balans kontrolunu götürək. O, manatla işarəli fərqi, müqayisə olunduğu dözümlülüyü və hər tərəfdəki mənbə sətirlərinin sayını göstərir — beləcə siz yalnız fərqi deyil, onu yaradan məlumatın həcmini, üstəgəl balansların necə oxunduğunu bildirən işarə konvensiyası sətrini görürsünüz.",
          en: "Take the balance-sheet control. It shows the signed delta in manat, the tolerance it's compared against, and the source-row counts behind each side — so you see not just the gap, but how much real data produced it, plus the sign-convention line telling you how the balances were read.",
          ru: "Возьмём контроль баланса. Он показывает знаковую разницу в манатах, допуск, с которым она сравнивается, и число исходных строк с каждой стороны — так вы видите не только расхождение, но и сколько данных его породило, вместе со строкой соглашения о знаках, объясняющей, как были прочитаны балансы.",
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
          az: "İndi bloklanmış kart — pul axını cəmi. Onun nə «keçdi», nə də «keçmədi» statusu var, çünki sübut sadəcə yoxdur: puldakı xalis dəyişiklik heç vaxt ayrıca sətir kimi saxlanılmır, ona görə də aşağıdakı komponent siyahısı bu girişi çatışmayan kimi qeyd edir. Bu kart sınıq deyil, dürüstdür — o, təxmin etməkdən imtina edir.",
          en: "Now a blocked card — cash-flow sum. It carries no pass or fail because the evidence simply isn't there: net change in cash is never stored as a line, so the component list below marks that input as missing. This card is honest, not broken — it refuses to guess.",
          ru: "Теперь заблокированная карточка — сумма денежных потоков. У неё нет ни «пройдено», ни «не пройдено», потому что доказательства просто нет: чистое изменение денежных средств не хранится отдельной строкой, поэтому список компонентов ниже помечает этот вход как отсутствующий. Карточка честна, а не сломана — она отказывается угадывать.",
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

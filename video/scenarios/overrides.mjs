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

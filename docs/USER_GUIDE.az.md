# BudgetPro — İstifadəçi Təlimatı

> **Enterprise Holding Risk Terminal**
> Bu nədir, necə istifadə etmək olar, nəyi və harada yoxlamaq lazımdır.
> Müştəri, maliyyə direktoru və holdinq admini üçün.

---

## Mündəricat

1. [Bu nədir və nəyə görə](#1-bu-nədir-və-nəyə-görə)
2. [Giriş və naviqasiya](#2-giriş-və-naviqasiya)
3. [Risk Terminal — maliyyəçinin iş günü](#3-risk-terminal--maliyyəçinin-iş-günü)
   - [3.1 What-if ssenarilər — «əgər...»](#31-what-if-ssenarilər--əgər)
4. [Board Deck — şura üçün foto](#4-board-deck--şura-üçün-foto)
5. [Büdcələşdirmə](#5-büdcələşdirmə)
   - [5.1 Report Builder (ANALYTICS) — ixtiyari kəsiklər + qrafiklər](#51-report-builder-analytics--ixtiyari-kəsiklər--qrafiklər)
6. [Yeni şirkətin onboardinqi](#6-yeni-şirkətin-onboardinqi)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel idxalı](#8-ai-auto-import--istənilən-excel-idxalı)
9. [Risk Registry — keyfiyyət risk bayraqları](#9-risk-registry--keyfiyyət-risk-bayraqları)
   - [9.1 Compliance & Legal — real göstəricilər](#91-compliance--legal--real-göstəricilər-audit-hesabatlarından-və-məhkəmələrdən)
   - [9.2 Concentration — gəlirinizi kim saxlayır](#92-concentration--gəlirinizi-kim-saxlayır)
10. [AI funksiyaları — nə, harada, nə qədər başa gəlir](#10-ai-funksiyaları--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nəyə görə

**BudgetPro — 60+ şirkətdən ibarət holdinq CFO-su üçün terminaldır.**

Bir məqsəd: səhər 5 dəqiqə ərzində **sizin şirkətlərdən hansıları indi risk zonasındadır**, **niyə** və **bununla nə etmək lazımdır** — başa düşmək.

### Sistemin cavab verdiyi üç səviyyəli suallar

| Sual | Harada baxmaq | Nə qədər vaxt |
|---|---|---|
| «Bu gün nə yanır?» | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| «Niyə bu göstərici qırmızıdır?» | **Variance Explainer** (xanaya klik → Explain) | 10 saniyə + ~15 saniyə AI |
| «Direktorlar şurasına nə göstərmək olar?» | **Board Deck** — bir kliklə PDF/PPTX | 20 saniyə |

### Nələr var
- AZSEKER holdinqinin **6 canlı entity** (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 göstərici** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat)
- Anthropic Claude üzərində **AI-agentlər**: Excel təsnifatçısı, kənarlaşma izahçısı, Board Deck generatoru, səhər brifinqi
- **Tam audit-trail** — hər dəyişiklik 365 gün ərzində IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya sizin production domen.

![Login](guide/screenshots/01-login.webp)

Kredenşialları sistem administratoru verir. Əgər siz həmin administratorsunuzsa və yeni stend yerləşdirilibsə — parol `scripts/create-admin.ts`-dən və ya deploy sirlərinizdən.

> 🔒 Parollar açıq sənədləşdirmədə dərc edilmir.

### 2.2 Yan naviqasiya

Girişdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nəyə görə |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-üslub terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün foto (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yenilərin idxalı |
| 📜 | **Audit Log** | Bütün mühüm dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + üstünlüklər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

Bu **əsas ekrandır**. Səhər açırsınız — bütün lazımlı buradadır.

### Dörd panel

#### Panel 1 · Company Tree (yuxarı solda)
Holdinqin bütün şirkətlərinin ağacı hər biri üçün **composite-score** nişanı ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı göstəricilərin sayı
- **Çiplər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk-bayraqları (bax bölmə 9)

**Nə yoxlamaq:** şirkətə klik → sağ HeatMap bu şirkətə görə filtrlənir.

#### Panel 2 · Risk HeatMap (yuxarı sağda)
**Matris: şirkətlər × göstəricilər.** Xananın rəngi = status (yaşıl/amber/qırmızı/məlumat yoxdur).

Hər xana təkcə rənglə deyil, həm də **forma** ilə (▲ / ● / ○) işarələnib — clinical color-blind safety üçün (Phase M7 reqressiya skanı geri çəkilməni qadağan edir).

Yuxarıda:
- **Dövr seçici** — terminal defolt olaraq **sonuncu başa çatmış maliyyə ili** üzrə açılır (indi 2025), cari bağlanmamış üzrə deyil. Beləliklə, başlıq rəqəmləri — tam həqiqi il, 3–4 keçirilmiş ay deyil. Tam tarix **2023–2025** yüklənib (P&L + balans + cash flow), ona görə 2025 — həqiqi headline-il.
- İlin içərisində rüb filtri (Q1…Q4 / M1…M12)
- `Material only` — tətbiq olunmayan göstəriciləri gizlətmək
- Sayğac: `54G / 30A / 16R / 88?`

> ⚠️ **Bitmə miş il (YTD).** Əgər əllə cari ilə (2026) keçsəniz, yuxarıda amber banner görünür «qismən il / year-to-date — rəqəmlər ilkin, tam dövrün nəticəsi deyil». Xanaların rəngləri dürüst qalır (real qırmızı CPC / AZSF / MALT görünür), amma bitmə miş ildə istənilən «yaşılı» mövsümi düzəliş ilə oxuyun. Nümunə: EDEN-in EBITDA marjası bağlanmamış 2026-da +169,8 % göstərirdi — bu artefaktdır (ilin əvvəlində xırda məhsuldan əvvəl gəlirdə birdəfəlik aqrar subsidiya, dövr üzrə zərər ilə); tam 2025 ili üçün dürüst rəqəm — **28 %** yaşıl.

**Nə yoxlamaq:** kursoru xanaya aparın → tooltip planlaşdırılmış diapazonla ədədlə.

#### Panel 3 · Indicator Detail (aşağı solda)
Defolt olaraq **«Today's brief»** göstərir — səhər AI-brifinqi.

HeatMap xanasına kliklədikdə **göstərici detalizasiyasına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Resolved variables
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (aşağı sağda)
- Defolt: məsləhət «Pick a HeatMap cell, then click Explain →»
- Şirkətə kliklədikdən sonra: **Company Snapshot** (top alarmlar + breakdown)
- `Explain →` kliklədikdən sonra: **AI Variance Explainer** — narrative + 3 tövsiyə

### 60 saniyədə nə yoxlamaq
1. AZSEKER ağacını açın → composite-score ilə 7 sub-co olmalıdır
2. Qırmızı xanaya klikləyin → Panel 3 formulanı göstərəcək, Panel 4 — Explain düyməsi
3. Explain basın → ~15 saniyədən sonra TOP DRIVERS və RECOMMENDATIONS ilə narrative görünəcək
4. Aşağıda — EVENTS lenti (sonuncu LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

### 3.1 What-if ssenarilər — «əgər...»

Terminalda **iki fərqli** what-if səthləri var — qarışdırmayın:

| Səth | Necə açmaq | Nə edir |
|---|---|---|
| **Sürətli hesablama** (önbax / Quick preview) | siqnal paneli → hesablama düyməsi | Yeni **bazar fidinin** dəyərini (buğda qiyməti, FAO indeksi…) əvəz edir və dərhal ondan **asılı olan** göstəricilərin necə sürüşəcəyini göstərir. Yalnız fid-ankor göstəricilər. |
| **Ssenarilər** (Scenario Panel) | `SCN` əmri / ssenarilər bölməsi | Tam simulyasiya: drayver-ssenari P&L-drayverləri (gəlir, maya dəyəri, valyuta xərcləri) dəyişdirir və bütün holdinqin composite-score-unu yenidən hesablayır. |

**Hesablama rəqəmlərini necə oxumaq (BAZA → SSENARI, Δ%):**
- **BAZA** — göstəricinin cari (baza) dəyəri.
- **SSENARI** — sizin dəyişikliyinizdən **sonra** dəyər.
- **Δ%** — göstəricinin özünün dəyəri neçə faiz sürüşüb (BAZA → SSENARI), «nəyinsə faizi» **deyil**. Göstərici kodu yanında **ölçü vahidi** göstərilir (məsələn `FP_WHEAT_PRICE_SIGNAL · USD/tonne`), sətrin nə ilə hesablandığını görmək üçün.

**Niyə devalvasiya bəzən «heç nəyi dəyişmir».** Əgər kursu qaldırırsınızsa (AZN devalvasiyası), amma göstəricilər hərəkət etmirsə — cari məlumatlar üçün bu **düzdür**: yüklənmiş rəqəmlərdə AZSEKER şirkətləri **tamamilə daxilidir** (xərclər manatla, idxal valyuta komponentləri yoxdur). FX-şok yalnız məlumatlarda valyuta ilə xərclər/alışlar görünəndə təsir edəcək (bax bölmə 9.2.5 FX-exposure haqqında). Bu baq deyil — model dürüstcə göstərir «bu məlumatlarda zəiflik yoxdur».

**«Sürətli hesablama» nə deməkdir.** Bu yuxarıdakı cədvəldən önbax / Quick preview rejimidir — yalnız bazar fidinə bağlı göstəricilər üçün işləyir. Drayver-ssenarilər üçün (gəlir / xərclər) Scenario Panel istifadə edin.

> Əgər qaynar düymə «What-if» düzgün səhifə açmırsa — bu iki səthin məlum ayrılığıdır; etiketlər və yazılar ayrılıb, yuxarıdakı cədvəldən istifadə edin.

---

## 4. Board Deck — şura üçün foto

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Məqsəd:** direktorlar şurası üçün bir səhifəlik sənəd. Açırsınız → oxuyursunuz → «Print to PDF» basırsınız → çata göndərirsiniz.

### Nələr var
1. **Başlıq-narrativ** — AI bir cümlə generasiya edir, məsələn *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»*
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — plandan kimin daha çox yuxarı/aşağı olması
4. **Alerts** — hədd pozuntuların kritik halları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk-bayraqları olan şirkətlərlə bölmə

### Keyfiyyət riskləri bölməsinin skrinşotu (səhifənin aşağısı)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Burada görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraqlar **avtomatik olaraq şirkətin composite score-unu azaldır** və səhər brifinqinə düşür (bax bölmə 9).

### Eksport düymələri
- `Export PPTX` — bayt-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzer çapı
- `Open Risk Terminal →` — drill-down üçün canlı terminalа keçid

---

## 5. Büdcələşdirmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**Bu «adi» FP&A workspace**-dir — maliyyəçinin Excel-də etdiyi indi burada edir.

### Sol sidebar — işin strukturu

**FINANCE** — üç klassik hesabat:
- 📈 **P&L** — mənfəət və zərər haqqında hesabat
- 💰 **Sales** — satışların detalizasiyası
- 📑 **Balance Sheet** — balans
- 💸 **Cash Flow** — pul hərəkəti
- 📐 **Assumptions** — model üçün fərziyyələr

**PLANNING** — nə planlaşdırırıq:
- 🗂️ **Workspace** — büdcənin əsas ekranı (skrinşotda)
- 📊 **P&L (Plan)** — P&L formatında plan
- 🔮 **Forecast** — proqnoz
- ⚖️ **Comparison** — plan vs fakt vs forecast
- 📅 **Plans** — bütün planların siyahısı

**ANALYTICS** — ixtiyari kəsiklər üçün Report Builder.

**SETTINGS** — Import / Configuration.

**ADMIN** — dərin parametrlər (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← burda Risk Registry**).

### Əsas Workspace ekranında nə var
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** icra % və kənarlaşma ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — detallı cədvəl

### Nə yoxlamaq
1. Yuxarıda başlığın sağında — plan seçici (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Aşağı sağda — `AI Analysis` düyməsi (bənövşəyi)

### 5.1 Report Builder (ANALYTICS) — ixtiyari kəsiklər + qrafiklər

**URL:** `/budgeting/reports`

İstənilən məlumat mənbəyi üzrə hesabat konstruktoru (P&L / Sales / Balance Sheet / Cash Flow / büdcə sətirləri). Solda — konfiqurasiya, sağda — canlı önbaxış.

**Hesabatı necə qurmaq:**
1. **Mənbə** (entity) və lazımi **sütunlar** seçin. Sütunlar arasında `account` ölçüsü var — hesablar planından (Chart of Accounts) hesabın kodu və adı.
2. Sağda önbaxış dərhal yenilənir. Əgər mənbədə məlumat yoxdursa — boş panel deyil, «məlumat yoxdur» mesajı görəcəksiniz; yükləmədə — yükləmə indikatoru, xətada — xəta mətni.
3. **Qrafiklər harada.** Vizualizasiya növü keçidi (table / bar / stacked / line / pie / area) konfiqurasiya sol panelinin **aşağısında**, «Calculated fields» blokunun altında yerləşir. Cədvəl olmayan növ seçin → ədədi sütunlar olduqda qrafik qurulur.

> Əgər bölmə əvvəllər «sınıq» və boş görünürdüsə — bu sxem miqrasiyasından (Phase 2.1) sonrakı reqressiya idi (hesabatlar mühərriki Phase 2.1-də silinmiş sütunları seçirdi). Düzəldildi; üstəlik yükləmə / xəta / «məlumat yoxdur» halları əlavə olundu ki, boş mənbə daha pozuntu kimi görünməsin.

---

## 6. Yeni şirkətin onboardinqi

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxilolma tərəqqisini göstərmək və «boş» bölmələri bitirməyə kömək etmək.

### Nə görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng vurğusu:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

### Bizim demo-da nə göstərilib

| Code | Name | Industry | Hazırlıq | Status |
|---|---|---|---|---|
| AZSEKER | Azərşəkər | food_processing | 100% | ✅ VERIFIED |
| AZSEKER-MALT | Malt | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-EDEN | Eden Agro | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-AZSF | Azərşəkər Sugar | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-HORIZON | Horizon | services | 80% | ✅ VERIFIED |
| AZSEKER-FARM | Farm | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-PROMALT | Promalt MMC | food_processing | 30% | ⏳ PENDING |
| AZSEKER-CPC | CPC | food_processing | 90% | ✅ VERIFIED |

**Nə yoxlamaq:** kartına klik → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğunu, hansılarının bitməli olduğunu göstərən detalizasiya açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**Bu «mühəndislik paneli»dir** — müştəri demo-sundan **əvvəl** və gündəlik dəstək üçün nə istifadə etmək.

### Dörd qrup

#### 🧪 Data Ingestion (məlumat yükləmə)
| Kart | Nə edir |
|---|---|
| **Məlumat idxalı** `Phase 7.M Tier 7` | İstənilən xlsx drag-drop → AI növü müəyyən edir (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adapterə yönləndirir. 5 fərqli forma əvəzinə bir ekran. |
| **Data Entry** | Non-engineer admin üçün əl ilə KPI və ESG açıqlamalarının daxil edilməsi. |
| **Data Sources Catalog** | Client-facing xarici feedlərin siyahısı: biznes dəyəri, nümunə dəyəri, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazə verilmiş xlsx-mənbələrin siyahısı. |

#### 🩺 Data Quality (məlumat keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Hər göstərici üzrə yaşıl/amber/qırmızı/naməlum remediation guidance ilə. Müştəri demo-sundan **əvvəl** istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + reference-feed təzəliyi + dayandırılmış onboarding halları. |
| **Companies Readiness** | Hər entity üzrə 7 sahədə qiymətləndirmə tierlə (complete/good/partial/thin/empty). CSV eksport. |
| **Data Archive** | Self-service arxiv + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | External feed adapter statusu + son crawls + xəbər xətti diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — bağlı dövrlərə dəyişikliklərdən qapanma
- **Approvals** — dəyişikliklərin razılaşdırılması workflow
- **AI Usage** — 30 günlük trendinə LLM-xərclərinin monitorinqi

#### 👥 Access (girişlər)
- **User Access** — istifadəçilər və rolların idarə edilməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demo-dan əvvəl must-check

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (43.6% computed 1201 total IVs-dən)

**Unknown breakdown xəta kodu üzrə:**
- `eval: 430` — formullar düşdü
- `non_finite: 123` — sıfra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbə yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problem olan konkret göstəricilərin siyahısı + bir sətirdə remediation.

**Demo-dan əvvəl nə yoxlamaq:**
1. **AGRO_COMMODITY_VOL** → 75 xana, investigate lazımdır
2. **FP_INVENTORY_TURNS** → 49 xana, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 xana, production KPI-də `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 xana, entity başına `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq toru

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

7 sahədə hər entity üzrə qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tierlə qaldırmaq üçün nə əlavə etmək lazımdır

**Skrində görünür:**
- HORIZON 15% Thin → P&L (budget lines), balance sheet, counterparties lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → operational KPIs, strategic narrative, FX tags lazımdır
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** düyməsi email üçün gap-list-i kopyalayır.

### 7.3.6 Indicator Backlog — şirkət başına nə çatışmır

**URL:** `/budgeting/admin/indicator-backlog`

**Məqsəd:** tam bir səhifə harada entity başına «nə yüklənməyib» — faydasız qeydlər olmadan, konkret action-plan ilə.

**Struktur:**
- **5 xülasə kartı:** Entities / Applicable indicators / With data / Missing / Overall readiness %
- **By-owner aggregate** — kliklanabilən bəyjirlər «Risk Officer 5 item borcludur», «Sales Director 12», «CFO 8»
- **Filtrlər:** Category / Owner / Hide entities with 0 missing
- **Entity başına kartlar** iki sütunla: **«Has data»** (artıq doldurulmuş göstəricilərlə yaşıl çiplər) və **«Needs data»** (owner + action ilə çəhrayı sətrlər)

**Çiplər və sətirlər oxunaqlı adı (RU) göstərir**, texniki kod (`AGRO_COMMODITY_VOL`, `FP_INVENTORY_TURNS` və s.) kiçik monoşrift mətnlə yaxınlıqda və ya hover zamanı tooltip-də göstərilir. Bu maliyyə personalının abbreviaturaları öyrənməməsi üçün edilib — amma developer/AI-idxal ilə ünsiyyətdə kod əlaltındadır.

**Sətir başına actions:**
- 📧 **Email** — owner-ə sorğulanan məlumatların konkret siyahısı ilə mailto: pre-filled mətn ilə açır
- ⬆️ **Upload file** (entity-level) — `/admin/ai-import?forEntity=AZSEKER-AZSF`-a deep-link
- 📥 **CSV** (entity-level) — müştəriyə göndərmək üçün gap-list yükləmə
- 📨 **Email all owners** (entity-level) — owner üzrə qruplaşma ilə bulk mailto

**AI Auto Import ilə inteqrasiya:**
`/admin/ai-import`-da uğurlu idxaldan sonra banner görünür:
> ✅ Indicator Backlog-dan 7 bənd bağlandı
> - AZSEKER-AZSF → AUDIT_CLOSED_PCT
> - AZSEKER-CPC → AUDIT_MAJOR_OPEN
> - ...
> [Indicator Backlog-u aç →]

**Owner mapping** — kim nəyə cavabdehdir:

| Məlumat kateqoriyası | Owner role |
|---|---|
| Audit findings | Internal Audit / Hüquq Şöbəsi |
| Court cases | Hüquq Şöbəsi (Legal) |
| Customers (counterparty) | Sales Director / Commercial Manager |
| Suppliers | Procurement / Təchizat Şöbəsi |
| P&L / BS / CF | CFO / Finance Manager |
| Strategic narrative + Risk Registry + competitors + NPS | Risk Officer (Nəcəf M) |
| Operational KPIs (harvest / yield / sugar content) | Farm Manager / QA / Production |
| Commodity / weather / news | BudgetPro System (auto-populated) |

**Org başına customization:** hər təşkilat üçün (FO Holding, gələcəkdə azmade / tabia) owner mapping `Organization.settings.dataOwners` JSON vasitəsilə yenidən müəyyən oluna bilər — real adlar və emaillər əlavə etmək. Override olmadan generic role label istifadə olunur.

### 7.3.5 Compliance Hub — audit-tapıntılar + məhkəmələr vahid ekran

**URL:** `/budgeting/admin/compliance`

**Məqsəd:** compliance/legal officer üçün bir səhifə — 6 entity üzrə bütün 218 audit tapıntısı (Major/Minor/Observation/OFI) + 54 məhkəmə işi, filtrlər və CSV-yükləmə ilə.

**Nələr var:**
- **2 tab** — Audit findings / Court cases
- **Aktiv tab üçün yuxarıda 5 xülasə kartı** (audit üçün Total / Open / Major / Minor / Observation; məhkəmələr üçün Total / Open / Defendant / Plaintiff / Money claims)
- **Rəng kodlaması ilə cədvəl** severity-çipləri: Major (rose), Minor (amber), Observation (slate), OFI (sky)
- **Klik ilə drill-down** — həm audit tapıntılarının, həm də **məhkəmə işlərinin** sətirləri detallı modalka açır (məhkəmə üzrə: iddiaçı → cavabdeh, tarix, mübahisə növü, məhkəmə, status, open/closed beyji). Əvvəllər məhkəmə sətirləri «ölü», kliklanmayan idi — indi mausla və klaviaturadan (Enter / Space) açılır.
- **Filtrlər:** Entity (6-dan biri) / Severity / Status (Open/Closed/All)
- **Export CSV** filtrlənmiş kəsiyin fayl adında timestamp ilə

**Məlumatlar haradan:** artıq Phase 7.N-dən DB-də (`Company.settings.auditFindings.items` + `courtDisputes.cases`). Yeni cədvəllər yoxdur.

**Nə yoxlamaq:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 total → CSV 159 sətir verməlidir
- CPC ct: 8 cases, hamısı open, 7 defendant kimi
- Filtr `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → 6 sətir olmalıdır

### 7.3 Data Archive — bərpa ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Nəyə görə:** idxalda səhv edilib → sətirləri hesablamadan silmək lazımdır, amma IFRS-auditi üçün fiziki **silmədən**.

**Necə işləyir:**
- Arxivləşdirmə HeatMap, recompute, hesabatlardan məlumatları gizlədir
- Fiziki məlumatlar **silinmir** — **90 gün** ərzində bərpa mümkündür
- Bütün hərəkətlər audit trail-ə yazılır
- 90 gündən sonra — gündəlik cron `soft-delete-purge` fiziki silir

**Forma:**
- **Hərəkət:** Arxivləşdir / Bərpa et
- **Növ:** P&L / BS / CF / Counterparty
- **Şirkət + İl**
- **Səbəb** (audit log-a düşür)
- **Təsdiq:** səhvdən qaçmaq üçün `ALL` daxil edin

---

## 8. AI Auto Import — istənilən Excel idxalı

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.webp)

**Bu əl mapinqinin qatilidir.** Phase 7.M Tier 7-yə qədər hər yeni xlsx kod tələb edirdi. İndi:

### Necə işləyir (5 faza)
1. **AI Classifier** (Anthropic) — vərəqin dataType-ını müəyyən edir: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — reyestrdən düzgün adapter seçir (11 dataTypes)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — hər idxal mənbə ilə yoxlanır
5. **GREEN verdict** — fərq yoxdur və ya diff görürsünüz

### İki rejim
- **`1 fayl`** — standart, bir workbook üçün
- **`Bir neçə fayl`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - 1-10 fayl eyni vaxtda
  - **Group-level atomicity** — ya bütün qruplar yazılır, ya heç biri
  - **Cross-file conflict detection** — əgər iki fayl bir xanaya fərqli yazırsa → 409 diff ilə
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nə yoxlamaq
1. İstənilən xlsx-i `xlsx faylını buraya sürükləyin` zonasına drag-drop
2. `Addım 1: AI-vərəq analizi` basın
3. AI təsnifatı + plan import təklifi qaytaracaq
4. Təsdiq edirsiz → fayl idxal olunur → avtomatik recompute

### Önbaxış: confidence + təsirlənmiş göstəricilər (2026-05-27)

«Addım 1: AI analizi»-ndən sonra hər vərəq üzrə üç təbəqə məlumat görünür:

| Nə göstərir | Nəyə görə |
|---|---|
| **dataType chip** (növə görə rəngli) | dərhal AI vərəqi hansı kateqoriyaya aid etdiyini görmək üçün — PLF / BS / KPI_FARMING / OPS_FACTS / ... |
| **Confidence bar + «yüksək · 92%»** | AI təsnifatda nə qədər əmindir (yaşıl ≥85% / sarı 65-84% / qırmızı <65% «⚠ yoxlamaq») |
| **«N göstəriciləri təsir edəcək: …»** çiplərlə | Apply-dən sonra məlumat alacaq konkret göstəricilərin siyahısı (Azərbaycanca + technical-kod kiçik monoşriftlə) |

Bu **məlumatlar DB-yə düşməmişdən ƏVVƏL AI səhvini tutmaq** imkanı verir. Əgər confidence qırmızıdır və ya «Təsir edəcək» siyahısı gözlədiyinizə bənzəmirsə — vərəqin adını başa düşülən adla dəyişdirin və yenidən yükləyin.

**Təsnifatçının dəqiqliyi:**

| Confidence | Təxmini səhv ehtimalı | Hərəkət |
|---|---|---|
| ≥85% (yaşıl) | ~2–5% | Tətbiq etmək təhlükəsizdir |
| 65–84% (sarı) | ~10–20% | «Təsir edəcək»-ə bax — düzdürsə, tətbiq et |
| <65% (qırmızı) | ~30–50% | Əl yoxlaması olmadan tətbiq etmə |

**AZSEKER üçün nəzarət nöqtəsi:** real `Guvven Fin.xlsx`-də AI 23/23 dataType + 14/14 entity (100%) vurdu. Amma bu aydın strukturlu bir fayldır; qeyri-standart workbook-da % düşür.

### Məhdudiyyətlər
- Single file: ≤ 20 MB
- Multi file: ≤ 10 fayl, ≤ 20 MB total
- Rate limit: 3 multi-file idxalı/saat/org
- Cost cap: əvvəlcədən yoxlanır (N × 35K tokens)

---

## 9. Risk Registry — keyfiyyət risk bayraqları

**URL:** `/budgeting/admin/companies` → **«Şirkət parametrləri»** bölməsi → şirkət kartını genişlət

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**Bu ən yeni fiça (Phase 7.N, may 2026).** HeatMap-in kəmiyyətcə göstərmə diyi keyfiyyət maliyyə-əməliyyat riskləri.

### Üç kanonik bayraaq

| Bayraaq | Emoji | Nə deməkdir | Composite-a cəza |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja əhəmiyyətli dərəcədə subsidiyalardan və ya tənzimlənən qiymətlərdən asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Related-party və ya unaudited cost-allocation patterni | **−8** |
| `data_absence` | ⚪ | Əsas maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq
1. `/budgeting/admin/companies`
2. **«Şirkət parametrləri»** bölməsi (səhifənin aşağısında)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **«Risk Registry»** tapın — ciddiliyinə görə 8 kateqoriyaya sıralanıb `● ● ●` dotlarla (emerald → amber → rose)
5. Lazımi bayrağa klikləyin — vurğulanacaq, cəza saxlamadan sonra tətbiq olunacaq

### Bu bayraqlar hara düşür (4 kanal, end-to-end yoxlanılıb)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (adın yanında `Sub` / `Opq` / `NoD` çipləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (*«exposure to government policy/subsidy regime»* tipli frazalar) |
| **Board Deck section** | Board Deck → **«Qualitative Risk Flags»** bölməsi FLAGGED ENTITIES count ilə |
| **Variance Explainer** | Risk Terminal → xanaya klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### DB-nin cari vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **composite-a −20**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Entity başına detallı Risk Registry

3 kanonik bayraqdan əlavə, hər şirkətin detallı risk reyestri (KRI list) ola bilər — admin-paneldə göstərilir:
**`/budgeting/admin/companies` → şirkət kartını aç → «Risk Registry» bölməsi**.

**Cari vəziyyət:**

| Entity | KRIs | Mənbə |
|---|---|---|
| **EDEN** | 15 | `Top risk - EDEN AGRO MMC.xlsx` (müştəridən fayl) |
| **AZSF / CPC / MALT / HORIZON / PROMALT / FARM** | 0 | ⏳ Pending — Nəcəf M-dən gözlənilir (CARRYOVER L2) |

Qalan entity üçün reyestrlər **məqsədli olaraq doldurulmayıb** — biz riskləri özümüz generasiya etmirik, holdinqin Risk Officer-ından real KRIləri gözləyirik. Burda uydurma məlumat olmamalıdır: maliyyə CFO bu göstəricilərə görə qərarlar qəbul edir.

---

## 9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real göstəricilər

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → «Compliance» bölməsi

Üç yeni göstərici, müştəri faylları ilə qidalanır (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | Nə ölçür | Yaşıl | Amber | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanan audit qeydlərinin % (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### İndi DB-də nə var (live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştəri fayllarında məlumat yoxdur | | |

### Haradan gəlir

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlı, 6 Major açıq). CPC = 59 tapıntı (39% bağlı, 3 Major açıq). Tam siyahı drill-down üçün `Company.settings.auditFindings` vasitəsilə əlçatandır.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reyestri: 54 keys. AZSF — 26-da cavabdeh (29 açıq). CPC — 7-də cavabdeh (8 açıq). EDEN — yalnız iddiaçı (4 açıq). Tam reyestr `Company.settings.courtDisputes`-da.

### Nə yoxlamaq
- HeatMap-də 3 yeni sütun görünüb (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- AZSF/AUDIT_MAJOR_OPEN qırmızı xanasına klik → Variance Explainer narrativdə açıq Major tapıntılarını sitat gətirməlidir
- Board Deck → «Critical alerts» bölməsi indi compliance/legal xəbərdarlıqları ehtiva edir

> **İş başına risk-altında pul (AZN):** göstəricilərdən 2026-05-27 silindi. Regex yalnız 54-dən 4 işi (7%) əhatə edirdi — misleading floor estimate. Hüquq Şöbəsindən tam claim amounts reyestri gələndə yenidən reallaşdırılacaq.

---

## 9.2.5 FX riski — gəlirin nə hissəsi kurs üçün zəifdir

**Harada:** Risk Terminal → HeatMap sütun `REVENUE_FX_EXPOSURE`.

`Company.settings.fxRevenueAzn/Usd/Eur/Rub`-da saxlanır — hər valyutada gəlirin %-i. Formula: **100 − fxRevenueAzn** = % non-AZN.

**Cari vəziyyət:**

| Entity | AZN | USD | EUR | FX Exposure | Mənbə |
|---|---|---|---|---|---|
| **CPC** | 84% | 14% | 2% | 🟢 16% | `Farming strategy/Sales plan` — real volume splits 2027-2035 |
| AZSF / MALT / EDEN / HORIZON / PROMALT | — | — | — | ⚪ Pending | N. Nəcəfzadə file «Müştəri İcmalı»-ndan gözlənilir (CARRYOVER L1) |

Yalnız CPC real məlumatlara malikdir (müştərinin forward plan-ından hesablanıb). Qalan 5 entity üçün split-i məqsədli olaraq DOLDURMURuq — doğrulanmış per-customer FX breakdown gəlməyənə qədər `REVENUE_FX_EXPOSURE` `unknown` göstərir.

**Həddlər:**
- 🟢 ≤ 20% — daxili bazar dominant
- 🟡 20–50% — qarışıq ekspozisiya
- 🔴 > 50% — FX-dalğalanmaları gəlir üzərində dominant

**`FX_IMPORTED_INPUT` (cost-side) ilə əlaqə**: iki göstərici birlikdə hamısında revenue split olanda **NET FX position** verəcək. Əgər cost ≈ revenue bir valyutada → natural hedge.

---

## 9.2 Concentration — gəlirinizi kim saxlayır

**Harada:** Risk Terminal → HeatMap (3 sütun) + Board Deck → top movers/alerts.

HHI-dən (riyazi düzdür, amma CFO-ya pis kommunikasiya edilir) əlavə **birbaşa konsentrasiya göstəriciləri** əlavə edildi, dərhal oxunur:

| Code | Nə ölçür | Yaşıl | Amber | Qırmızı |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman index (riyazi konsentrasiya) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | **Bir** ən böyük müştəridən gəlirin %-i | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | **Top-3** ən böyük müştərilərdən gəlirin %-i | ≤ 50% | 50–75% | > 75% |

### Live məlumatlar

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Kim dominant |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | ümumiyyətlə 2 müştəri |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | ehtimal AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg single-buyer |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (şirniyyat) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ məlumat yoxdur | ⚪ | ⚪ | (Azersun ilə JV) |

### Niyə hər iki göstərici
- **TOP_CUSTOMER_SHARE** — «bir müştəri itirmək» (məsələn AZSF Bakı Şirniyyatı itirir → gecədə −32% revenue)
- **TOP3_CUSTOMER_SHARE** — «long-tail sağlamlığı» (MALT 80% o deməkdir ki, top-3-dən sonra demək olar heç nə yoxdur — 3-ü də gedirsə əvəz edilə bilməz)
- **CUSTOMER_HHI** — akademik düzgün ölçü, tənzimləyicilər / due diligence üçün

---

## 10. AI funksiyaları — nə, harada, nə qədər başa gəlir

Bütün LLM-çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost mode + retry policy).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → «Today's Brief» bölməsi

**Nə edir:** günün risk-klasterini bir cümlə ilə təsvir edir + sektorlar üzrə «top worst»-u sadalayır. Keyfiyyət risk-bayraqlarını nəzərə alır.

**Çıxış nümunəsi (canlı, DB-dən):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ yuxarı küncündə keçid).

**Keş necə işləyir:** prompta mətninə sha256 + dataset hash. Prompta dəyişdiririk → köhnə keş avtomatik invalidasiya olunur.

### 10.2 Variance Explainer (kənarlaşma izahçısı)

**Harada:** Risk Terminal → HeatMap xanasına klik → `Explain →` düyməsi

![Variance Explainer](guide/screenshots/13-variance-explainer.webp)

**Nə edir:** narrative (1-3 cümlə) + 3 actionable tövsiyə + TOP DRIVERS siyahısı.

**EDEN Customer HHI üçün çıxış nümunəsi:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Diqqət yetirin — tövsiyə #3 Risk Registry səhifəsindən `subsidy_dependency` risk-bayrağını sitat gətirir.

**Dəyər:** çağırış başına ~1200 in + ~240 out tokens (~ $0.01).

### 10.3 Board Deck Narration

**Harada:** Board Deck açılanda avtomatik generasiya olunur.

**Nə edir:** kəmiyyət siqnallarını *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir cümlə-başlığa çevirir.

(orgId, period)-da keşlənir — saatda maksimum bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylı drag-drop.

**Nə edir:** istənilən xlsx üçün smart-routing. Tam workbook üçün ~$0.13 başa gəlir (testdə 23 vərəq / 14 entities). Yeni adapterlər yoxdur — AI özü növü müəyyən edəcək və düzgün pipeline seçəcək.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Məqsəd:** bütün mühüm dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanır.

### Nə yazılır
- Bütün idxallar (filename, dəyişdirilmiş sətlər, status)
- Bütün mapper applies
- Rol dəyişiklikləri
- Indicator overrides
- LLM calls (model, prompt version, tokens, fromCache)
- **Soft-delete və physical purge** (Phase 1.4 cron)

### Filtrlər
- **Action** — hadisə növü
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix diapazonu
- **Düymələr:** Apply / Reset

### Nə yoxlamaq
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` qeydləri görünür
- ACTOR sütunu — əl hərəkətləri üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Qeydlər yuxarıda yeni sıralanıb

---

## 12. Özünüyoxlama çek-listi

**İndi**, canlı tətbiqdə klikləyərək bu siyahıdan keçin. Əgər nəsə uyğun gəlmirsə — hardasa baq var, fixi növbəyə qoymaq lazımdır.

### Əsas naviqasiya
- [ ] `/login` → admin kredlərilə gir → `/budgeting`-ə redirect
- [ ] Sidebar 6 bənd göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ yuxarı küncdə tema keçidi (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN yanında `Sub` nişanı, AZSF yanında — `Opq` + `NoD` görünür
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətir göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: «Today's brief» yüklənir, mətn «subsidy-regime» və ya «non-transparent» xatırlatmalarını ehtiva edir (bu keyfiyyət risk-bayraqları ilə AI Morning Brief)
- [ ] EDEN row qırmızı xanasına klik, CUSTOMER_HHI sütunu → Panel 3 `counterparty_hhi_customer` formulasını göstərir
- [ ] `Explain →` klik → ~15s-dən sonra narrative + 3 tövsiyə görünür
- [ ] Tövsiyə #3-də **subsidy dependency** (və ya əlaqəli) frazaya sitat gətirilir

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI-başlığı mövcuddur (nəsə «Food processing margin squeeze...» tipli)
- [ ] Holding composite score = **59** (yazı anında)
- [ ] Aşağı sürüşdür → **«Qualitative Risk Flags»** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` çip (amber)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri mövcuddur

### Büdcələşdirmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Hover zamanı tooltip-lu Waterfall chart (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçici `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — PENDING ilə yeganə
- [ ] Qalanları ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Ləndinq 4 qrupda 16 kart göstərir
- [ ] `Məlumat idxalı` və `Indicator Health` kartları `Phase 7 M` beyji ilə işarələnib
- [ ] Bütün kartlar kliklanabiləndir

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 fayl` / `Bir neçə fayl` (yenisi `yeni` işarəli)
- [ ] Drop-zone mövcuddur
- [ ] `Addım 1: AI-vərəq analizi` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Xəta kodu üzrə breakdown görünür
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity-dən cədvəl Score asc (ən pisi əvvəl) üzrə sıralanır
- [ ] HORIZON və PROMALT MMC aşağıda Thin tier ilə
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Hərəkət / Məlumat növü / Şirkət / İl / Səbəb / `ALL` təsdiq sahələri ilə forma
- [ ] Radio `Arxivləşdir (hesablamalardan gizlət)` defolt seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda 8 entity ilə Role & Status cədvəli
- [ ] Aşağıda açılan kartlarla «Şirkət parametrləri»
- [ ] EDEN kartının içində — 8 kateqoriya ilə **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddiliyi `● ● ●` dotlarla göstərilir (emerald / amber / rose)

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 xana **qırmızı** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 keys, hamısı iddiaçı kimi)
- [ ] AZSF/AUDIT_MAJOR_OPEN qırmızı xanasına klik → Variance Explainer Major findings-ə sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisə cədvəli, yeni yuxarıda
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` qeydləri mövcuddur
- [ ] SUMMARY tokens + language + fromCache ilə JSON ehtiva edir

### AI çağırışları (Audit Log vasitəsilə)
- [ ] Son 24 saat ərzində ən azı bir `ai_variance_explainer_run`
- [ ] Bu gün üçün `ai_morning_brief_run` var
- [ ] `ai_board_deck_narration_run` var (Board Deck açılanda generasiya olunur)
- [ ] Eyni parametrlərlə təkrar sorğular üçün `fromCache: true`

---

## Nəsə sınıbsa hara müraciət etmək

| Simptom | Hara baxmaq |
|---|---|
| Composite score yenidən hesablanmadı | `Risk Terminal → Recompute` düyməsi |
| AI brief köhnədir | Audit Log → sonuncu `ai_morning_brief_run` tap → `fromCache` yoxla |
| HeatMap boşdur | `Indicator Health` → UNKNOWN breakdown yoxla |
| İdxal düşdü | `Admin → Drift Dashboard` → sonuncu events |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat növü + il + səbəb seç → ALL |
| Dövr təsadüfən bağlandı | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki təfərrüatlar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** Anthropic Claude `@anthropic-ai/sdk` vasitəsilə serverside caching ilə
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Miqrasiya siyasəti:** bütün miqrasiyalar Prisma + audit vasitəsilə; 90 günlük fiziki purge cron ilə soft-delete
- **Cost guard rails:** rate-limits + token budgets + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N-in (hər 4 kanalda risk-bayraqları) bağlanmasından sonra generasiya edilib.
> Skrinşotların mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

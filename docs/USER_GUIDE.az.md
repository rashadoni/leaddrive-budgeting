# BudgetPro — İstifadəçi Təlimatı

> **Enterprise Holding Risk Terminal**
> Bu nədir, necə istifadə edilir, nəyi və harada yoxlamaq lazımdır.
> Müştəri, maliyyə direktoru və holdinq admini üçün.

---

## Mündəricat

1. [Bu nədir və nə üçün lazımdır](#1-bu-nədir-və-nə-üçün-lazımdır)
2. [Giriş və naviqasiya](#2-giriş-və-naviqasiya)
3. [Risk Terminal — maliyyəçinin iş günü](#3-risk-terminal--maliyyəçinin-iş-günü)
4. [Board Deck — direktorlar şurası üçün görüntü](#4-board-deck--direktorlar-şurası-üçün-görüntü)
5. [Büdcələmə](#5-büdcələmə)
6. [Yeni şirkətin onbordinqi](#6-yeni-şirkətin-onbordinqi)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel-in idxalı](#8-ai-auto-import--istənilən-excel-in-idxalı)
9. [Risk Registry — keyfiyyət risk bayraları](#9-risk-registry--keyfiyyət-risk-bayraları)
   - [9.1 Compliance & Legal — real göstəricilər](#91-compliance--legal--audit-hesabatları-və-məhkəmələrdən-real-göstəricilər)
   - [9.2 Concentration — gəlirinizi kim saxlayır](#92-concentration--gəlirinizi-kim-saxlayır)
10. [AI funksiyaları — nə, harada, nə qədər başa gəlir](#10-ai-funksiyaları--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nə üçün lazımdır

**BudgetPro — 60+ şirkətdən ibarət holdinqin CFO-su üçün terminaldir.**

Bir məqsəd: səhər 5 dəqiqə ərzində **hansı şirkətlərinizin indi risk zonasında olduğunu**, **nə üçün** və **bununla nə etmək lazım olduğunu** başa düşmək.

### Sistemin cavab verdiyi üç səviyyəli suallar

| Sual | Harda baxmaq | Nə qədər vaxt |
|---|---|---|
| "Bu gün nə yanır?" | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| "Bu göstərici niyə qırmızıdır?" | **Variance Explainer** (xanaya klik → Explain) | 10 saniyə + ~15 saniyə AI |
| "Direktorlar şurasına nə göstərmək olar?" | **Board Deck** — PDF/PPTX bir kliklə | 20 saniyə |

### Daxilində nələr var
- **6 canlı entity** AZSEKER holdinqinin (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 göstərici** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat)
- **AI agentlər** Anthropic Claude-da: Excel təsnifləşdiricisi, kənarlaşma izahedicisi, Board Deck generatoru, səhər brifinqi
- **Tam audit-trail** — hər dəyişiklik 365 gün müddətinə IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya sizin production domeniniz.

![Login](guide/screenshots/01-login.webp)

Kimlik məlumatlarını sistem administratoru verir. Əgər siz həmin administrator olsanız və stendin qurulmasını yenicə bitirmisinizsə — parol `scripts/create-admin.ts` faylında və ya deployun sirlərindədir.

> 🔒 Parollar açıq sənədlərdə dərc edilmir.

### 2.2 Yan naviqasiya

Girişdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nə üçün |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-üslub terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün görüntü (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yenilərinin idxalı |
| 📜 | **Audit Log** | Bütün əhəmiyyətli dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + seçimlər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

Bu **əsas ekrandır**. Səhər açırsınız — lazım olan hər şey buradadır.

### Dörd panel

#### Panel 1 · Company Tree (yuxarıda solda)
Holdinqin bütün şirkətlərinin ağacı, hər biri üçün **composite-score** badge ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı göstəricilərin sayı
- **Çiplər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk bayraları (bax bölmə 9)

**Nəyi yoxlamaq lazımdır:** şirkətə klik → sağdakı HeatMap həmin şirkətə görə filtrlənir.

#### Panel 2 · Risk HeatMap (yuxarıda sağda)
**Matris: şirkətlər × göstəricilər.** Xananın rəngi = status (yaşıl/sarı/qırmızı/m/y).

Hər xana təkcə rənglə deyil, həm də **forma** ilə işarələnib (▲ / ● / ○) — clinical color-blind safety üçün (Phase M7 reqressiya skanı geri çəkilməni qadağan edir).

Yuxarıda:
- Rüb filtri (2026 / Q1...Q4 / M1...M12)
- `Material only` — tətbiq olunmayan göstəriciləri gizlət
- Sayğac: `54G / 30A / 16R / 88?`

**Nəyi yoxlamaq lazımdır:** kursorla xanaya keçin → tooltip rəqəm + planlaşdırılan diapazonla.

#### Panel 3 · Indicator Detail (aşağıda solda)
Standart olaraq **«Today's brief»** göstərir — səhər AI brifinqi.

HeatMap xanasına kliklədikdə **göstəricinin detalizasiyasına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Resolved variables
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (aşağıda sağda)
- Standart olaraq: məsləhət «Pick a HeatMap cell, then click Explain →»
- Şirkətə kliklədikdən sonra: **Company Snapshot** (top alarmlar + breakdown)
- `Explain →` kliklədikdən sonra: **AI Variance Explainer** — narrative + 3 tövsiyə

### 60 saniyədə nəyi yoxlamaq lazımdır
1. AZSEKER ağacını açın → composite-score ilə 7 sub-co olmalıdır
2. Qırmızı xanaya klikləyin → Panel 3 formulanı göstərəcək, Panel 4 — Explain düyməsi
3. Explain basın → ~15 saniyədən sonra TOP DRIVERS və RECOMMENDATIONS ilə narrative görünəcək
4. Aşağıda — EVENTS lenti (son LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — direktorlar şurası üçün görüntü

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Məqsəd:** direktorlar şurası üçün bir səhifəli sənəd. Açırsınız → oxuyursunuz → "Print to PDF" basırsınız → çata göndərirsiniz.

### Nələr var
1. **Başlıq-narrative** — AI bir cümlə yaradır, məsələn *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»*
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — plandan yuxarı/aşağı ən çox dəyişənlər
4. **Alerts** — həddlərin kritik pozuntuları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk bayraları olan şirkətlərin bölməsi

### Keyfiyyət riskləri bölməsinin skrinşotu (səhifənin aşağısı)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Burada görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraklar **avtomatik olaraq şirkətin composite score-nu azaldır** və səhər brifinqinə düşür (bax bölmə 9).

### İxrac düymələri
- `Export PPTX` — bayt-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzer çapı
- `Open Risk Terminal →` — drill-down üçün canlı terminalə keçid

---

## 5. Büdcələmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**Bu «adi» FP&A workspace-dir** — maliyyəçinin Excel-də etdiyi işi indi burada edir.

### Sol sidebar — iş strukturu

**FINANCE** — üç klassik hesabat:
- 📈 **P&L** — mənfəət və zərər haqqında hesabat
- 💰 **Sales** — satışların detalizasiyası
- 📑 **Balance Sheet** — balans
- 💸 **Cash Flow** — pul hərəkəti
- 📐 **Assumptions** — model üçün fərziyyələr

**PLANNING** — nəyi planlaşdırırıq:
- 🗂️ **Workspace** — büdcənin əsas ekranı (skrinşotda)
- 📊 **P&L (Plan)** — P&L formatında plan
- 🔮 **Forecast** — proqnoz
- ⚖️ **Comparison** — plan vs fakt vs forecast
- 📅 **Plans** — bütün planların siyahısı

**ANALYTICS** — ixtiyari kəsiklər üçün Report Builder.

**SETTINGS** — Import / Configuration.

**ADMIN** — dərin parametrlər (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← burda Risk Registry**).

### Əsas Workspace ekranında nələr var
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** execution % və variance ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — ətraflı cədvəl

### Nəyi yoxlamaq lazımdır
1. Başlıqdan sağda — plan seçicisi (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Aşağıda sağda — `AI Analysis` düyməsi (bənövşəyi)

---

## 6. Yeni şirkətin onbordinqi

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxiletmə tərcümənini göstərmək və "boş" bölmələri tamamlamağa kömək etmək.

### Nə görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng işıqlandırması:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

### Bizim demoda nə göstərilir

| Code | Ad | Sənaye | Hazırlıq | Status |
|---|---|---|---|---|
| AZSEKER | Azərşəkər | food_processing | 100% | ✅ VERIFIED |
| AZSEKER-MALT | Malt | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-EDEN | Eden Agro | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-AZSF | Azərşəkər Sugar | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-HORIZON | Horizon | services | 80% | ✅ VERIFIED |
| AZSEKER-FARM | Farm | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-PROMALT | Promalt MMC | food_processing | 30% | ⏳ PENDING |
| AZSEKER-CPC | CPC | food_processing | 90% | ✅ VERIFIED |

**Nəyi yoxlamaq lazımdır:** kartı klikləyin → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğunu və hansılarını tamamlamaq lazım olduğunu göstərən detail açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**Bu «mühəndislik paneli»dir** — **müştəri demosundan əvvəl** və gündəlik dəstək üçün istifadə edilməlidir.

### Dörd qrup

#### 🧪 Data Ingestion (məlumatların yüklənməsi)
| Kart | Nə edir |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | İstənilən xlsx-i drag-drop edin → AI növü müəyyənləşdirəcək (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adapterə yönəldəcək. 5 müxtəlif forma əvəzinə bir ekran. |
| **Data Entry** | Non-engineer admin üçün KPI və ESG açıqlamalarının əl ilə daxil edilməsi. |
| **Data Sources Catalog** | Müştəri üçün xarici feed-lərin siyahısı: biznes dəyəri, nümunə dəyəri, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazəli xlsx mənbələrinin siyahısı. |

#### 🩺 Data Quality (məlumatların keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Hər göstərici üçün yaşıl/sarı/qırmızı/naməlum remediation guidance ilə. **Əvvəl** müştəri demosundan istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + reference-feed tazeliyi + dayandırılmış onboarding halları. |
| **Companies Readiness** | Hər entity üçün 7 sahədə qiymətləndirmə tier-lərlə (complete/good/partial/thin/empty). CSV export. |
| **Data Archive** | Self-service arxiv + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | Xarici feed adapter statusu + son crawl-lar + xəbər pipeline diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — bağlı dövrləri mutasiyalardan bağlamaq
- **Approvals** — dəyişikliklərin təsdiq workflow-u
- **AI Usage** — 30 günlük trend ilə LLM xərclərinin monitorinqi

#### 👥 Access (girişlər)
- **User Access** — istifadəçi və rol idarəetməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demodan əvvəl must-check

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (43.6% 1201 ümumi IV-dən hesablanıb)

**Xəta kodu üzrə unknown breakdown:**
- `eval: 430` — formullar düşdü
- `non_finite: 123` — sıfıra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbələr yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problemli konkret göstəricilərin siyahısı + bir sətirdə remediation.

**Demodan əvvəl nəyi yoxlamaq lazımdır:**
1. **AGRO_COMMODITY_VOL** → 75 xana, araşdırmaq lazımdır
2. **FP_INVENTORY_TURNS** → 49 xana, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 xana, production KPI-də `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 xana, hər entity üçün `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq şəbəkəsi

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

7 sahə üzrə hər entity üçün qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tier-i qaldırmaq üçün nə əlavə etmək lazımdır

**Skrinşotda görünür:**
- HORIZON 15% Thin → P&L (budget lines), balance sheet, counterparties lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → operational KPIs, strategic narrative, FX tags lazımdır
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** düyməsi gap-list-i email üçün kopyalayır.

### 7.3.6 Indicator Backlog — hər şirkət üçün nə çatışmır

**URL:** `/budgeting/admin/indicator-backlog`

**Məqsəd:** "entity üçün nə yüklənməyib" göstərən dəqiq bir səhifə — faydasız qutuşlar olmadan, konkret fəaliyyət planı ilə.

**Struktur:**
- **5 xülasə kart:** Entities / Applicable indicators / With data / Missing / Overall readiness %
- **By-owner aggregate** — kliklənə bilən badge-lər «Risk Officer owes 5 items», «Sales Director owes 12», «CFO owes 8»
- **Filtrlər:** Category / Owner / Hide entities with 0 missing
- **Hər entity üçün sətir** — açılır → hər sətir owner + scope + action ilə bütün missing indicators cədvəli

**Hər sətir üçün hərəkətlər:**
- 📧 **Email** — owner-ə tələb olunan məlumatların konkret siyahısı ilə pre-filled mətn bədəni ilə mailto açır
- ⬆️ **Upload file** (entity-level) — `/admin/ai-import?forEntity=AZSEKER-AZSF`-a deep-link
- 📥 **CSV** (entity-level) — müştəriyə göndərmək üçün gap-list-in yüklənməsi
- 📨 **Email all owners** (entity-level) — owner üzrə qruplaşdırma ilə bulk mailto

**AI Auto Import ilə inteqrasiya:**
`/admin/ai-import`-da uğurlu idxaldan sonra banner görünür:
> ✅ Indicator Backlog-dan 7 maddə bağlandı
> - AZSEKER-AZSF → AUDIT_CLOSED_PCT
> - AZSEKER-CPC → AUDIT_MAJOR_OPEN
> - ...
> [Indicator Backlog-u açın →]

**Owner mapping** — kim nəyə cavabdehdir:

| Məlumat kateqoriyası | Owner rolu |
|---|---|
| Audit findings | Internal Audit / Hüquq Şöbəsi |
| Court cases | Hüquq Şöbəsi (Legal) |
| Customers (counterparty) | Sales Director / Commercial Manager |
| Suppliers | Procurement / Təchizat Şöbəsi |
| P&L / BS / CF | CFO / Finance Manager |
| Strategic narrative + Risk Registry + competitors + NPS | Risk Officer (Nəcəf M) |
| Operational KPIs (harvest / yield / sugar content) | Farm Manager / QA / Production |
| Commodity / weather / news | BudgetPro System (avtomatik doldurulur) |

**Hər təşkilat üçün fərdiləşdirmə:** hər təşkilat üçün (FO Holding, gələcəkdə azmade / tabia) owner mapping-i `Organization.settings.dataOwners` JSON vasitəsilə yenidən müəyyənləşdirmək olar — real adlar və e-mail-lər əlavə edin. Override olmadan ümumi rol etiketi istifadə olunur.

### 7.3.5 Compliance Hub — audit tapıntıları + məhkəmələr üçün vahid ekran

**URL:** `/budgeting/admin/compliance`

**Məqsəd:** compliance/legal officer üçün bir səhifə — 6 entity üzrə bütün 218 audit tapıntısı (Major/Minor/Observation/OFI) + 54 məhkəmə işi, filtrlər və CSV yükləməsi ilə.

**Daxilində nələr var:**
- **2 tab** — Audit findings / Court cases
- Aktiv tab üçün **yuxarıda 5 xülasə kart** (audit üçün Total / Open / Major / Minor / Observation; məhkəmələr üçün Total / Open / Defendant / Plaintiff / Money claims)
- **Rəng kodlaşdırması ilə cədvəl** severity-chip-ləri: Major (rose), Minor (amber), Observation (slate), OFI (sky)
- **Filtrlər:** Entity (6-dan biri) / Severity / Status (Open/Closed/All)
- **Export CSV** fayl adında timestamp ilə filtrləmiş kəsik

**Məlumatlar haradan:** artıq Phase 7.N-dən (`Company.settings.auditFindings.items` + `courtDisputes.cases`) verilənlər bazasında. Yeni cədvəllər yoxdur.

**Nəyi yoxlamaq lazımdır:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 total → CSV 159 sətir verməlidir
- CPC ct: 8 iş, hamısı açıqdır, 7-si cavabdeh kimi
- Filtr `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → 6 sətir olmalıdır

### 7.3 Data Archive — bərpa ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Nə üçün:** idxalda səhv etdiniz → sətirləri hesablamadan çıxarmaq lazımdır, **amma IFRS auditi üçün fiziki olaraq silməmək**.

**Necə işləyir:**
- Arxivləşdirmə məlumatları HeatMap, recompute, hesabatlardan gizlədir
- Fiziki məlumatlar **silinmir** — bərpa **90 gün** ərzində mümkündür
- Bütün hərəkətlər audit trail-ə yazılır
- 90 gündən sonra — gündəlik cron `soft-delete-purge` fiziki olaraq silir

**Forma:**
- **Hərəkət:** Arxivləşdirmək / Bərpa etmək
- **Növ:** P&L / BS / CF / Counterparty
- **Şirkət + İl**
- **Səbəb** (audit log-a düşür)
- **Təsdiq:** səhv etməmək üçün `ALL` daxil edin

---

## 8. AI Auto Import — istənilən Excel-in idxalı

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.webp)

**Bu əl ilə mappinq-in qatilidir.** Phase 7.M Tier 7-yə qədər hər yeni xlsx kod tələb edirdi. İndi:

### Necə işləyir (5 mərhələ)
1. **AI Classifier** (Anthropic) — vərəqin dataType-ını müəyyənləşdirir: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — reyestrdən düzgün adapter seçir (11 dataType)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — hər idxal mənbə ilə yoxlanılır
5. **GREEN verdict** — fərq yoxdur və ya diff görürsünüz

### İki rejim
- **`1 файл`** — standart, bir workbook üçün
- **`Несколько файлов`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - Eyni anda 1-10 fayl
  - **Group-level atomicity** — ya bütün qruplar yazılır, ya heç biri
  - **Cross-file conflict detection** — əgər iki fayl eyni xanaya fərqli şey yazırsa → fərqlə 409
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nəyi yoxlamaq lazımdır
1. İstənilən xlsx-i `Перетащите xlsx файл сюда` zonasına drag-drop edin
2. `Шаг 1: AI-анализ листов` basın
3. AI təsnifatı qaytaracaq + plan import təklif edəcək
4. Təsdiq edirsiniz → fayl idxal olunur → avtomatik recompute

### Məhdudiyyətlər
- Single file: ≤ 20 MB
- Multi file: ≤ 10 fayl, ≤ 20 MB cəmi
- Rate limit: 3 multi-file idxal/saat/org
- Cost cap: əvvəlcədən yoxlanılır (N × 35K token)

---

## 9. Risk Registry — keyfiyyət risk bayraları

**URL:** `/budgeting/admin/companies` → **«Настройки компаний»** bölməsi → şirkət kartını genişləndirin

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**Bu ən təzə xüsusiyyətdir (Phase 7.N, may 2026).** HeatMap kəmiyyət olaraq göstərməyən keyfiyyət maliyyə-əməliyyat riskləri.

### Üç kanonik bayraqlı

| Bayraq | Emoji | Nə deməkdir | Composite-a cərimə |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja subsidiyalardan və ya tənzimlənən qiymətlərdən əhəmiyyətli dərəcədə asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Related-party və ya unaudited cost-allocation nümunəsi | **−8** |
| `data_absence` | ⚪ | Əsas maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq
1. `/budgeting/admin/companies`
2. **«Настройки компаний»** bölməsi (səhifənin aşağısı)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **«Risk Registry»** tapın — ciddilik nöqtələri ilə `● ● ●` (emerald → amber → rose) 8 kateqoriya üzrə çeşidlənib
5. Lazımi bayrağa klikləyin — o işıqlanacaq, saxlamadan sonra cərimə tətbiq olunacaq

### Bu bayraqlarm harada görünür (4 kanal, end-to-end yoxlanıb)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (adın yanında `Sub` / `Opq` / `NoD` çipləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (*«exposure to government policy/subsidy regime»* kimi ifadələr) |
| **Board Deck section** | Board Deck → **«Qualitative Risk Flags»** bölməsi FLAGGED ENTITIES sayı ilə |
| **Variance Explainer** | Risk Terminal → xanaya klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### Verilənlər bazasının cari vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **−20 composite-a**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Hər entity üçün ətraflı Risk Registry

3 kanonik bayraqdan əlavə, hər şirkətin ətraflı risk reyestri (KRI list) ola bilər — admin panelində göstərilir:
**`/budgeting/admin/companies` → şirkət kartını açın → «Risk Registry» bölməsi**.

**Cari vəziyyət:**

| Entity | KRI | Mənbə |
|---|---|---|
| **EDEN** | 15 | `Top risk - EDEN AGRO MMC.xlsx` (müştəri faylı) |
| **AZSF / CPC / MALT / HORIZON / PROMALT / FARM** | 0 | ⏳ Pending — Nəcəf M-dən (CARRYOVER L2) gözlənilir |

Qalan entity-lər üçün reyestrlər **qəsdən doldurulmayıb** — biz özümüz risklər yaratmırıq, holdinqin Risk Officer-indən real KRI-ları gözləyirik. Burda uydurma məlumat olmamalıdır: maliyyə CFO bu göstəricilərə əsasən qərar qəbul edir.

---

## 9.1 Compliance & Legal — audit hesabatları və məhkəmələrdən real göstəricilər

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → «Compliance» bölməsi

Üç yeni göstərici, müştəri fayllarından qidalanır (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Kod | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanmış audit qeydlərinin (PBC) %-i | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### İndi verilənlər bazasında nələr var (canlı)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştəri fayllarında məlumat yoxdur | | |

### Haradan götürülür

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlanıb, 6 Major açıqdır). CPC = 59 tapıntı (39% bağlanıb, 3 Major açıqdır). Tam siyahı drill-down üçün `Company.settings.auditFindings` vasitəsilə əlçatandır.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reyestri: 54 hal. AZSF — 26-da cavabdeh (29 açıqdır). CPC — 7-də cavabdeh (8 açıqdır). EDEN — yalnız iddiaçı (4 açıqdır). Tam reyestr `Company.settings.courtDisputes`-də.

### Nəyi yoxlamaq lazımdır
- HeatMap-də 3 yeni sütun görünür (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- Qırmızı xana AZSF/AUDIT_MAJOR_OPEN-a klik → Variance Explainer narrative-də açıq Major tapıntıları sitat gətirməlidir
- Board Deck → «Critical alerts» bölməsi indi compliance/legal xəbərdarlıqları ehtiva edir

> **Hər iş üzrə risk altındakı məbləğ (AZN):** 2026-05-27 tarixində göstəricilərdən silinib. Regex yalnız 54 işdən 4-nü (7%) əhatə edirdi — misleading floor estimate. Hüquq Şöbəsindən tam iddia məbləğləri reyestri gələndə yenidən reallaşdırılacaq.

---

## 9.2.5 FX risk — gəlirin hansı hissəsi məzənnəyə həssasdır

**Harada:** Risk Terminal → HeatMap sütunu `REVENUE_FX_EXPOSURE`.

`Company.settings.fxRevenueAzn/Usd/Eur/Rub`-da saxlanılır — hər valyutada gəlirin %-i. Formula: **100 − fxRevenueAzn** = % non-AZN.

**Cari vəziyyət:**

| Entity | AZN | USD | EUR | FX Exposure | Mənbə |
|---|---|---|---|---|---|
| **CPC** | 84% | 14% | 2% | 🟢 16% | `Farming strategy/Sales plan` — real volume split 2027-2035 |
| AZSF / MALT / EDEN / HORIZON / PROMALT | — | — | — | ⚪ Pending | N. Nəcəfzadə faylından «Müştəri İcmalı» gözlənilir (CARRYOVER L1) |

Yalnız CPC real məlumatlara malikdir (müştərinin forward planından hesablanıb). Qalan 5 entity üçün split-i qəsdən doldurmuruq — təsdiqlənmiş müştəri üzrə FX breakdown gələnə qədər `REVENUE_FX_EXPOSURE` `unknown` göstərir.

**Həddlər:**
- 🟢 ≤ 20% — daxili bazar dominant
- 🟡 20–50% — qarışıq exposure
- 🔴 > 50% — FX dəyişkənliyi gəlir üzərində dominant

**`FX_IMPORTED_INPUT` ilə əlaqə** (xərc tərəfi): iki göstərici birlikdə hamıda revenue split olanda **NET FX position** verəcək. Əgər xərc ≈ gəlir bir valyutada → təbii hedcinq.

---

## 9.2 Concentration — gəlirinizi kim saxlayır

**Harada:** Risk Terminal → HeatMap (3 sütun) + Board Deck → top movers/alerts.

HHI-dən (riyazi olaraq düzgün, lakin CFO-ya pis ötürülür) əlavə olaraq, dərhal oxunan **birbaşa konsentrasiya göstəriciləri** əlavə edildi:

| Kod | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman index (riyazi konsentrasiya) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | **Bir** ən böyük müştəridən gəlirin %-i | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | **Top-3** ən böyük müştərilərdən gəlirin %-i | ≤ 50% | 50–75% | > 75% |

### Canlı məlumatlar

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Kim dominant |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | Ümumiyyətlə 2 müştəri |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | ehtimal ki AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg single-buyer |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (şirniyyat) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ məlumat yoxdur | ⚪ | ⚪ | (Azersun ilə JV) |

### Nə üçün hər iki göstərici
- **TOP_CUSTOMER_SHARE** — «bir müştərinin itirilməsi» (məsələn AZSF Bakı Şirniyyatı itirir → overnight −32% gəlir)
- **TOP3_CUSTOMER_SHARE** — «long-tail sağlamlığı» (MALT 80% o deməkdir ki, top-3-dən sonra demək olar ki, heç nə yoxdur — hamısı gedərsə əvəz etmək olmaz)
- **CUSTOMER_HHI** — tənzimləyicilər / due diligence üçün akademik olaraq düzgün ölçü

---

## 10. AI funksiyaları — nə, harada, nə qədər başa gəlir

Bütün LLM çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost mode + retry policy).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → «Today's Brief» bölməsi

**Nə edir:** bir cümlə ilə günün risk klasterini təsvir edir + sektorlar üzrə «top worst»-u sadalayır. Keyfiyyət risk bayraqlarnı nəzərə alır.

**Çıxış nümunəsi (canlı, verilənlər bazasından):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ üst küncündə keçirici).

**Keş necə işləyir:** prompt mətni + dataset hash-ın sha256. Promptu dəyişdiririk → köhnə keş avtomatik olaraq etibarsızlaşdırılır.

### 10.2 Variance Explainer (kənarlaşma izahedicisi)

**Harada:** Risk Terminal → HeatMap xanasına klik → `Explain →` düyməsi

![Variance Explainer](guide/screenshots/13-variance-explainer.webp)

**Nə edir:** narrative (1-3 cümlə) + 3 fəaliyyət tövsiyəsi + TOP DRIVERS siyahısı.

**EDEN Customer HHI üçün çıxış nümunəsi:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Qeyd edin — tövsiyə #3 Risk Registry səhifəsindən `subsidy_dependency` risk bayrağını sitat gətirir.

**Qiymət:** çağırış üçün ~1200 in + ~240 out token (~ $0.01).

### 10.3 Board Deck Narration

**Harada:** Board Deck açılanda avtomatik yaradılır.

**Nə edir:** kəmiyyət siqnallarını *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir cümlə-başlığa çevirir.

(orgId, period) üzərində keşlənir — maksimum saatda bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylı drag-drop.

**Nə edir:** istənilən xlsx üçün smart-routing. Tam workbook üçün ~$0.13 başa gəlir (testdə 23 vərəq / 14 entity). Yeni adapterlər yoxdur — AI özü növü müəyyənləşdirir və düzgün pipeline seçir.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Məqsəd:** bütün əhəmiyyətli dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanılır.

### Nə yazılır
- Bütün idxallar (filename, dəyişdirilmiş sətrlər, status)
- Bütün mapper applies
- Rol dəyişiklikləri
- Indicator overrides
- LLM çağırışları (model, prompt version, tokens, fromCache)
- **Soft-delete və physical purge** (Phase 1.4 cron)

### Filtrlər
- **Action** — hadisə növü
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix diapazonu
- **Düymələr:** Apply / Reset

### Nəyi yoxlamaq lazımdır
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` qeydləri görünür
- ACTOR sütunu — əl ilə hərəkətlər üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Qeydlər yuxarıdan yenilər üzrə çeşidlənib

---

## 12. Özünüyoxlama çek-listi

Bu siyahını **indi** keçin, canlı tətbiqdə klikləyərək. Əgər nəsə uyğun gəlmirsə — haradasa baq var, düzəlişi növbəyə qoymaq lazımdır.

### Əsas naviqasiya
- [ ] `/login` → admin kimlik məlumatları ilə girin → `/budgeting`-ə yönləndirmə
- [ ] Sidebar 6 bənd göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ yuxarı küncdə tema keçiricisi (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN yanında `Sub` etiketi, AZSF yanında — `Opq` + `NoD`
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətri göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: «Today's brief» yüklənir, mətn «subsidy-regime» və ya «non-transparent» qeydlərini ehtiva edir (bu risk bayraqlı AI Morning Brief-dir)
- [ ] Qırmızı xana EDEN row, CUSTOMER_HHI sütununa klik → Panel 3 `counterparty_hhi_customer` formulasını göstərir
- [ ] `Explain →` klikləyin → ~15s sonra narrative + 3 tövsiyə görünür
- [ ] Tövsiyə #3-də **subsidy dependency** (və ya əlaqəli) ifadə ilə sitat var

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI başlığı mövcuddur (nəsə «Food processing margin squeeze...» tipli)
- [ ] Holding composite score = **59** (yazı anında)
- [ ] Aşağı sürüşdürün → **«Qualitative Risk Flags»** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` çip (sarı)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri mövcuddur

### Büdcələmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Üzərinə gələndə tooltip ilə Waterfall chart (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçicisi `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — PENDING ilə yeganə
- [ ] Qalanları ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Lendinq 4 qrupda 16 kart göstərir
- [ ] `Импорт данных` və `Indicator Health` kartları `Phase 7 M` badge ilə işarələnib
- [ ] Bütün kartlar kliklənə bilər

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 файл` / `Несколько файлов` (yeni `новое` ilə işarələnib)
- [ ] Drop-zone mövcuddur
- [ ] `Шаг 1: AI-анализ листов` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Xəta koduna görə breakdown görünür
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity-dən ibarət cədvəl Score asc üzrə çeşidlənir (ən pis birinci)
- [ ] Aşağıda HORIZON və PROMALT MMC Thin tier ilə
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Действие / Тип данных / Компания / Год / Причина / `ALL` təsdiq sahələri ilə forma
- [ ] Radio `Архивировать (скрыть из расчётов)` standart olaraq seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda 8 entity ilə Role & Status cədvəli
- [ ] Aşağıda açılan kartlarla «Настройки компаний»
- [ ] EDEN kartının içərisində — 8 kateqoriya ilə **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddilik `● ● ●` nöqtələri (emerald / amber / rose) ilə göstərilir

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 xana **qırmızı** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 hal, hamısı iddiaçı kimi)
- [ ] Qırmızı xana AZSF/AUDIT_MAJOR_OPEN-a klik → Variance Explainer Major findings-i sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisələr cədvəli, yuxarıda yenilər
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` qeydləri mövcuddur
- [ ] SUMMARY tokens + language + fromCache ilə JSON ehtiva edir

### AI çağırışları (Audit Log vasitəsilə)
- [ ] Son 24 saat ərzində ən azı bir `ai_variance_explainer_run`
- [ ] Bu gün üçün `ai_morning_brief_run` var
- [ ] `ai_board_deck_narration_run` var (Board Deck açılarkən yaradılır)
- [ ] Eyni parametrlərlə təkrar sorğular üçün `fromCache: true`

---

## Nəsə pozularsa hara müraciət etmək

| Simptor | Hara baxmaq |
|---|---|
| Composite score yenidən hesablanmadı | `Risk Terminal → Recompute` düyməsi |
| AI brief köhnədir | Audit Log → son `ai_morning_brief_run` tapın → `fromCache` yoxlayın |
| HeatMap boşdur | `Indicator Health` → UNKNOWN breakdown yoxlayın |
| İdxal düşdü | `Admin → Drift Dashboard` → son events |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat növü + il + səbəb seçin → ALL |
| Dövrü təsadüfən bağladılar | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki detallar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** `@anthropic-ai/sdk` vasitəsilə serverside caching ilə Anthropic Claude
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Migration policy:** bütün migrasiyalar Prisma vasitəsilə + audit; 90 günlük fiziki purge cron ilə soft-delete
- **Cost guard rails:** rate-limits + token budgets + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N-in (bütün 4 kanalda risk bayraları) bağlanmasından sonra yaradılıb.
> Skrinşot mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

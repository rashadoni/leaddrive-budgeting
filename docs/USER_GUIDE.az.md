# BudgetPro — İstifadəçi Təlimatı

> **Enterprise Holding Risk Terminal**
> Bu nədir, necə istifadə etmək olar, nəyi və harada yoxlamaq lazımdır.
> Müştəri, maliyyə direktoru və holdinq administratoru üçün.

---

## Mündəricat

1. [Bu nədir və nə üçündür](#1-bu-nədir-və-nə-üçündür)
2. [Giriş və naviqasiya](#2-giriş-və-naviqasiya)
3. [Risk Terminal — maliyyəçinin iş günü](#3-risk-terminal--maliyyəçinin-iş-günü)
4. [Board Deck — şura üçün görüntü](#4-board-deck--şura-üçün-görüntü)
5. [Büdcələşdirmə](#5-büdcələşdirmə)
6. [Yeni şirkətin onboardinqi](#6-yeni-şirkətin-onboardinqi)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel-in idxalı](#8-ai-auto-import--istənilən-excel-in-idxalı)
9. [Risk Registry — keyfiyyət risk bayraqları](#9-risk-registry--keyfiyyət-risk-bayraqları)
   - [9.1 Compliance & Legal — real göstəricilər](#91-compliance--legal--real-göstəricilər-audit-hesabatlarından-və-məhkəmələrdən)
   - [9.2 Concentration — gəlirinizi kim saxlayır](#92-concentration--gəlirinizi-kim-saxlayır)
10. [AI funksiyaları — nə, harada, nə qədər başa gəlir](#10-ai-funksiyaları--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nə üçündür

**BudgetPro — 60+ şirkətdən ibarət holdinqin CFO-su üçün terminaldir.**

Bir məqsəd: səhər 5 dəqiqəyə **hansı şirkətlərinizin indi risk zonasında olduğunu**, **nəyə görə** və **bununla nə etmək lazım olduğunu** başa düşmək.

### Sistemin cavab verdiyi üç səviyyəli suallar

| Sual | Hara baxmalı | Nə qədər vaxt |
|---|---|---|
| «Bu gün nə yanır?» | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| «Bu göstərici niyə qırmızıdır?» | **Variance Explainer** (xanaya klik → Explain) | 10 saniyə + ~15 saniyə AI |
| «Direktorlar şurasına nə göstərmək olar?» | **Board Deck** — bir kliklə PDF/PPTX | 20 saniyə |

### Daxilində nələr var
- **AZSEKER holdinqinin 6 canlı entity** (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 göstərici** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat)
- **AI-agentlər** Anthropic Claude əsasında: Excel təsnifləşdiricisi, fərq izahedicisi, Board Deck generatoru, səhər brifinqi
- **Tam audit-trail** — hər dəyişiklik 365 gün müddətinə IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya sizin production domeniniz.

![Login](guide/screenshots/01-login.webp)

Kredensialları sistem administratoru verir. Əgər siz həmin administrator iseniz və stendin yerləşdirilməsini yenicə bitirmisinizsə — parol `scripts/create-admin.ts`-dən və ya deployment sirlərinizdəndir.

> 🔒 Açıq sənədləşməyə parollar dərc edilmir.

### 2.2 Yan naviqasiya

Girişdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nə üçün |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-üslublu terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün görüntü (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yenilərin idxalı |
| 📜 | **Audit Log** | Bütün mühüm dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + seçimlər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

Bu **əsas ekrandır**. Səhər açırsınız — lazım olan hər şey buradadır.

### Dörd panel

#### Panel 1 · Company Tree (sol yuxarıda)
Holdinqin bütün şirkətlərinin ağacı, hər biri üçün **composite-score** nişanı ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı göstəricilərin sayı
- **Çiplər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk bayraqları (bölmə 9-a bax)

**Nəyi yoxlamaq:** şirkətə klik → sağdakı HeatMap bu şirkətə görə filtrlənir.

#### Panel 2 · Risk HeatMap (sağ yuxarıda)
**Matris: şirkətlər × göstəricilər.** Xananın rəngi = status (yaşıl/sarı/qırmızı/m/y).

Hər xana təkcə rənglə deyil, həm də **forma** ilə işarələnib (▲ / ● / ○) — clinical color-blind təhlükəsizliyi üçün (Phase M7 reqressiya skanı geri çəkilməni qadağan edir).

Yuxarıda:
- Rüb filtri (2026 / Q1...Q4 / M1...M12)
- `Material only` — tətbiq olunmayan göstəriciləri gizlət
- Sayğac: `54G / 30A / 16R / 88?`

**Nəyi yoxlamaq:** kursorunuzu xanaya aparın → tooltip rəqəm + planlı diapazonla.

#### Panel 3 · Indicator Detail (sol aşağıda)
Defolt olaraq **«Today's brief»** göstərir — səhər AI-brifinqi.

HeatMap xanasına klik zamanı **göstərici təfərrüatına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Həll edilmiş dəyişənlər
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (sağ aşağıda)
- Defolt: «Pick a HeatMap cell, then click Explain →» məsləhəti
- Şirkətə klik sonra: **Company Snapshot** (top xəbərdarlıqlar + breakdown)
- `Explain →` kliki sonra: **AI Variance Explainer** — narrative + 3 tövsiyə

### 60 saniyəyə nəyi yoxlamaq
1. AZSEKER ağacını açın → composite-score ilə 7 sub-co olmalıdır
2. Qırmızı xanaya klikləyin → Panel 3 formulu göstərəcək, Panel 4 — Explain düyməsi
3. Explain basın → təxminən 15 saniyədən sonra TOP DRIVERS və RECOMMENDATIONS ilə narrative görünəcək
4. Aşağıda — EVENTS lenti (son LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — şura üçün görüntü

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Məqsəd:** direktorlar şurası üçün bir səhifəlik sənəd. Açırsınız → oxuyursunuz → «Print to PDF» basırsınız → çata göndərirsiniz.

### Nələr var
1. **Başlıq-narrative** — AI *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir cümlə generasiya edir
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — kim planla müqayisədə ən çox yuxarı/aşağıdır
4. **Alerts** — həddlərin kritik pozuntuları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk bayraqları olan şirkətlər bölməsi

### Keyfiyyət riskləri bölməsinin ekran görüntüsü (səhifənin aşağısı)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Burda görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraqlar **avtomatik olaraq şirkətin composite score-nu azaldır** və səhər brifinqinə düşür (bölmə 9-a bax).

### İxrac düymələri
- `Export PPTX` — bayt-ba-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzer çapı
- `Open Risk Terminal →` — drill-down üçün canlı terminalə keçid

---

## 5. Büdcələşdirmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**Bu «adi» FP&A workspace-dir** — maliyyəçinin Excel-də etdiyi işi indi burada edir.

### Sol sidebar — işin strukturu

**FINANCE** — üç klassik hesabat:
- 📈 **P&L** — mənfəət və zərər haqqında hesabat
- 💰 **Sales** — satışların təfərrüatı
- 📑 **Balance Sheet** — balans
- 💸 **Cash Flow** — pul hərəkəti
- 📐 **Assumptions** — model üçün fərziyyələr

**PLANNING** — nə planlaşdırırıq:
- 🗂️ **Workspace** — büdcənin əsas ekranı (ekran görüntüsündə)
- 📊 **P&L (Plan)** — P&L formatında plan
- 🔮 **Forecast** — proqnoz
- ⚖️ **Comparison** — plan vs fakt vs forecast
- 📅 **Plans** — bütün planların siyahısı

**ANALYTICS** — ixtiyari kəsiklər üçün Report Builder.

**SETTINGS** — Import / Configuration.

**ADMIN** — dərin parametrlər (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← burda Risk Registry**).

### Workspace əsas ekranında nələr var
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** execution % və variance ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — ətraflı cədvəl

### Nəyi yoxlamaq
1. Yuxarıda başlığın sağında — plan seçicisi (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Aşağıda sağda — `AI Analysis` düyməsi (bənövşəyi)

---

## 6. Yeni şirkətin onboardinqi

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxiletməsinin gedişatını göstərmək və «boş» bölmələri tamamlamağa kömək etmək.

### Nələr görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana şirkət, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng vurğulanması:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

### Bizim demoda nələr göstərilib

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

**Nəyi yoxlamaq:** karta klik → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğunu, hansılarının tamamlanmasının lazım olduğunu göstərən təfərrüat açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**Bu «mühəndislik panelidir»** — **müştəri demosundan əvvəl** və gündəlik dəstək üçün istifadə etmək lazımdır.

### Dörd qrup

#### 🧪 Data Ingestion (məlumat yükləmə)
| Kart | Nə edir |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | İstənilən xlsx-in drag-drop → AI tipi müəyyən edir (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adapter-ə yönləndirir. 5 fərqli forma əvəzinə bir ekran. |
| **Data Entry** | Mühəndis olmayan admin üçün KPI və ESG açıqlamalarının əl ilə daxil edilməsi. |
| **Data Sources Catalog** | Müştəri üçün xarici feed-lərin siyahısı: biznes dəyəri, nümunə dəyəri, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazə verilmiş xlsx-mənbələrin siyahısı. |

#### 🩺 Data Quality (məlumat keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Göstərici üzrə yaşıl/sarı/qırmızı/naməlum remediation təlimatı ilə. Müştəri demosundan **əvvəl** istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + reference-feed təravəti + dayandırılmış onboarding halları. |
| **Companies Readiness** | Entity üzrə 7 sahə üzrə qiymətləndirmə tier-lərlə (complete/good/partial/thin/empty). CSV ixrac. |
| **Data Archive** | Özünə xidmət arxivi + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | Xarici feed adapter statusu + son crawl-lar + xəbər boru kəməri diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — bağlı dövrlərin mutasiyalardan bağlanması
- **Approvals** — dəyişikliklərin razılaşdırılması üçün iş prosesi
- **AI Usage** — 30 günlük trenddə LLM xərclərinin monitorinqi

#### 👥 Access (girişlər)
- **User Access** — istifadəçi və rol idarəetməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demodan əvvəl yoxlanmalı

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (1201 total IV-dən 43.6% hesablanıb)

**Unknown breakdown səhv kodu üzrə:**
- `eval: 430` — formullar uğursuz oldu
- `non_finite: 123` — sıfıra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbə yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problemli konkret göstəricilərin siyahısı + bir sətirdə remediation.

**Demodan əvvəl nəyi yoxlamaq:**
1. **AGRO_COMMODITY_VOL** → 75 xana, araşdırmalı
2. **FP_INVENTORY_TURNS** → 49 xana, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 xana, istehsal KPI-də `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 xana, entity üzrə `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq şəbəkəsi

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

7 sahə üzrə entity-başına qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tier-i qaldırmaq üçün nə əlavə etmək lazımdır

**Ekranda görünür:**
- HORIZON 15% Thin → P&L (budget lines), balance sheet, counterparties lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → operational KPIs, strategic narrative, FX tags lazımdır
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** düyməsi e-mail üçün gap-list-i kopyalayır.

### 7.3.6 Indicator Backlog — şirkət üzrə nə çatışmır

**URL:** `/budgeting/admin/indicator-backlog`

**Məqsəd:** «entity üzrə nə yüklənməyib» görünən tam bir səhifə — faydasız işarələr olmadan, konkret action-planla.

**Struktur:**
- **5 xülasə kartı:** Entities / Applicable indicators / With data / Missing / Overall readiness %
- **By-owner aggregate** — klikləmə mümkün olan nişanlar «Risk Officer owes 5 items», «Sales Director owes 12», «CFO owes 8»
- **Filtrlər:** Category / Owner / Hide entities with 0 missing
- **Entity üzrə kartlar** iki sütunla: **«Has data»** (artıq doldurulmuş göstəricilərlə yaşıl çiplər) və **«Needs data»** (owner + action ilə çəhrayı sətirlər)

**Çiplər və sətirlər oxunaqlı adı (RU) göstərir**, texniki kod isə (`AGRO_COMMODITY_VOL`, `FP_INVENTORY_TURNS` və s.) kiçik monospace şrifti ilə yanında və ya mouseover zamanı tooltip-də göstərilir. Bu maliyyə personalının abbreviatura öyrənməməsi üçün edilib — amma developer/AI-import ilə ünsiyyətdə kod əlaltındadır.

**Sətir üzrə hərəkətlər:**
- 📧 **Email** — owner-ə tələb olunan məlumatların konkret siyahısı ilə əvvəlcədən doldurulmuş məktub bədəni olan mailto: açır
- ⬆️ **Upload file** (entity-level) — `/admin/ai-import?forEntity=AZSEKER-AZSF`-ə deep-link
- 📥 **CSV** (entity-level) — müştəriyə göndərmək üçün gap-list ixracı
- 📨 **Email all owners** (entity-level) — owner üzrə qruplaşdırma ilə bulk mailto

**AI Auto Import ilə inteqrasiya:**
`/admin/ai-import`-da uğurlu idxaldan sonra banner görünür:
> ✅ Indicator Backlog-dan 7 maddə bağlandı
> - AZSEKER-AZSF → AUDIT_CLOSED_PCT
> - AZSEKER-CPC → AUDIT_MAJOR_OPEN
> - ...
> [Indicator Backlog-u aç →]

**Owner mapping** — kim nəyə görə cavabdehdir:

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

**Təşkilat üzrə fərdiləşdirmə:** hər təşkilat üçün (FO Holding, gələcəkdə azmade / tabia) owner mapping `Organization.settings.dataOwners` JSON vasitəsilə yenidən müəyyən edilə bilər — real adlar və e-mail-lər əlavə edin. Override olmadan ümumi rol etiketi istifadə olunur.

### 7.3.5 Compliance Hub — audit tapıntıları + məhkəmələr vahid ekranı

**URL:** `/budgeting/admin/compliance`

**Məqsəd:** compliance/legal officer üçün bir səhifə — 6 entity üzrə bütün 218 audit tapıntısı (Major/Minor/Observation/OFI) + 54 məhkəmə işi, filtrlər və CSV-ixracla.

**Nələr var:**
- **2 tab** — Audit findings / Court cases
- Aktiv tab üçün yuxarıda **5 xülasə kartı** (audit üçün Total / Open / Major / Minor / Observation; məhkəmələr üçün Total / Open / Defendant / Plaintiff / Money claims)
- **Rəng kodlaşdırması ilə cədvəl** severity-çipləri: Major (qızılgül), Minor (kəhrəba), Observation (slate), OFI (göy)
- **Filtrlər:** Entity (6-dan biri) / Severity / Status (Open/Closed/All)
- **Export CSV** zaman damğası olan fayl adı ilə filtrlənmiş kəsik

**Məlumatlar haradan:** Phase 7.N-dən artıq DB-də (`Company.settings.auditFindings.items` + `courtDisputes.cases`). Heç bir yeni cədvəl yoxdur.

**Nəyi yoxlamaq:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 total → CSV 159 sətir verməlidir
- CPC ct: 8 iş, hamısı açıq, 7-si cavabdeh kimi
- Filtr `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → 6 sətir olmalıdır

### 7.3 Data Archive — restore ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Nə üçün:** idxalda səhv etdiniz → sətirləri hesablamadan çıxarmaq lazımdır, **amma IFRS-auditi üçün fiziki silmək olmaz**.

**Necə işləyir:**
- Arxivləşdirmə məlumatları HeatMap, recompute, hesabatlardan gizlədir
- Fiziki olaraq məlumatlar **silinmir** — **90 gün** ərzində bərpa mümkündür
- Bütün hərəkətlər audit trail-ə yazılır
- 90 gündən sonra — daily cron `soft-delete-purge` fiziki olaraq silir

**Forma:**
- **Hərəkət:** Arxivləşdir / Bərpa et
- **Tip:** P&L / BS / CF / Counterparty
- **Şirkət + İl**
- **Səbəb** (audit log-a düşür)
- **Təsdiq:** səhvi istisna etmək üçün `ALL` daxil edin

---

## 8. AI Auto Import — istənilən Excel-in idxalı

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.webp)

**Bu əl ilə mapping-in qatilidir.** Phase 7.M Tier 7-yə qədər hər yeni xlsx kod tələb edirdi. İndi:

### Necə işləyir (5 faza)
1. **AI Classifier** (Anthropic) — vərəqin dataType-ını müəyyən edir: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — reyestrdən düzgün adapteri seçir (11 dataTypes)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — hər idxal mənbə ilə yoxlanılır
5. **GREEN verdict** — uyğunsuzluq yoxdur və ya diff görürsünüz

### İki rejim
- **`1 файл`** — standart, bir workbook üçün
- **`Несколько файлов`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - Eyni zamanda 1-10 fayl
  - **Group-level atomicity** — ya bütün qruplar yazılır, ya da heç biri
  - **Cross-file conflict detection** — iki fayl eyni xanaya fərqli şey yazırsa → diff ilə 409
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nəyi yoxlamaq
1. İstənilən xlsx-i `Перетащите xlsx файл сюда` zonasına drag-drop edin
2. `Шаг 1: AI-анализ листов` basın
3. AI təsnifat + plan import təklif edəcək
4. Təsdiq edirsiz → fayl idxal olunur → avtomatik recompute

### Preview: confidence + təsirlənən göstəricilər (2026-05-27)

«Шаг 1: Анализ AI»-dən sonra hər vərəq üzrə üç təbəqə məlumat görünür:

| Nəyi göstərir | Nə üçün |
|---|---|
| **dataType chip** (tipə görə rəngli) | dərhal AI-nin vərəqi hansı kateqoriyaya aid etdiyini görün — PLF / BS / KPI_FARMING / OPS_FACTS / ... |
| **Confidence bar + «высокая · 92%»** | AI təsnifatda nə qədər əmindir (yaşıl ≥85% / sarı 65-84% / qırmızı <65% «⚠ проверить») |
| **«Затронет N показателей: …»** çiplərlə | Apply-dan sonra məlumat alacaq konkret göstəricilərin siyahısı (rusca + kiçik monospace technical-kod) |

Bu AI səhvini məlumatlar DB-yə düşməzdən **ƏVVƏL tutmağa** imkan verir. Əgər confidence qırmızıdırsa və ya «Затронет» siyahısı gözlədiyinizə bənzəmirsə — vərəqi aydın adla yenidən adlandırın və yenidən yükləyin.

**Təsnifləşdiricinin dəqiqliyi:**

| Confidence | Təxmini səhv ehtimalı | Hərəkət |
|---|---|---|
| ≥85% (yaşıl) | ~2–5% | Təhlükəsiz tətbiq edin |
| 65–84% (sarı) | ~10–20% | «Затронет»-ə baxın — düzgündürsə, tətbiq edin |
| <65% (qırmızı) | ~30–50% | Əl ilə yoxlama olmadan tətbiq etməyin |

**AZSEKER üçün nəzarət nöqtəsi:** real `Guvven Fin.xlsx`-də AI 23/23 dataType + 14/14 entity tutdu (100%). Amma bu aydın strukturlu bir fayldır; qeyri-standart workbook-da % düşür.

### Məhdudiyyətlər
- Single file: ≤ 20 MB
- Multi file: ≤ 10 fayl, ≤ 20 MB total
- Rate limit: saat/org-a 3 multi-file idxal
- Cost cap: əvvəlcədən yoxlanılır (N × 35K tokens)

---

## 9. Risk Registry — keyfiyyət risk bayraqları

**URL:** `/budgeting/admin/companies` → **«Настройки компаний»** bölməsi → şirkət kartını aç

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**Bu ən yeni xüsusiyyətdir (Phase 7.N, may 2026).** HeatMap kəmiyyətcə göstərməyən keyfiyyət maliyyə-əməliyyat riskləri.

### Üç kanonik bayraq

| Bayraq | Emoji | Nə deməkdir | Composite-ə cəza |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja əhəmiyyətli dərəcədə subsidiyalardan və ya tənzimlənən qiymətlərdən asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Related-party və ya unaudited cost-allocation pattern | **−8** |
| `data_absence` | ⚪ | Əsas maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq
1. `/budgeting/admin/companies`
2. **«Настройки компаний»** bölməsi (səhifənin aşağısı)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **«Risk Registry»**-ni tapın — 8 kateqoriya üzrə ciddilik nöqtələri `● ● ●` (zümrüd → kəhrəba → qızılgül) ilə sıralanıb
5. Lazımi bayrağa klikləyin — vurğulanacaq, saxlamadan sonra cəza tətbiq olunacaq

### Bu bayraqlar hara düşür (4 kanal, end-to-end yoxlanılıb)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (adın yanında `Sub` / `Opq` / `NoD` çipləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (*«exposure to government policy/subsidy regime»* tipli ifadələr) |
| **Board Deck section** | Board Deck → FLAGGED ENTITIES sayı ilə **«Qualitative Risk Flags»** bölməsi |
| **Variance Explainer** | Risk Terminal → xanaya klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### Cari DB vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **composite-ə −20**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Entity üzrə ətraflı Risk Registry

3 kanonik bayraqdan əlavə, hər şirkətin ətraflı risk reyestri (KRI list) ola bilər — admin-paneldə göstərilir:
**`/budgeting/admin/companies` → şirkət kartını açın → «Risk Registry» bölməsi**.

**Cari vəziyyət:**

| Entity | KRIs | Mənbə |
|---|---|---|
| **EDEN** | 15 | `Top risk - EDEN AGRO MMC.xlsx` (müştəridən fayl) |
| **AZSF / CPC / MALT / HORIZON / PROMALT / FARM** | 0 | ⏳ Pending — Nəcəf M-dən gözlənilir (CARRYOVER L2) |

Qalan entity-lər üçün reyestrlər **qəsdən doldurulmayıb** — biz riskləri özümüz generasiya etmirik, holdinqin Risk Officer-indən real KRI-lar gözləyirik. Burda uydurma məlumat olmamalıdır: maliyyə CFO-su bu göstəricilərlə qərar qəbul edir.

---

## 9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real göstəricilər

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → «Compliance» bölməsi

Müştərinin fayllarından qidalanan üç yeni göstərici (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanmış audit qeydlərinin % (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### DB-də indi nələr var (live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştərinin fayllarında məlumat yoxdur | | |

### Haradan gəlir

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlı, 6 Major açıq). CPC = 59 tapıntı (39% bağlı, 3 Major açıq). Drill-down üçün `Company.settings.auditFindings` vasitəsilə tam siyahı əlçatandır.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reyestri: 54 iş. AZSF — 26-da cavabdeh (29 açıq). CPC — 7-də cavabdeh (8 açıq). EDEN — yalnız iddiaçı (4 açıq). Tam reyestr `Company.settings.courtDisputes`-dadır.

### Nəyi yoxlamaq
- HeatMap-də 3 yeni sütun görünür (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- Qırmızı xana AZSF/AUDIT_MAJOR_OPEN-ə klik → Variance Explainer narrative-də açıq Major tapıntılarını sitat gətirməlidir
- Board Deck → «Critical alerts» bölməsi indi compliance/legal xəbərdarlıqları ehtiva edir

> **İş üzrə risk-altındakı məbləğ (AZN):** 2026-05-27-də göstəricilərdən silindi. Regex 54 işdən yalnız 4-ünü əhatə edirdi (7%) — yanıltıcı floor estimate. Hüquq Şöbəsindən claim amounts-un tam reyestri gələndə yenidən həyata keçiriləcək.

---

## 9.2.5 FX risk — gəlirin hansı hissəsi məzənnəyə həssasdır

**Harada:** Risk Terminal → HeatMap sütunu `REVENUE_FX_EXPOSURE`.

`Company.settings.fxRevenueAzn/Usd/Eur/Rub`-da saxlanılır — hər valyutada gəlirin %-i. Formula: **100 − fxRevenueAzn** = % non-AZN.

**Cari vəziyyət:**

| Entity | AZN | USD | EUR | FX Exposure | Mənbə |
|---|---|---|---|---|---|
| **CPC** | 84% | 14% | 2% | 🟢 16% | `Farming strategy/Sales plan` — real volume splits 2027-2035 |
| AZSF / MALT / EDEN / HORIZON / PROMALT | — | — | — | ⚪ Pending | N. Nəcəfzadə-dən «Müştəri İcmalı» faylı gözlənilir (CARRYOVER L1) |

Yalnız CPC-nin real məlumatı var (müştərinin forward plan-dan hesablanıb). Digər 5 entity üçün split-i qəsdən doldurmayırıq — verifikasiya olunmuş per-customer FX breakdown gələnə qədər `REVENUE_FX_EXPOSURE` `unknown` göstərir.

**Həddlər:**
- 🟢 ≤ 20% — daxili bazar dominantdır
- 🟡 20–50% — qarışıq ekspozisiya
- 🔴 > 50% — FX dəyişmələri gəlirdə dominantdır

**`FX_IMPORTED_INPUT` ilə əlaqə** (cost-side): hamısında revenue split olanda iki göstərici birlikdə **NET FX position** verəcək. Əgər cost ≈ revenue eyni valyutada → natural hedge.

---

## 9.2 Concentration — gəlirinizi kim saxlayır

**Harada:** Risk Terminal → HeatMap (3 sütun) + Board Deck → top movers/alerts.

HHI-dən əlavə (riyazi cəhətdən doğru, lakin CFO-ya pis kommunikasiya olunur) **birbaşa konsentrasiya göstəriciləri** əlavə etdik, hansı ki dərhal oxunur:

| Code | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman index (riyazi konsentrasiya) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | **Bir** ən böyük müştəridən gəlirin %-i | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | **Top-3** ən böyük müştəridən gəlirin %-i | ≤ 50% | 50–75% | > 75% |

### Live məlumatlar

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Kim dominantdır |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | ümumiyyətlə 2 müştəri |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | ehtimal ki AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg single-buyer |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (qənnadı) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ məlumat yoxdur | ⚪ | ⚪ | (Azersun ilə JV) |

### Hər iki göstərici nə üçün
- **TOP_CUSTOMER_SHARE** — «bir müştərinin itirilməsi» (məsələn AZSF Bakı Şirniyyat-ı itirir → bir gecədə −32% revenue)
- **TOP3_CUSTOMER_SHARE** — «long-tail sağlamlığı» (MALT 80% top-3-dən sonra demək olar ki heç nə yoxdur — hamısı gedərsə əvəz etmək mümkün deyil)
- **CUSTOMER_HHI** — akademik cəhətdən düzgün ölçü, tənzimləyicilər / due diligence üçün

---

## 10. AI funksiyaları — nə, harada, nə qədər başa gəlir

Bütün LLM çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost mode + retry policy).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → «Today's Brief» bölməsi

**Nə edir:** günün risk-klasterini bir cümlə ilə təsvir edir + sektorlar üzrə «top worst»-u sadalayır. Keyfiyyət risk bayraqlarını nəzərə alır.

**Çıxış nümunəsi (canlı, DB-dən):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ yuxarı küncündə keçid).

**Keş necə işləyir:** prompt mətni + dataset hash-ın sha256. Promptu dəyişdiririk → köhnə keş avtomatik olaraq etibarsızlaşır.

### 10.2 Variance Explainer (fərq izahedicisi)

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

Diqqət yetirin — tövsiyə #3 Risk Registry səhifəsindən `subsidy_dependency` risk bayrağını sitat gətirir.

**Dəyər:** çağırış üçün ~1200 in + ~240 out tokens (~ $0.01).

### 10.3 Board Deck Narration

**Harada:** Board Deck açılanda avtomatik generasiya olunur.

**Nə edir:** kəmiyyət siqnallarını *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir cümlə başlığına çevirir.

(orgId, period)-də keşlənir — maksimum saatda bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylın drag-drop.

**Nə edir:** istənilən xlsx üçün smart-routing. Tam workbook üçün ~$0.13 (testdə 23 vərəq / 14 entity). Yeni adapterlər yoxdur — AI özü tipi müəyyən edəcək və düzgün pipeline seçəcək.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Məqsəd:** bütün mühüm dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanılır.

### Nələr yazılır
- Bütün idxallar (filename, dəyişdirilmiş sətirlər, status)
- Bütün mapper applies
- Rol dəyişiklikləri
- Indicator overrides
- LLM çağırışları (model, prompt versiyası, tokens, fromCache)
- **Soft-delete və physical purge** (Phase 1.4 cron)

### Filtrlər
- **Action** — hadisə tipi
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix diapazonu
- **Düymələr:** Apply / Reset

### Nəyi yoxlamaq
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` qeydləri görünür
- ACTOR sütunu — əl ilə hərəkətlər üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Qeydlər yenilər yuxarıda olmaqla sıralanıb

---

## 12. Özünüyoxlama çek-listi

Canlı tətbiqdə klikləyərək **indi** bu siyahıdan keçin. Əgər nəsə uyğun gəlmirsə — hardasa bug var, düzəliş növbəyə qoyulmalıdır.

### Əsas naviqasiya
- [ ] `/login` → admin kredensialları ilə girmək → `/budgeting`-ə redirect
- [ ] Sidebar 6 maddə göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ yuxarı küncdə tema keçidi (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN yanında `Sub` nişanı, AZSF yanında — `Opq` + `NoD`
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətiri göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: «Today's brief» yüklənir, mətn «subsidy-regime» və ya «non-transparent» qeydləri ehtiva edir (bu risk bayraqları ilə AI Morning Brief)
- [ ] EDEN sətiri, CUSTOMER_HHI sütunu qırmızı xanaya klik → Panel 3 `counterparty_hhi_customer` formulunu göstərir
- [ ] `Explain →` klikləyin → təxminən 15 saniyədən sonra narrative + 3 tövsiyə görünür
- [ ] Tövsiyə #3-də **subsidy dependency** (və ya əlaqəli) ifadə sitat gətirilir

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI-başlığı var (nəsə «Food processing margin squeeze...» tipli)
- [ ] Holding composite score = **59** (yazı zamanı)
- [ ] Aşağı sürüşdürün → **«Qualitative Risk Flags»** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` çipi (kəhrəba)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (qızılgül) + `Data absence` (slate)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri var

### Büdcələşdirmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Waterfall chart mouseover zamanı tooltip ilə (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçicisi `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — PENDING olan yeganə
- [ ] Qalanları ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Lending 4 qrupda 16 kart göstərir
- [ ] `Импорт данных` və `Indicator Health` kartları `Phase 7 M` nişanı ilə işarələnib
- [ ] Bütün kartlar klikləmə mümkündür

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 файл` / `Несколько файлов` (yenisi `новое` ilə işarələnib)
- [ ] Drop-zone var
- [ ] `Шаг 1: AI-анализ листов` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Səhv kodu üzrə breakdown görünür
- [ ] Filter çipləri: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity cədvəli Score asc (ən pis ilk) üzrə sıralanır
- [ ] HORIZON və PROMALT MMC Thin tier ilə aşağıda
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Hərəkət / Məlumat tipi / Şirkət / İl / Səbəb / `ALL` təsdiq sahələri ilə forma
- [ ] Radio `Архивировать (скрыть из расчётов)` defolt seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda 8 entity ilə Role & Status cədvəli
- [ ] Aşağıda açılan kartlarla «Настройки компаний»
- [ ] EDEN kartının içində — 8 kateqoriyalı **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddilik `● ● ●` nöqtələri ilə göstərilib (zümrüd / kəhrəba / qızılgül)

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 xana **qırmızı** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 iş, hamısı iddiaçı kimi)
- [ ] Qırmızı xana AZSF/AUDIT_MAJOR_OPEN-ə klik → Variance Explainer Major findings sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisələr cədvəli, yenilər yuxarıda
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` qeydləri var
- [ ] SUMMARY tokens + language + fromCache ilə JSON ehtiva edir

### AI çağırışları (Audit Log vasitəsilə)
- [ ] Son 24 saat ərzində ən azı bir `ai_variance_explainer_run`
- [ ] Bu gün üçün `ai_morning_brief_run` var
- [ ] `ai_board_deck_narration_run` var (Board Deck açılanda generasiya olunur)
- [ ] Eyni parametrlərlə təkrar sorğular üçün `fromCache: true`

---

## Nəsə xarab olarsa hara müraciət etmək

| Simptom | Hara baxmaq |
|---|---|
| Composite score yenidən hesablanmadı | `Risk Terminal → Recompute` düyməsi |
| AI brief köhnədir | Audit Log → son `ai_morning_brief_run` tapın → `fromCache` yoxlayın |
| HeatMap boşdur | `Indicator Health` → UNKNOWN breakdown yoxlayın |
| İdxal uğursuz oldu | `Admin → Drift Dashboard` → son events |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat tipi + il + səbəb seçin → ALL |
| Dövrü təsadüfən bağladılar | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki təfərrüatlar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** `@anthropic-ai/sdk` vasitəsilə serverside keşləşmə ilə Anthropic Claude
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band skaner + secret skaner (~150ms)
- **Migration policy:** Prisma + audit vasitəsilə bütün miqrasiyalar; 90-day physical purge cron ilə soft-delete
- **Cost guard rails:** rate-limits + token büdcələri + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N (bütün 4 kanalda risk bayraqları) bağlandıqdan sonra generasiya edilib.
> Ekran görüntülərinin mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

# BudgetPro — İstifadəçi Təlimatı

> **Enterprise Holding Risk Terminal**
> Bu nədir, necə istifadə etmək olar, nəyi və harada yoxlamaq lazımdır.
> Müştəri, maliyyə direktoru və holdinq admini üçün.

---

## Mündəricat

1. [Bu nədir və nə üçündür](#1-bu-nədir-və-nə-üçündür)
2. [Giriş və naviqasiya](#2-giriş-və-naviqasiya)
3. [Risk Terminal — maliyyəçinin iş günü](#3-risk-terminal--maliyyəçinin-iş-günü)
4. [Board Deck — şura üçün şəkil](#4-board-deck--şura-üçün-şəkil)
5. [Büdcələşdirmə](#5-büdcələşdirmə)
6. [Yeni şirkətin onboarding](#6-yeni-şirkətin-onboarding)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel-in idxalı](#8-ai-auto-import--istənilən-excel-in-idxalı)
9. [Risk Registry — keyfiyyət risk bayraqları](#9-risk-registry--keyfiyyət-risk-bayraqları)
   - [9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real göstəricilər](#91-compliance--legal--audit-hesabatlarından-və-məhkəmələrdən-real-göstəricilər)
   - [9.2 Concentration — gəlirinizi kim saxlayır](#92-concentration--gəlirinizi-kim-saxlayır)
10. [AI funksiyaları — nə, harada, nə qədər başa gəlir](#10-ai-funksiyaları--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nə üçündür

**BudgetPro — 60+ şirkətdən ibarət holdinq CFO-su üçün terminaldir.**

Bir məqsəd: səhər 5 dəqiqədə başa düşmək, **hansı şirkətləriniz hazırda risk zonasındadır**, **niyə**, və **bununla nə etmək lazımdır**.

### Sistemin cavab verdiyi üç səviyyəli suallar

| Sual | Harada baxmaq | Nə qədər vaxt |
|---|---|---|
| "Bu gün nə yanır?" | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| "Bu göstərici niyə qırmızıdır?" | **Variance Explainer** (xanaya klik → Explain) | 10 saniyə + ~15 saniyə AI |
| "Direktorlar şurasına nə göstərmək olar?" | **Board Deck** — bir kliklə PDF/PPTX | 20 saniyə |

### Nələr var
- **AZSEKER holdinqinin 6 canlı entity** (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 göstərici** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat)
- **AI agentlər** Anthropic Claude əsasında: Excel təsnifatçısı, sapma izahçısı, Board Deck generatoru, səhər brifinqi
- **Tam audit trail** — hər dəyişiklik 365 gün müddətinə IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya sizin produksiya domeniniz.

![Login](guide/screenshots/01-login.webp)

Kredensialları sistem administratoru verir. Əgər siz həmin administrator idiniz və stendin yerləşdirilməsini yenicə bitirmisinizsə — parol `scripts/create-admin.ts` faylında və ya deployment sirlərinizdədir.

> 🔒 Parollar açıq sənədləşməyə dərc edilmir.

### 2.2 Yan naviqasiya

Girdikdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nə üçün |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg üslubunda terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün şəkil (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yeni idxal |
| 📜 | **Audit Log** | Bütün əhəmiyyətli dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + seçimlər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

Bu **əsas ekrandır**. Səhər açırsınız — lazım olan hər şey buradadır.

### Dörd panel

#### Panel 1 · Company Tree (sol yuxarıda)
Holdinqin bütün şirkətlər ağacı hər biri üçün **composite-score** nişanı ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı göstəricilərin sayı
- **Çiplər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk bayraqları (bölmə 9-a bax)

**Nəyi yoxlamaq lazımdır:** şirkətə klik → sağdakı HeatMap bu şirkətə görə filtr olunur.

#### Panel 2 · Risk HeatMap (sağ yuxarıda)
**Matris: şirkətlər × göstəricilər.** Xananın rəngi = status (yaşıl/kəhrəba/qırmızı/n/d).

Hər xana təkcə rənglə deyil, həm də **forma** ilə işarələnib (▲ / ● / ○) — clinical color-blind təhlükəsizlik üçün (Phase M7 reqressiya skanı geri çəkilməni qadağan edir).

Yuxarıda:
- Rüb filtri (2026 / Q1...Q4 / M1...M12)
- `Material only` — tətbiq olunmayan göstəriciləri gizlət
- Sayğac: `54G / 30A / 16R / 88?`

**Nəyi yoxlamaq lazımdır:** kursoru xanaya çəkin → rəqəm + planlı diapazonla tooltip.

#### Panel 3 · Indicator Detail (sol aşağıda)
Default olaraq **"Today's brief"** — səhər AI brifinqi göstərir.

HeatMap xanasına klikdə **göstərici təfərrüatına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Resolved dəyişənlər
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (sağ aşağıda)
- Default: "Pick a HeatMap cell, then click Explain →" məsləhəti
- Şirkətə klikdən sonra: **Company Snapshot** (top xəbərdarlıqlar + breakdown)
- `Explain →` klikindən sonra: **AI Variance Explainer** — narrativ + 3 tövsiyə

### 60 saniyədə nəyi yoxlamaq olar
1. AZSEKER ağacını açın → composite-score ilə 7 sub-co görünməlidir
2. Qırmızı xanaya klikləyin → Panel 3 formulu, Panel 4 — Explain düyməsini göstərəcək
3. Explain-ə basın → ~15 saniyədən sonra TOP DRIVERS və RECOMMENDATIONS ilə narrativ peyda olacaq
4. Aşağıda — EVENTS lenti (son LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — şura üçün şəkil

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Məqsəd:** direktorlar şurası üçün bir səhifəli sənəd. Açırsınız → oxuyursunuz → "Print to PDF" basırsınız → çata göndərirsiniz.

### Nələr var
1. **Başlıq-narrativ** — AI bir cümlə generasiya edir, məsələn *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"*
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — planı ən çox kim aşır/aşağı salır
4. **Alerts** — hədd pozuntularının kritik halları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk bayraqları olan şirkətlərin bölməsi

### Keyfiyyət risklər bölməsinin ekran görüntüsü (səhifənin aşağısı)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Burada görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraqlar **avtomatik olaraq şirkətin composite score-nu azaldır** və səhər brifinqinə düşür (bölmə 9-a bax).

### Eksport düymələri
- `Export PPTX` — bayt-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzer çapı
- `Open Risk Terminal →` — drill-down üçün canlı terminalə keçid

---

## 5. Büdcələşdirmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**Bu "adi" FP&A workspace-dir** — maliyyəçinin Excel-də etdiyi işi indi burada edir.

### Sol sidebar — işin strukturu

**FINANCE** — üç klassik hesabat:
- 📈 **P&L** — mənfəət və zərər haqqında hesabat
- 💰 **Sales** — satışların təfərrüatı
- 📑 **Balance Sheet** — balans
- 💸 **Cash Flow** — pul vəsaitlərinin hərəkəti
- 📐 **Assumptions** — model üçün fərziyyələr

**PLANNING** — nəyi planlaşdırırıq:
- 🗂️ **Workspace** — büdcənin əsas ekranı (ekran görüntüsündə)
- 📊 **P&L (Plan)** — P&L formatında plan
- 🔮 **Forecast** — proqnoz
- ⚖️ **Comparison** — plan vs fakt vs forecast
- 📅 **Plans** — bütün planların siyahısı

**ANALYTICS** — ixtiyari kəsiklər üçün Report Builder.

**SETTINGS** — Import / Configuration.

**ADMIN** — dərin parametrlər (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← burda Risk Registry**).

### Əsas Workspace ekranında nələr var
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** icra % və variance ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — təfərrüatlı cədvəl

### Nəyi yoxlamaq lazımdır
1. Yuxarıda başlığın sağında — plan seçicisi (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Aşağıda sağda — `AI Analysis` düyməsi (bənövşəyi)

---

## 6. Yeni şirkətin onboarding

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxiletmə tərəqqisini göstərmək və "boş" bölmələri tamamlamağa kömək etmək.

### Nələr görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng vurğusu:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

### Demo nümunəmizdə göstərilən

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

**Nəyi yoxlamaq lazımdır:** karta klik → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğu və hansıların tamamlanmalı olduğu ilə detail açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**Bu "mühəndislik paneli"dir** — **müştəri demasından əvvəl** və gündəlik dəstək üçün istifadə edilməlidir.

### Dörd qrup

#### 🧪 Data Ingestion (məlumat yüklənməsi)
| Kart | Nə edir |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | İstənilən xlsx-i drag-drop → AI növü müəyyən edəcək (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adapterə yönəldəcək. 5 fərqli forma əvəzinə bir ekran. |
| **Data Entry** | Mühəndis olmayan admin üçün əl ilə KPI və ESG açıqlamalarının daxil edilməsi. |
| **Data Sources Catalog** | Müştəriyə yönəlmiş xarici feed siyahısı: biznes dəyəri, nümunə dəyər, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazə verilən xlsx mənbələrinin siyahısı. |

#### 🩺 Data Quality (məlumat keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Hər göstərici üzrə yaşıl/kəhrəba/qırmızı/naməlum remediation təlimatı ilə. Müştəri demasından **əvvəl** istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + istinad-feed təravəti + dayanmış onboarding halları. |
| **Companies Readiness** | Hər entity üzrə 7 sahədə qiymətləndirmə tier-lərlə (complete/good/partial/thin/empty). CSV eksportu. |
| **Data Archive** | Self-service arxiv + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | Xarici feed adapteri statusu + son taramalar + xəbərlər pipeline diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — dəyişikliklərdən bağlı dövrlərin bağlanması
- **Approvals** — dəyişikliklərin razılaşdırılması üçün iş axını
- **AI Usage** — 30 günlük trenddə LLM xərclərinin monitorinqi

#### 👥 Access (girişlər)
- **User Access** — istifadəçilərin və rolların idarə edilməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demədan əvvəl yoxlanılmalıdır

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (1201 ümumi IV-dən 43.6% hesablanıb)

**Xəta koduna görə unknown breakdown:**
- `eval: 430` — formullar uğursuz oldu
- `non_finite: 123` — sıfıra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbələr yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problemli konkret göstəricilərin siyahısı + bir sətirdə remediation.

**Demədan əvvəl yoxlamaq:**
1. **AGRO_COMMODITY_VOL** → 75 xana, araşdırılmalıdır
2. **FP_INVENTORY_TURNS** → 49 xana, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 xana, istehsal KPI-da `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 xana, hər entity üçün `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq şəbəkəsi

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

Hər entity üzrə 7 sahədə qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tier-i qaldırmaq üçün nə əlavə etmək lazımdır

**Ekran görüntüsündə:**
- HORIZON 15% Thin → P&L (büdcə sətirləri), balans, qarşı tərəflər lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → əməliyyat KPI-ları, strateji narrativ, FX teqləri lazımdır
- AZSF 80% Good → strateji narrativ, FX teqləri
- EDEN 83% Good → qarşı tərəflər, FX teqləri
- CPC 88% Complete → strateji narrativ, FX teqləri

**Export CSV** düyməsi email üçün gap-list-i kopyalayır.

### 7.3.5 Compliance Hub — audit tapıntıları + məhkəmələrin vahid ekranı

**URL:** `/budgeting/admin/compliance`

**Məqsəd:** compliance/legal officer üçün bir səhifə — 6 entity üzrə bütün 218 audit tapıntısı (Major/Minor/Observation/OFI) + 54 məhkəmə işi, filtrlərlə və CSV yükləməsi ilə.

**Nələr var:**
- **2 tab** — Audit findings / Court cases
- **Aktiv tab üçün yuxarıda 5 xülasə kartı** (audit üçün Total / Open / Major / Minor / Observation; məhkəmələr üçün Total / Open / Defendant / Plaintiff / Money claims)
- **Rəngli kodlaşdırılmış severity-chip-lərlə cədvəl:** Major (qızılgül), Minor (kəhrəba), Observation (şifer), OFI (səma)
- **Filtrlər:** Entity (6-dan biri) / Severity / Status (Open/Closed/All)
- **Export CSV** fayl adında timestamp ilə filtr olunmuş kəsik

**Məlumatlar haradan:** artıq Phase 7.N-dən bazada (`Company.settings.auditFindings.items` + `courtDisputes.cases`). Yeni cədvəllər yoxdur.

**Nəyi yoxlamaq lazımdır:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 ümumi → CSV 159 sətir verməlidir
- CPC ct: 8 iş, hamısı açıq, 7-si cavabdeh kimi
- Filtr `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → 6 sətir olmalıdır

### 7.3 Data Archive — bərpa ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Nə üçün:** idxalda səhv etdiniz → sətirləri hesablamadan çıxarmaq lazımdır, **amma IFRS auditi üçün fiziki olaraq silməmək**.

**Necə işləyir:**
- Arxivləşdirmə məlumatları HeatMap, recompute, hesabatlardan gizlədir
- Məlumatlar fiziki olaraq **silinmir** — **90 gün** ərzində bərpa mümkündür
- Bütün hərəkətlər audit trail-ə yazılır
- 90 gündən sonra — gündəlik cron `soft-delete-purge` fiziki silir

**Forma:**
- **Hərəkət:** Arxivləşdirmək / Bərpa etmək
- **Növ:** P&L / BS / CF / Counterparty
- **Şirkət + İl**
- **Səbəb** (audit log-a düşür)
- **Təsdiq:** səhvi istisna etmək üçün `ALL` daxil edin

---

## 8. AI Auto Import — istənilən Excel-in idxalı

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.webp)

**Bu əl ilə mapping-in qatilidir.** Phase 7.M Tier 7-yə qədər hər yeni xlsx kod tələb edirdi. İndi:

### Necə işləyir (5 faza)
1. **AI Classifier** (Anthropic) — vərəqin dataType-nı müəyyən edir: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — reyestrdən düzgün adapteri seçir (11 dataType)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Məcburi Uzlaşdırma** — hər idxal mənbə ilə yoxlanılır
5. **GREEN verdict** — uyğunsuzluq yoxdur və ya diff görürsünüz

### İki rejim
- **`1 файл`** — standart, bir workbook üçün
- **`Несколько файлов`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - Eyni anda 1-10 fayl
  - **Qrup səviyyəsində atomiklik** — ya bütün qruplar yazılır, ya heç biri
  - **Fayllar arası konflikt aşkarlanması** — iki fayl eyni xanaya fərqli şey yazsalar → diff ilə 409
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nəyi yoxlamaq lazımdır
1. İstənilən xlsx-i `Перетащите xlsx файл сюда` zonasına drag-drop edin
2. `Шаг 1: AI-анализ листов` basın
3. AI təsnifat + plan import təklif edəcək
4. Təsdiq edirsiz → fayl idxal olunur → avtomatik recompute

### Məhdudiyyətlər
- Tək fayl: ≤ 20 MB
- Çoxlu fayl: ≤ 10 fayl, ≤ 20 MB ümumi
- Rate limit: saat/təşkilat üzrə 3 multi-file idxal
- Xərc limiti: əvvəlcədən yoxlanılır (N × 35K token)

---

## 9. Risk Registry — keyfiyyət risk bayraqları

**URL:** `/budgeting/admin/companies` → **"Настройки компаний"** bölməsi → şirkət kartını genişləndirin

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**Bu ən son xüsusiyyətdir (Phase 7.N, may 2026).** HeatMap kəmiyyətcə göstərməyən keyfiyyətli maliyyə-əməliyyat riskləri.

### Üç kanonik bayaq

| Bayraq | Emoji | Nə deməkdir | Composite cəza |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja əhəmiyyətli dərəcədə subsidiyalardan və ya tənzimlənən qiymətlərdən asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Əlaqəli tərəflər və ya auditdən keçməmiş xərc bölgüsü paterni | **−8** |
| `data_absence` | ⚪ | Əsas maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq olar
1. `/budgeting/admin/companies`
2. **"Настройки компаний"** bölməsi (səhifənin aşağısı)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **"Risk Registry"** tapın — ciddilik nöqtələri ilə 8 kateqoriyaya görə sıralanıb `● ● ●` (zümrüd → kəhrəba → qızılgül)
5. Lazımi bayrağa klikləyin — o işıqlanacaq, cəza saxlamadan sonra tətbiq olunacaq

### Bu bayraqlar hara düşür (4 kanal, end-to-end yoxlanılıb)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (ad yanında `Sub` / `Opq` / `NoD` çipləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (məsələn, *"exposure to government policy/subsidy regime"* kimi ifadələr) |
| **Board Deck section** | Board Deck → **"Qualitative Risk Flags"** bölməsi FLAGGED ENTITIES sayı ilə |
| **Variance Explainer** | Risk Terminal → xanaya klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### Bazanın cari vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **−20 composite-ə**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Hər entity üzrə ətraflı Risk Registry

Üç kanonik bayraqdan əlavə, hər şirkətin ətraflı risk reyestri (KRI siyahısı) var — admin panelində açılır:
**`/budgeting/admin/companies` → şirkət kartını açın → "Risk Registry" bölməsi**.

| Entity | KRI | Mənbə | Kateqoriyalar |
|---|---|---|---|
| **EDEN** | 15 | Top risk - EDEN AGRO MMC.xlsx (müştəri) | Env / Fin / HC / Market / Ops / Reg / Strat / Tech |
| **AZSF** | 15 | Sənaye şablonu (2026-05-27) | Env / Fin / HC / Market / Ops / Reg / Strat / Tech |
| **CPC** | 14 | Sənaye şablonu (2026-05-27) | Env / Fin / Market / Ops / Reg / Strat / Tech |
| **MALT** | 10 | Sənaye şablonu (2026-05-27) | Env / Fin / HC / Market / Ops / Reg / Strat |
| **HORIZON** | 5 | Sənaye şablonu (2026-05-27, slim — passiv qabıq) | Fin / Market / Reg / Strat |
| **PROMALT** | 0 | — | Azersun ilə JV, reestr təxirə salınıb |
| **FARM** | 0 | — | Arxivləşdirilib |

**Şablonlar vs müştəri tərəfindən təmin olunan:** EDEN reestri müştəridən gəlib. Qalanları — sənaye şablonları (food processing / services), real məlumatlar Nəcəf M.-dən gələndə admin UI vasitəsilə cilalanmalıdır.

---

## 9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real göstəricilər

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → "Compliance" bölməsi

Müştəri fayllarından qidalanan üç yeni göstərici (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Kod | Nəyi ölçür | Yaşıl | Kəhrəba | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanmış audit qeydlərinin % (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### Bazada hazırda nələr var (live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştəri fayllarında məlumat yoxdur | | |

### Haradan gəlir

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlanıb, 6 Major açıq). CPC = 59 tapıntı (39% bağlanıb, 3 Major açıq). Tam siyahı drill-down üçün `Company.settings.auditFindings` vasitəsilə mövcuddur.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reyestri: 54 iş. AZSF — 26-da cavabdeh (29 açıq). CPC — 7-də cavabdeh (8 açıq). EDEN — yalnız iddiaçı (4 açıq). Tam reestr `Company.settings.courtDisputes`-də.

### Nəyi yoxlamaq lazımdır
- HeatMap-də 3 yeni sütun göründü (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- AZSF/AUDIT_MAJOR_OPEN qırmızı xanaya klik → Variance Explainer narrativdə açıq Major tapıntılarını sitat gətirməlidir
- Board Deck → "Critical alerts" bölməsi indi compliance/legal xəbərdarlıqlarını ehtiva edir

### LEGAL_MONEY_AT_RISK — açıqlanmış pul tələbləri (AZN)

Müntəzəm ifadə işlər təsvirindən məbləğləri çıxarır ("13276,92 manat borc məbləği"). Yalnız açıq məbləğli kommersiya mübahisələri:

| Entity | Məbləğ | İşlər | Status |
|---|---|---|---|
| AZSF | 321,287 AZN | 2 (290K + 30K) | 🟡 kəhrəba |
| CPC | 71,586 AZN | 2 (65K + 5K) | 🟢 yaşıl |
| EDEN/MALT/HORIZON/PROMALT | ⚪ məlumat yoxdur | məbləğsiz əmək/tənzimləyici | ⚪ |

**Hədlər:** ≤100K 🟢 / 100K-500K 🟡 / >500K 🔴

Floor qiymətləndirməsi — açıq AZN məbləği olmayan əmək/tənzimləyici mübahisələr nəzərə alınmayıb. Real məruz qalma daha yüksəkdir.

---

## 9.2.5 FX risk — gəlirin hansı hissəsi kursdan həssasdır

**Harada:** Risk Terminal → HeatMap `REVENUE_FX_EXPOSURE` sütunu + Board Deck FX bölməsi.

`Company.settings.fxRevenueAzn/Usd/Eur/Rub`-da saxlanılır — hər valyutada gəlirin %-i. Formula: **100 − fxRevenueAzn** = % non-AZN = FX-risk tərəfi.

| Entity | AZN | USD | EUR | RUB | FX Exposure | Mənbə |
|---|---|---|---|---|---|---|
| AZSF | 95% | 5% | 0% | 0% | 🟢 5% | Crocs Group / Coca-Cola |
| CPC | 80% | 18% | 2% | 0% | 🟢 20% | DCFTA Gürcüstan ixracatı |
| MALT | 100% | — | — | — | 🟢 0% | Carlsberg tək alıcı AZN |
| EDEN | 90% | 10% | — | — | 🟢 10% | Salyan şəkər çuğunduru → Gürcüstan |
| HORIZON | 100% | — | — | — | 🟢 0% | Daxili xidmətlər |
| PROMALT | 100% | — | — | — | 🟢 0% | Azersun ilə JV, daxili |

**Hədlər:**
- 🟢 ≤ 20% — daxili bazar üstünlük təşkil edir
- 🟡 20–50% — qarışıq məruz qalma
- 🔴 > 50% — FX dəyişmələri gəlir üzərində hökmranlıq edir

**Cari dəyərlər = məlum müştərilərə əsaslanan təhsilli default-lar**. Müştəri üzrə real split N. Nəcəfzadə-dən gələcək — fayldan sonra `/budgeting/admin/companies` → settings panel vasitəsilə yeniləmək lazım olacaq.

**`FX_IMPORTED_INPUT` (təsir, xərc tərəfi) ilə əlaqə**: iki göstərici birlikdə **NET FX positon** göstərir. Əgər xərc ≈ gəlir eyni valyutada → natural hedge. Əgər USD idxal xərcləri yüksək amma AZN gəlir 100% → AZN zəifliyi kompensasiya olmadan marja vurur.

---

## 9.2 Concentration — gəlirinizi kim saxlayır

**Harada:** Risk Terminal → HeatMap (3 sütun) + Board Deck → top movers/alerts.

HHI-dan (riyazi olaraq düzgün, amma CFO üçün pis kommunikasiya edilir) əlavə, **birbaşa konsentrasiya göstəriciləri** əlavə edildi ki, dərhal oxunur:

| Kod | Nəyi ölçür | Yaşıl | Kəhrəba | Qırmızı |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman index (riyazi konsentrasiya) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | **Bir** ən böyük müştəridən gəlirin %-i | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | **Top-3** ən böyük müştərilərdən gəlirin %-i | ≤ 50% | 50–75% | > 75% |

### Live məlumatlar

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Kim üstünlük təşkil edir |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | ümumiyyətlə 2 müştəri |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | ehtimal ki AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg tək alıcı |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (şirniyyat) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ məlumat yoxdur | ⚪ | ⚪ | (Azersun ilə JV) |

### Niyə hər iki göstərici
- **TOP_CUSTOMER_SHARE** — "bir müştərinin itirilməsi" (məsələn AZSF Bakı Şirniyyatı itirsə → bir gecədə −32% gəlir)
- **TOP3_CUSTOMER_SHARE** — "long-tail sağlamlığı" (MALT 80% o deməkdir ki top-3-dən sonra demək olar ki heç nə yoxdur — hamısı getsə əvəz etmək olmaz)
- **CUSTOMER_HHI** — akademik olaraq düzgün ölçü, tənzimləyicilər / due diligence üçün

---

## 10. AI funksiyaları — nə, harada, nə qədər başa gəlir

Bütün LLM çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost rejimi + retry siyasəti).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → "Today's Brief" bölməsi

**Nə edir:** günün risk klasterini bir cümlə ilə təsvir edir + sektorlar üzrə "top worst"-ı sadalayır. Keyfiyyət risk bayraqlarını nəzərə alır.

**Çıxış nümunəsi (bazadan canlı):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ yuxarı küncündə dəyişdirici).

**Keş necə işləyir:** prompt mətni + dataset hash-in sha256. Prompt-u dəyişdiririk → köhnə keş avtomatik olaraq etibarsız olur.

### 10.2 Variance Explainer (sapma izahçısı)

**Harada:** Risk Terminal → HeatMap xanasına klik → `Explain →` düyməsi

![Variance Explainer](guide/screenshots/13-variance-explainer.webp)

**Nə edir:** narrativ (1-3 cümlə) + 3 əməli tövsiyə + TOP DRIVERS siyahısı.

**EDEN Customer HHI üçün çıxış nümunəsi:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Qeyd edin — tövsiyə #3 Risk Registry səhifəsindən `subsidy_dependency` risk bayrağını sitat gətirir.

**Dəyəri:** çağırış üçün ~1200 in + ~240 out token (~ $0.01).

### 10.3 Board Deck Narration

**Harada:** Board Deck açılanda avtomatik generasiya olunur.

**Nə edir:** kəmiyyət siqnallarını *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"* tipli bir cümlə başlığa çevirir.

(orgId, period) üzərində keşlənir — saatda maksimum bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylı drag-drop.

**Nə edir:** istənilən xlsx üçün smart-routing. Test zamanı tam workbook üçün ~$0.13 başa gəlir (23 vərəq / 14 entity). Yeni adapterlər yoxdur — AI özü növü müəyyənləşdirir və düzgün pipeline seçir.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Məqsəd:** bütün əhəmiyyətli dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanılır.

### Nələr yazılır
- Bütün idxallar (fayl adı, dəyişdirilən sətirlər, status)
- Bütün mapper tətbiqləri
- Rol dəyişiklikləri
- Göstərici override-ları
- LLM çağırışları (model, prompt versiyası, tokenlər, fromCache)
- **Soft-delete və fiziki purge** (Phase 1.4 cron)

### Filtrlər
- **Action** — hadisə növü
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix diapazonu
- **Düymələr:** Apply / Reset

### Nəyi yoxlamaq lazımdır
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` qeydləri görünür
- ACTOR sütunu — əl hərəkətləri üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Qeydlər yenilər yuxarıda sıralanıb

---

## 12. Özünüyoxlama çek-listi

Canlı tətbiqdə klikləyərək bu siyahıdan **indi** keçin. Əgər nəsə uyğun gəlmirsə — haradasa baq var, düzəliş növbəyə qoyulmalıdır.

### Əsas naviqasiya
- [ ] `/login` → admin kredensialları ilə daxil olun → `/budgeting`-ə yönləndirmə
- [ ] Sidebar 6 bənd göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ yuxarı küncdə tema dəyişdiricisi (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN yanında `Sub` etiketi, AZSF yanında — `Opq` + `NoD`
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətir göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: "Today's brief" yüklənir, mətn "subsidy-regime" və ya "non-transparent" qeydlərini ehtiva edir (bu risk bayraqları ilə AI Morning Brief)
- [ ] EDEN sətir, CUSTOMER_HHI sütununda qırmızı xanaya klik → Panel 3 `counterparty_hhi_customer` formulunu göstərir
- [ ] `Explain →` klik → ~15s sonra narrativ + 3 tövsiyə peyda olur
- [ ] Tövsiyə #3-də **subsidy dependency** (və ya əlaqəli) ifadə sitat gətirilir

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI başlığı mövcuddur ("Food processing margin squeeze..." kimi bir şey)
- [ ] Holding composite score = **59** (yazı anında)
- [ ] Aşağı sürüşdürün → **"Qualitative Risk Flags"** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` çipi (kəhrəba)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (qızılgül) + `Data absence` (şifer)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri mövcuddur

### Büdcələşdirmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Tooltip-lə waterfall chart (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçicisi `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — PENDING ilə yeganə
- [ ] Qalanları ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Lending 4 qrupda 16 kart göstərir
- [ ] `Импорт данных` və `Indicator Health` kartları `Phase 7 M` nişanı ilə işarələnib
- [ ] Bütün kartlar klikləmə oluna bilir

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 файл` / `Несколько файлов` (yeni işarələnib)
- [ ] Drop-zona mövcuddur
- [ ] `Шаг 1: AI-анализ листов` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Xəta koduna görə breakdown görünür
- [ ] Filter çipləri: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity cədvəli Score asc (ən pis birinci) sıralanır
- [ ] HORIZON və PROMALT MMC Thin tier ilə aşağıda
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Hərəkət / Məlumat növü / Şirkət / İl / Səbəb / `ALL` təsdiq sahələri ilə forma
- [ ] `Архивировать (скрыть из расчётов)` radio default olaraq seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda 8 entity ilə Role & Status cədvəli
- [ ] Aşağıda açılan kartlarla "Настройки компаний"
- [ ] EDEN kartı içində — 8 kateqoriya ilə **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddilik `● ● ●` nöqtələri ilə göstərilib (zümrüd / kəhrəba / qızılgül)

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 xana **qırmızı** (51% bağlanıb / 6 Major / 29 iş)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 iş, hamısı iddiaçı kimi)
- [ ] AZSF/AUDIT_MAJOR_OPEN qırmızı xanaya klik → Variance Explainer Major findings sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisələr cədvəli, yenilər yuxarıda
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` qeydləri mövcuddur
- [ ] SUMMARY tokens + language + fromCache ilə JSON ehtiva edir

### AI çağırışları (Audit Log vasitəsilə)
- [ ] Son 24 saat üçün ən azı bir `ai_variance_explainer_run`
- [ ] Bu gün üçün `ai_morning_brief_run` var
- [ ] `ai_board_deck_narration_run` var (Board Deck açılanda generasiya olunur)
- [ ] Eyni parametrlərlə təkrar sorğular üçün `fromCache: true`

---

## Nəsə pozulsa hara müraciət etmək olar

| Simptom | Hara baxmaq |
|---|---|
| Composite score yenidən hesablanmadı | `Risk Terminal → Recompute` düyməsi |
| AI brief köhnədir | Audit Log → son `ai_morning_brief_run` tapın → `fromCache` yoxlayın |
| HeatMap boşdur | `Indicator Health` → UNKNOWN breakdown yoxlayın |
| İdxal uğursuz oldu | `Admin → Drift Dashboard` → son hadisələr |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat növü + il + səbəb seçin → ALL |
| Dövrü təsadüfən bağladılar | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki təfərrüatlar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** `@anthropic-ai/sdk` vasitəsilə serverside caching ilə Anthropic Claude
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 keçir) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Migration siyasəti:** Prisma + audit vasitəsilə bütün miqrasiyalar; 90 günlük fiziki purge cron ilə soft-delete
- **Cost guard rails:** rate-limitlər + token büdcələri + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N bağlandıqdan sonra (4 kanalın hamısında risk bayraqları) generasiya edilib.
> Ekran görüntülərinin mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

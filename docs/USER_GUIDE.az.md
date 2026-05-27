# BudgetPro — İstifadəçi Təlimatı

> **Enterprise Holding Risk Terminal**
> Bu nədir, necə istifadə etmək olar, nəyi və harada yoxlamaq lazımdır.
> Müştəri, maliyyə direktoru və holdinq admini üçün.

---

## Mündəricat

1. [Bu nədir və nə üçündür](#1-bu-nədir-və-nə-üçündür)
2. [Giriş və naviqasiya](#2-giriş-və-naviqasiya)
3. [Risk Terminal — maliyyəçinin iş günü](#3-risk-terminal--maliyyəçinin-iş-günü)
4. [Board Deck — şura üçün snapshot](#4-board-deck--şura-üçün-snapshot)
5. [Büdcələşdirmə](#5-büdcələşdirmə)
6. [Yeni şirkətin onboarding-i](#6-yeni-şirkətin-onboarding-i)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel-in idxalı](#8-ai-auto-import--istənilən-excel-in-idxalı)
9. [Risk Registry — keyfiyyət risk bayraqları](#9-risk-registry--keyfiyyət-risk-bayraqları)
   - [9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real göstəricilər](#91-compliance--legal--audit-hesabatlarından-və-məhkəmələrdən-real-göstəricilər)
   - [9.2 Concentration — gəlirinizi kim saxlayır](#92-concentration--gəlirinizi-kim-saxlayır)
10. [AI funksiyalar — nə, harada, nə qədər başa gəlir](#10-ai-funksiyalar--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nə üçündür

**BudgetPro — 60+ şirkətdən ibarət holdinqin CFO-su üçün terminaldir.**

Bir məqsəd: səhər 5 dəqiqə ərzində **şirkətlərinizin hansılarının hazırda risk zonasında olduğunu**, **niyə** və **bununla nə etmək lazım olduğunu** başa düşmək.

### Sistemin cavab verdiyi üç səviyyəli suallar

| Sual | Harada baxmaq | Nə qədər vaxt |
|---|---|---|
| «Bu gün nə yanır?» | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| «Bu göstərici niyə qırmızıdır?» | **Variance Explainer** (hücrəyə klik → Explain) | 10 saniyə + ~15 saniyə AI |
| «Direktorlar şurasına nə göstərmək olar?» | **Board Deck** — bir kliklə PDF/PPTX | 20 saniyə |

### İçəridə nə var
- **AZSEKER holdinqinin 6 canlı entity** (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 göstərici** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat)
- **Anthropic Claude üzərində AI agentlər**: Excel təsnifatçısı, sapma izahçısı, Board Deck generatoru, səhər brifinqi
- **Tam audit-trail** — hər dəyişiklik 365 gün üçün IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya sizin production domeniniz.

![Login](guide/screenshots/01-login.webp)

Kredensiyaları sistem administratoru verir. Əgər siz həmin administrator olsanız və yeni stend qurmusunuzsa — parol `scripts/create-admin.ts`-dən və ya deploy sirlərinizdən.

> 🔒 Parollar açıq sənədləşdirmədə dərc edilmir.

### 2.2 Yan naviqasiya

Girişdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nə üçün |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-üslub terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün snapshot (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yenilərin idxalı |
| 📜 | **Audit Log** | Bütün əhəmiyyətli dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + seçimlər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

Bu **əsas ekrandır**. Səhər açırsınız — lazım olan hər şey buradadır.

### Dörd panel

#### Panel 1 · Company Tree (sol yuxarı)
Holdinqin bütün şirkətlərinin ağacı, hər biri üçün **composite-score** badge ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı göstəricilərin sayı
- **Çiplər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk bayraqları (bölmə 9-a bax)

**Nə yoxlamaq:** şirkətə klik → sağ HeatMap bu şirkətə filtrlənir.

#### Panel 2 · Risk HeatMap (sağ yuxarı)
**Matris: şirkətlər × göstəricilər.** Hücrə rəngi = status (yaşıl/amber/qırmızı/m/y).

Hər hücrə təkcə rənglə deyil, həm də **forma** ilə işarələnib (▲ / ● / ○) — clinical color-blind safety üçün (Phase M7 reqressiya skanı geri çəkilməni qadağan edir).

Yuxarıda:
- Rüb filtri (2026 / Q1...Q4 / M1...M12)
- `Material only` — tətbiq olunmayan göstəriciləri gizlət
- Sayğac: `54G / 30A / 16R / 88?`

**Nə yoxlamaq:** hücrəyə kursor aparın → rəqəm + planlaşdırılmış diapazonla tooltip.

#### Panel 3 · Indicator Detail (sol aşağı)
Defolt olaraq **«Today's brief»** göstərir — səhər AI brifinqi.

HeatMap hücrəsinə klik edildikdə **göstərici təfsilatına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Resolved variables
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (sağ aşağı)
- Defolt olaraq: «Pick a HeatMap cell, then click Explain →» məsləhəti
- Şirkətə klik edildikdən sonra: **Company Snapshot** (top alert'lər + breakdown)
- `Explain →` klik edildikdən sonra: **AI Variance Explainer** — narrative + 3 tövsiyə

### 60 saniyədə nə yoxlamaq
1. AZSEKER ağacını açın → composite-score ilə 7 sub-co olmalıdır
2. Qırmızı hücrəyə klikləyin → Panel 3 formulanı, Panel 4 — Explain düyməsini göstərəcək
3. Explain basın → ~15 saniyədən sonra TOP DRIVERS və RECOMMENDATIONS ilə narrative görünəcək
4. Aşağıda — EVENTS lenti (son LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — şura üçün snapshot

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Məqsəd:** direktorlar şurası üçün bir səhifəlik sənəd. Açırsınız → oxuyursunuz → «Print to PDF» basırsınız → çata göndərirsiniz.

### İçərisində nə var
1. **Başlıq-narrative** — AI *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir cümlə generasiya edir
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — kim plandan daha güclü yuxarı/aşağı
4. **Alerts** — kritik hədd pozuntuları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk bayraqları olan şirkətlərlə bölmə

### Keyfiyyət riskləri bölməsinin skrinşotu (səhifənin aşağısı)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Burada görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraqlar **avtomatik olaraq şirkətin composite score-nu azaldır** və səhər brifinqinə düşür (bölmə 9-a bax).

### Export düymələri
- `Export PPTX` — bayt-ba-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzerdə çap
- `Open Risk Terminal →` — drill-down üçün canlı terminala keçid

---

## 5. Büdcələşdirmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**Bu «adi» FP&A workspace-dir** — maliyyəçinin Excel-də etdiyi işi indi burada edir.

### Sol sidebar — iş strukturu

**FINANCE** — üç klassik hesabat:
- 📈 **P&L** — mənfəət və zərərlər haqqında hesabat
- 💰 **Sales** — satışların təfsilatı
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
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** execution % və variance ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — təfsilatlı cədvəl

### Nə yoxlamaq
1. Yuxarıda başlığın sağında — plan seçici (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Sağ aşağıda — `AI Analysis` düyməsi (bənövşəyi)

---

## 6. Yeni şirkətin onboarding-i

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxiletməsinin gedişatını göstərmək və «boş» bölmələri tamamlamağa kömək etmək.

### Nə görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng vurğulaması:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

### Bizim demoda nə göstərilir
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

**Nə yoxlamaq:** kartlara klik → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğunu, hansılarının tamamlanmalı olduğunu göstərən detail açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**Bu «mühəndislik paneli»dir** — **müştəri demosundan əvvəl** və gündəlik dəstək üçün istifadə etmək.

### Dörd qrup

#### 🧪 Data Ingestion (məlumat yükləmə)
| Kart | Nə edir |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | İstənilən xlsx-in drag-drop-u → AI tipi müəyyən edir (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adaptera yönləndirir. 5 fərqli forma əvəzinə bir ekran. |
| **Data Entry** | Non-engineer admin üçün KPI və ESG açıqlamalarının əl ilə daxiledilməsi. |
| **Data Sources Catalog** | Client-facing xarici feed siyahısı: business value, sample value, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazə verilmiş xlsx mənbələrinin siyahısı. |

#### 🩺 Data Quality (məlumat keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Göstərici üzrə yaşıl/amber/qırmızı/naməlum remediation guidance ilə. Müştəri demosundan **əvvəl** istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + reference-feed freshness + saxlanmış onboarding halları. |
| **Companies Readiness** | Entity üzrə 7 sahədə qiymətləndirmə tier-lərlə (complete/good/partial/thin/empty). CSV export. |
| **Data Archive** | Self-service arxiv + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | Xarici feed adapteri statusu + son crawl-lar + xəbər pipeline diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — bağlı dövrlərin mutation-lardan bağlanması
- **Approvals** — dəyişikliklərin razılaşdırılması üçün workflow
- **AI Usage** — 30 günlük tendensiya ilə LLM xərclərinin monitorinqi

#### 👥 Access (girişlər)
- **User Access** — istifadəçilərin və rolların idarə edilməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demodan əvvəl must-check

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (1201 cəmi IV-dən 43.6% hesablanmış)

**Unknown breakdown by error code:**
- `eval: 430` — formulalar düşdü
- `non_finite: 123` — sıfıra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbə yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problemli konkret göstəricilərin siyahısı + bir sətrdə remediation.

**Demodan əvvəl nə yoxlamaq:**
1. **AGRO_COMMODITY_VOL** → 75 hücrə, investigate lazımdır
2. **FP_INVENTORY_TURNS** → 49 hücrə, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 hücrə, production KPI-də `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 hücrə, entity üzrə `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq şəbəkəsi

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

7 sahə üzrə entity üzrə qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tier-i qaldırmaq üçün nə əlavə etmək lazımdır

**Skrində görünür:**
- HORIZON 15% Thin → P&L (budget lines), balance sheet, counterparties lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → operational KPIs, strategic narrative, FX tags lazımdır
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** düyməsi email üçün gap-list kopyalayır.

### 7.3.5 Compliance Hub — audit tapıntıları + məhkəmələr üçün vahid ekran

**URL:** `/budgeting/admin/compliance`

**Məqsəd:** compliance/legal officer üçün bir səhifə — 6 entity üzrə bütün 218 audit tapıntısı (Major/Minor/Observation/OFI) + 54 məhkəmə işi, filtrlər və CSV çıxışı ilə.

**İçəridə nə var:**
- **2 tab** — Audit findings / Court cases
- **Aktiv tab üçün yuxarıda 5 xülasə kartı** (audit üçün Total / Open / Major / Minor / Observation; məhkəmələr üçün Total / Open / Defendant / Plaintiff / Money claims)
- **Rəng kodlaşdırması ilə cədvəl** severity-chip-ləri: Major (rose), Minor (amber), Observation (slate), OFI (sky)
- **Filtrlər:** Entity (6-dan biri) / Severity / Status (Open/Closed/All)
- **Export CSV** fayl adında timestamp ilə filtrlənmiş kəsik

**Məlumatlar haradan:** artıq Phase 7.N-dən məlumat bazasındadır (`Company.settings.auditFindings.items` + `courtDisputes.cases`). Yeni cədvəl yoxdur.

**Nə yoxlamaq:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 cəmi → CSV 159 sətir verməlidir
- CPC ct: 8 iş, hamısı açıq, 7-si cavabdeh kimi
- Filtr `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → 6 sətir olmalıdır

### 7.3 Data Archive — bərpa ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Nə üçün:** idxalla səhv etdiniz → sətirləri hesablamadan çıxarmaq lazımdır, **amma IFRS auditi üçün fiziki silməmək**.

**Necə işləyir:**
- Arxivləşdirmə məlumatları HeatMap, recompute, hesabatlardan gizlədir
- Məlumatlar fiziki olaraq **silinmir** — **90 gün** ərzində bərpa mümkündür
- Bütün hərəkətlər audit trail-ə yazılır
- 90 gündən sonra — daily cron `soft-delete-purge` fiziki silir

**Forma:**
- **Əməliyyat:** Arxivləşdirmə / Bərpa
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
1. **AI Classifier** (Anthropic) — vərəqin dataType-ını müəyyən edir: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — reyestrdən düzgün adapteri seçir (11 dataType)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — hər idxal mənbə ilə yoxlanılır
5. **GREEN verdict** — uyğunsuzluq yoxdur və ya diff görürsünüz

### İki rejim
- **`1 файл`** — standart, bir workbook üçün
- **`Несколько файлов`** 🆕 — multi-file orkestrator (Phase 7.M Tier 5)
  - Eyni vaxtda 1-10 fayl
  - **Qrup səviyyəsində atomiklik** — ya bütün qruplar yazılır, ya heç biri
  - **Fayllar arası konflikt aşkarlanması** — iki fayl eyni hücrəyə fərqli şey yazırsa → diff ilə 409
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nə yoxlamaq
1. İstənilən xlsx-i `Перетащите xlsx файл сюда` zonasına drag-drop edin
2. `Шаг 1: AI-анализ листов` basın
3. AI təsnifat qaytaracaq + plan import təklif edəcək
4. Təsdiqləyirsiniz → fayl idxal olunur → avtomatik recompute

### Məhdudiyyətlər
- Single file: ≤ 20 MB
- Multi file: ≤ 10 fayl, ≤ 20 MB cəmi
- Rate limit: 3 multi-file idxal/saat/org
- Cost cap: əvvəlcədən yoxlanılır (N × 35K token)

---

## 9. Risk Registry — keyfiyyət risk bayraqları

**URL:** `/budgeting/admin/companies` → **«Настройки компаний»** bölməsi → şirkət kartını genişləndirin

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**Bu ən yeni funksiya (Phase 7.N, may 2026).** HeatMap-in kəmiyyətcə göstərmədyi keyfiyyət maliyyə-əməliyyat riskləri.

### Üç kanonik bayaraq

| Bayaraq | Emoji | Nə deməkdir | Composite-a cəza |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja subsidiyalardan və ya tənzimlənən qiymətlərdən əhəmiyyətli dərəcədə asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Related-party və ya unaudited cost-allocation paterni | **−8** |
| `data_absence` | ⚪ | Açar maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq
1. `/budgeting/admin/companies`
2. **«Настройки компаний»** bölməsi (səhifənin aşağısı)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **«Risk Registry»** tapın — ciddilik nöqtələri `● ● ●` (emerald → amber → rose) ilə 8 kateqoriya üzrə çeşidlənib
5. Lazımi bayrağa klikləyin — vurğulanacaq, cəza yadda saxlanıldıqdan sonra tətbiq olunacaq

### Bu bayraqlar hara düşür (4 kanal, end-to-end yoxlanıldı)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (adın yanında `Sub` / `Opq` / `NoD` çipləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (*«exposure to government policy/subsidy regime»* tipli cümlələr) |
| **Board Deck section** | Board Deck → **«Qualitative Risk Flags»** bölməsi FLAGGED ENTITIES sayı ilə |
| **Variance Explainer** | Risk Terminal → hücrəyə klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### Məlumat bazasının cari vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **composite-a −20**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Entity üzrə təfsilatlı Risk Registry

Üç kanonik bayraqdan əlavə, hər şirkətin təfsilatlı risk reyestri (KRI list) ola bilər — admin panelində göstərilir:
**`/budgeting/admin/companies` → şirkət kartını açın → «Risk Registry» bölməsi**.

**Cari vəziyyət:**

| Entity | KRI-lər | Mənbə |
|---|---|---|
| **EDEN** | 15 | `Top risk - EDEN AGRO MMC.xlsx` (müştəridən fayl) |
| **AZSF / CPC / MALT / HORIZON / PROMALT / FARM** | 0 | ⏳ Gözlənilir — Nəcəf M-dən (CARRYOVER L2) gözlənilir |

Qalan entity-lər üçün reyestrlər **məqsədli olaraq doldurulmayıb** — biz riskləri özümüz generasiya etmirik, holdinqin Risk Officer-indən real KRI-ləri gözləyirik. Burada uydurma məlumat olmamalıdır: maliyyə CFO-su bu göstəricilərə əsasən qərar qəbul edir.

---

## 9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real göstəricilər

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → «Compliance» bölməsi

Müştərinin fayllarından qidalanan üç yeni göstərici (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | Nə ölçür | Yaşıl | Amber | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanmış audit qeydlərinin % (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### Məlumat bazasında indi nə var (canlı)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştəri fayllarında məlumat yoxdur | | |

### Haradan gəlir

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlı, 6 Major açıq). CPC = 59 tapıntı (39% bağlı, 3 Major açıq). Tam siyahı drill-down üçün `Company.settings.auditFindings` vasitəsilə əlçatandır.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reyestri: 54 hal. AZSF — 26-da cavabdeh (29 açıq). CPC — 7-də cavabdeh (8 açıq). EDEN — yalnız iddiaçı (4 açıq). Tam reyestr `Company.settings.courtDisputes`-də.

### Nə yoxlamaq
- HeatMap-də 3 yeni sütun göründü (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- AZSF/AUDIT_MAJOR_OPEN qırmızı hücrəsinə klik → Variance Explainer narrative-də açıq Major tapıntıları sitat gətirməlidir
- Board Deck → «Critical alerts» bölməsi indi compliance/legal xəbərdarlıqları ehtiva edir

> **Money-at-risk per case (AZN):** 2026-05-27 tarixində göstəricilərdən silindi. Regex yalnız 54 haldan 4-nü (7%) əhatə edirdi — misleading floor estimate. Hüquq Şöbəsindən tam iddia məbləğləri reyestri gələndə yenidən həyata keçiriləcək.

---

## 9.2.5 FX risk — gəlirin hansı hissəsi kurs üçün həssasdır

**Harada:** Risk Terminal → HeatMap `REVENUE_FX_EXPOSURE` sütunu.

`Company.settings.fxRevenueAzn/Usd/Eur/Rub`-da saxlanılır — hər valyutada gəlirin %-i. Formula: **100 − fxRevenueAzn** = % non-AZN.

**Cari vəziyyət:**

| Entity | AZN | USD | EUR | FX Exposure | Mənbə |
|---|---|---|---|---|---|
| **CPC** | 84% | 14% | 2% | 🟢 16% | `Farming strategy/Sales plan` — 2027-2035 real həcm bölgüləri |
| AZSF / MALT / EDEN / HORIZON / PROMALT | — | — | — | ⚪ Gözlənilir | N. Nəcəfzadə faylından «Müştəri İcmalı» gözlənilir (CARRYOVER L1) |

Yalnız CPC real məlumatlara malikdir (müştərinin forward plan-ından hesablanıb). Qalan 5 entity üçün split-i məqsədli olaraq doldurmamışıq — təsdiqlənmiş müştəri üzrə FX breakdown gələnə qədər `REVENUE_FX_EXPOSURE` `unknown` göstərir.

**Həddlər:**
- 🟢 ≤ 20% — daxili bazar dominantdır
- 🟡 20–50% — qarışıq ekspozisiya
- 🔴 > 50% — FX dəyişkənliyi gəlir üzərində dominantdır

**`FX_IMPORTED_INPUT` (cost-side) ilə əlaqə**: iki göstərici birlikdə **NET FX position** verəcək hamıda revenue split olanda. Əgər cost ≈ revenue eyni valyutada → natural hedge.

---

## 9.2 Concentration — gəlirinizi kim saxlayır

**Harada:** Risk Terminal → HeatMap (3 sütun) + Board Deck → top movers/alerts.

HHI-dən əlavə (riyazi cəhətdən düzgün, amma CFO-ya pis kommunikasiya olunur) **birbaşa konsentrasiya göstəriciləri** əlavə etdik ki, dərhal oxunsun:

| Code | Nə ölçür | Yaşıl | Amber | Qırmızı |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman index (riyazi konsentrasiya) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | **Bir** ən iri müştəridən gəlirin %-i | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | **Top-3** ən iri müştərilərdən gəlirin %-i | ≤ 50% | 50–75% | > 75% |

### Canlı məlumatlar

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Kim dominantdır |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | Ümumiyyətlə 2 müştəri |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | Ehtimal ki AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg single-buyer |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (konfet) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ məlumat yoxdur | ⚪ | ⚪ | (Azersun ilə JV) |

### Niyə hər iki göstərici
- **TOP_CUSTOMER_SHARE** — «bir müştərinin itirilməsi» (məsələn AZSF Bakı Şirniyyatı itirir → bir gecədə −32% revenue)
- **TOP3_CUSTOMER_SHARE** — «long-tail sağlamlığı» (MALT 80% top-3-dən sonra demək olar ki heç nə yoxdur — hamısı gedərsə əvəz edilə bilməz)
- **CUSTOMER_HHI** — akademik cəhətdən düzgün ölçü, tənzimləyicilər / due diligence üçün

---

## 10. AI funksiyalar — nə, harada, nə qədər başa gəlir

Bütün LLM çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost mode + retry policy).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → «Today's Brief» bölməsi

**Nə edir:** bir cümlə ilə günün risk klasterini təsvir edir + sektorlar üzrə «top worst»-u sadalayır. Keyfiyyət risk bayraqlarını nəzərə alır.

**Çıxış nümunəsi (canlı, məlumat bazasından):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ yuxarı künc'ündə keçid).

**Keş necə işləyir:** prompt mətninin sha256-ı + dataset hash. Prompt-u dəyişdiririk → köhnə keş avtomatik olaraq etibarsızlaşır.

### 10.2 Variance Explainer (sapma izahçısı)

**Harada:** Risk Terminal → HeatMap hücrəsinə klik → `Explain →` düyməsi

![Variance Explainer](guide/screenshots/13-variance-explainer.webp)

**Nə edir:** narrative (1-3 cümlə) + 3 actionable tövsiyə + TOP DRIVERS siyahısı.

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

**Harada:** Board Deck açılanda avtomatik generasiya olunur.

**Nə edir:** kəmiyyət siqnallarını *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir başlıq cümləsinə çevirir.

(orgId, period) üzərində keşlənir — maksimum saatda bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylın drag-drop-u.

**Nə edir:** istənilən xlsx üçün smart-routing. Tam workbook (testdə 23 vərəq / 14 entity) üçün ~$0.13 başa gəlir. Yeni adapter yoxdur — AI özü tipi müəyyən edib düzgün pipeline seçir.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Məqsəd:** bütün əhəmiyyətli dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanılır.

### Nə yazılır
- Bütün idxallar (filename, dəyişdirilən sətirlər, status)
- Bütün mapper apply-lər
- Rol dəyişiklikləri
- Göstərici override-ları
- LLM çağırışları (model, prompt versiyası, token-lər, fromCache)
- **Soft-delete və physical purge** (Phase 1.4 cron)

### Filtrlər
- **Action** — hadisə növü
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix diapazonu
- **Düymələr:** Apply / Reset

### Nə yoxlamaq
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` yazıları görünür
- ACTOR sütunu — əl ilə hərəkətlər üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Yazılar yenilər yuxarıda sıralanıb

---

## 12. Özünüyoxlama çek-listi

Canlı applikasiyada klikləyərək bu siyahıdan **indi** keçin. Nəsə uyğun gəlmirsə — haradasa bug var, düzəlişi növbəyə qoymaq lazımdır.

### Əsas naviqasiya
- [ ] `/login` → admin kredensiyaları ilə daxil olun → `/budgeting`-ə redirect
- [ ] Sidebar 6 bəndi göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ yuxarı küncdə tema keçidi (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN-in yanında `Sub` nişanı, AZSF-in yanında — `Opq` + `NoD`
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətir göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: «Today's brief» yüklənir, mətn «subsidy-regime» və ya «non-transparent» qeydləri ehtiva edir (bu risk bayraqları ilə AI Morning Brief)
- [ ] EDEN sətir, CUSTOMER_HHI sütun qırmızı hücrəsinə klik → Panel 3 `counterparty_hhi_customer` formulasını göstərir
- [ ] `Explain →` klik → ~15 saniyədən sonra narrative + 3 tövsiyə görünür
- [ ] Tövsiyə #3-də **subsidy dependency** (və ya əlaqəli) ifadə sitat gətirilir

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI başlığı mövcuddur («Food processing margin squeeze...» tipli nəsə)
- [ ] Holding composite score = **59** (yazı anında)
- [ ] Aşağı sürüşdürün → **«Qualitative Risk Flags»** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` çipi (amber)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri mövcuddur

### Büdcələşdirmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Üzərinə gəldikdə tooltip ilə Waterfall chart (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçici `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — PENDING olan yeganəsi
- [ ] Qalan ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Lendinq 4 qrupda 16 kart göstərir
- [ ] `Импорт данных` və `Indicator Health` kartları `Phase 7 M` badge ilə işarələnib
- [ ] Bütün kartlar kliklənilədir

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 файл` / `Несколько файлов` (yeni `новое` işarəsi ilə)
- [ ] Drop-zone mövcuddur
- [ ] `Шаг 1: AI-анализ листов` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Error code üzrə breakdown görünür
- [ ] Filtr çipləri: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity cədvəli Score asc üzrə sıralanır (worst first)
- [ ] HORIZON və PROMALT MMC aşağıda Thin tier ilə
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Əməliyyat / Məlumat növü / Şirkət / İl / Səbəb / `ALL` təsdiqi ilə forma
- [ ] Defolt olaraq `Архивировать (скрыть из расчётов)` radio seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda 8 entity ilə Role & Status cədvəli
- [ ] Aşağıda açılan kartlarla «Настройки компаний»
- [ ] EDEN kartının içərisində — 8 kateqoriya ilə **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddilik `● ● ●` (emerald / amber / rose) nöqtələri ilə göstərilir

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 hücrə **qırmızı** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 hal, hamısı iddiaçı kimi)
- [ ] AZSF/AUDIT_MAJOR_OPEN qırmızı hücrəsinə klik → Variance Explainer Major tapıntıları sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisələr cədvəli, yenilər yuxarıda
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` yazıları mövcuddur
- [ ] SUMMARY token-lər + language + fromCache ilə JSON ehtiva edir

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
| İdxal düşdü | `Admin → Drift Dashboard` → son hadisələr |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat növü + il + səbəb seçin → ALL |
| Dövrü təsadüfən bağlamışıq | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki təfərrüatlar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** `@anthropic-ai/sdk` ilə serverside caching-li Anthropic Claude
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Migration policy:** Prisma + audit vasitəsilə bütün migrasyonlar; 90 günlük physical purge cron ilə soft-delete
- **Cost guard rails:** rate-limit-lər + token büdcələri + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N-in bağlanmasından sonra (4 kanalda risk bayraqları) generasiya olunub.
> Skrinşot mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

# BudgetPro — İstifadəçi Təlimatı

> **Enterprise Holding Risk Terminal**
> Bu nədir, necə istifadə edilir, nəyi və harada yoxlamaq lazımdır.
> Müştəri, maliyyə direktoru və holdinq admini üçün.

---

## Mündəricat

1. [Bu nədir və nə üçündür](#1-bu-nədir-və-nə-üçündür)
2. [Giriş və naviqasiya](#2-giriş-və-naviqasiya)
3. [Risk Terminal — maliyyəçinin iş günü](#3-risk-terminal--maliyyəçinin-iş-günü)
4. [Board Deck — şura üçün snapshot](#4-board-deck--şura-üçün-snapshot)
5. [Büdcələşdirmə](#5-büdcələşdirmə)
6. [Yeni şirkətin onboarding prosesi](#6-yeni-şirkətin-onboarding-prosesi)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel-in idxalı](#8-ai-auto-import--istənilən-excel-in-idxalı)
9. [Risk Registry — keyfiyyət risk bayraqları](#9-risk-registry--keyfiyyət-risk-bayraqları)
   - [9.1 Compliance & Legal — real indikatorlar](#91-compliance--legal--real-indikatorlar-audit-hesabatlarından-və-məhkəmələrdən)
   - [9.2 Concentration — gəlirinizi kim saxlayır](#92-concentration--gəlirinizi-kim-saxlayır)
10. [AI funksiyaları — nə, harada, nə qədər başa gəlir](#10-ai-funksiyaları--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nə üçündür

**BudgetPro — 60+ şirkətdən ibarət holdinqin CFO-su üçün terminaldir.**

Bir məqsəd: səhər 5 dəqiqə ərzində **hansı şirkətlərinizin hazırda risk zonasında olduğunu**, **niyə** və **bununla nə etmək lazım olduğunu** başa düşmək.

### Sistemin cavablandırdığı üç səviyyəli suallar

| Sual | Harada baxmaq | Nə qədər vaxt |
|---|---|---|
| «Bu gün nə yanır?» | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| «Niyə bu göstərici qırmızıdır?» | **Variance Explainer** (xanaya klik → Explain) | 10 saniyə + ~15 saniyə AI |
| «Direktorlar şurasına nə göstərmək olar?» | **Board Deck** — bir kliklə PDF/PPTX | 20 saniyə |

### Daxilində nələr var
- AZSEKER holdinqinin **6 canlı entity** (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 indikator** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat)
- Anthropic Claude-da **AI agentlər**: Excel klassifikatoru, fərq izahçısı, Board Deck generatoru, səhər brifinqi
- **Tam audit trail** — hər dəyişiklik 365 gün üçün IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya production domeniniz.

![Login](guide/screenshots/01-login.webp)

Kredensialları sistem administratoru verir. Əgər siz həmin administratorsansınız və təzəcə stendin quraşdırılmasını bitirmisinizsə — parol `scripts/create-admin.ts`-dən və ya deploy sirlərinizdən.

> 🔒 Parollar açıq sənədləşdirmədə dərc olunmur.

### 2.2 Yan naviqasiya

Girişdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nə üçün |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-stil terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün snapshot (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yenilərin idxalı |
| 📜 | **Audit Log** | Bütün əhəmiyyətli dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + üstünlüklər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

Bu **əsas ekrandır**. Səhər açırsınız — lazım olan hər şey buradadır.

### Dörd panel

#### Panel 1 · Company Tree (yuxarıda solda)
Holdinqin bütün şirkətlərinin ağacı, hər biri üçün **composite-score** nişanı ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı indikatorların sayı
- **Çiplər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk bayraqları (bölmə 9-a bax)

**Nəyi yoxlamaq:** şirkətə klik → sağdakı HeatMap bu şirkətə görə süzülür.

#### Panel 2 · Risk HeatMap (yuxarıda sağda)
**Matris: şirkətlər × indikatorlar.** Xananın rəngi = status (yaşıl/sarı/qırmızı/m/y).

Hər xana təkcə rənglə deyil, həm də **forma** ilə işarələnib (▲ / ● / ○) — clinical color-blind safety üçün (Phase M7 reqressiya skanı geri qaytarmanı qadağan edir).

Yuxarıda:
- Rüb süzgəci (2026 / Q1...Q4 / M1...M12)
- `Material only` — tətbiq olunmayan indikatorları gizlət
- Sayğac: `54G / 30A / 16R / 88?`

**Nəyi yoxlamaq:** xananın üzərinə kursor — tooltip rəqəm + plan aralığı ilə.

#### Panel 3 · Indicator Detail (aşağıda solda)
Default olaraq **«Today's brief»** göstərir — səhər AI brifinqi.

HeatMap xanasına kliklədikdə **indikator detalizasiyasına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Resolved dəyişənlər
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (aşağıda sağda)
- Default: məsləhət «Pick a HeatMap cell, then click Explain →»
- Şirkətə klikdən sonra: **Company Snapshot** (top xəbərdarlıqlar + breakdown)
- `Explain →` kliklədikdən sonra: **AI Variance Explainer** — narrative + 3 tövsiyə

### 60 saniyəyə nə yoxlamaq
1. AZSEKER ağacını açın → 7 sub-co composite-score ilə olmalıdır
2. Qırmızı xanaya klikləyin → Panel 3 formulu göstərər, Panel 4 — Explain düyməsi
3. Explain basın → ~15 saniyədən sonra TOP DRIVERS və RECOMMENDATIONS ilə narrative görünər
4. Aşağıda — EVENTS lenti (son LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — şura üçün snapshot

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Məqsəd:** direktorlar şurası üçün bir səhifəlik sənəd. Açırsınız → oxuyursunuz → «Print to PDF» basırsınız → çata göndərirsiniz.

### Nələr var
1. **Başlıq-narrativ** — AI bir cümlə generasiya edir, məsələn *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»*
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — kimin plandan yuxarı/aşağı ən güclü
4. **Alerts** — həddlərin kritik pozulmaları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk bayraqları olan şirkətlərlə bölmə

### Keyfiyyət risklər bölməsinin ekran görüntüsü (səhifənin aşağısında)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Burada görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraqlar **avtomatik şirkətin composite score-nu azaldır** və səhər brifinqinə düşür (bölmə 9-a bax).

### İxrac düymələri
- `Export PPTX` — bayt-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzer çapı
- `Open Risk Terminal →` — drill-down üçün canlı terminalə keçid

---

## 5. Büdcələşdirmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**Bu «adi» FP&A workspace** — maliyyəçinin Excel-də etdiyi, indi burada edir.

### Sol sidebar — işin strukturu

**FINANCE** — üç klassik hesabat:
- 📈 **P&L** — mənfəət və zərər haqqında hesabat
- 💰 **Sales** — satışların detalizasiyası
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

### Əsas Workspace ekranında nə var
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** icra % və variance ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — ətraflı cədvəl

### Nəyi yoxlamaq
1. Başlığın yuxarısında sağda — plan seçicisi (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Aşağıda sağda — `AI Analysis` düyməsi (bənövşəyi)

---

## 6. Yeni şirkətin onboarding prosesi

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxiletmə irəliləyişini göstərmək və «boş» bölmələri tamamlamağa kömək etmək.

### Nə görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng vurğulanması:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

### Demo-da göstərilən
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

**Nəyi yoxlamaq:** karta klik → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğunu, hansıların tamamlanmalı olduğunu göstərən detail açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**Bu «mühəndislik paneli»** — müştəri demo-sundan **əvvəl** və gündəlik dəstək üçün istifadə olunan.

### Dörd qrup

#### 🧪 Data Ingestion (məlumat yükləməsi)
| Kart | Nə edir |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | İstənilən xlsx-i drag-drop → AI növü müəyyən edir (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adapter-ə yönləndirir. 5 fərqli forma əvəzinə bir ekran. |
| **Data Entry** | Non-engineer admin üçün əl ilə KPI və ESG açıqlamalarının daxil edilməsi. |
| **Data Sources Catalog** | Client-facing xarici feed-lərin siyahısı: biznes dəyəri, nümunə dəyər, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazə verilmiş xlsx mənbələrinin siyahısı. |

#### 🩺 Data Quality (məlumat keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Per-indicator yaşıl/sarı/qırmızı/naməlum remediation təlimatı ilə. Müştəri demo-sundan **əvvəl** istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + reference-feed təravəti + dayandırılmış onboarding case-lər. |
| **Companies Readiness** | Per-entity 7-sahə qiymətləndirməsi tier-lərlə (complete/good/partial/thin/empty). CSV ixrac. |
| **Data Archive** | Self-service arxiv + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | External feed adapter statusu + son crawl-lar + xəbər pipeline diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — bağlı dövrlərin mutation-dan bağlanması
- **Approvals** — dəyişikliklərin razılaşdırılması üçün iş axını
- **AI Usage** — 30 günlük trend ilə LLM xərclərinin monitorinqi

#### 👥 Access (giriş)
- **User Access** — istifadəçi və rolların idarə edilməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demo-dan əvvəl must-check

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (1201 total IV-dən 43.6% hesablanmış)

**Unknown breakdown səhv koduna görə:**
- `eval: 430` — formullar uğursuz oldu
- `non_finite: 123` — sıfıra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbə yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problemli konkret indikatorların siyahısı + bir sətirdə remediation.

**Demo-dan əvvəl nəyi yoxlamaq:**
1. **AGRO_COMMODITY_VOL** → 75 xana, araşdırmaq lazımdır
2. **FP_INVENTORY_TURNS** → 49 xana, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 xana, production KPI-da `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 xana, entity üzrə `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq şəbəkəsi

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

Per-entity 7 sahə üzrə qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tier-i qaldırmaq üçün nə əlavə etmək lazımdır

**Ekran görüntüsündə görünür:**
- HORIZON 15% Thin → P&L (budget lines), balance sheet, counterparties lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → operational KPIs, strategic narrative, FX tags lazımdır
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** düyməsi gap-list-i email üçün kopyalayır.

### 7.3.5 Compliance Hub — audit tapıntıları + məhkəmələr vahid ekranı

**URL:** `/budgeting/admin/compliance`

**Məqsəd:** compliance/legal officer üçün bir səhifə — 6 entity üzrə bütün 218 audit tapıntısı (Major/Minor/Observation/OFI) + 54 məhkəmə işi, süzgəclər və CSV ixracı ilə.

**Daxilində nələr var:**
- **2 tab** — Audit findings / Court cases
- **Aktiv tab üçün yuxarıda 5 xülasə kartı** (audit üçün Total / Open / Major / Minor / Observation; məhkəmələr üçün Total / Open / Defendant / Plaintiff / Money claims)
- **Severity-chip-lərin rəng kodlaşdırılması ilə cədvəl**: Major (rose), Minor (amber), Observation (slate), OFI (sky)
- **Süzgəclər:** Entity (6-dan biri) / Severity / Status (Open/Closed/All)
- **Export CSV** fayl adında timestamp ilə süzülmüş kəsik

**Məlumatlar haradan:** artıq Phase 7.N-dən DB-də (`Company.settings.auditFindings.items` + `courtDisputes.cases`). Heç bir yeni cədvəl yoxdur.

**Nəyi yoxlamaq:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 total → CSV 159 sətir verməlidir
- CPC ct: 8 case, hamısı open, 7-si defendant kimi
- Süzgəc `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → 6 sətir olmalıdır

### 7.3 Data Archive — restore ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Niyə:** idxalda səhv etdiniz → sətirləri hesablamadan çıxarmaq lazımdır, **amma IFRS auditi üçün fiziki silməmək**.

**Necə işləyir:**
- Arxivləşdirmə məlumatları HeatMap, recompute, hesabatlardan gizlədir
- Fiziki olaraq məlumatlar **silinmir** — **90 gün** ərzində bərpa mümkündür
- Bütün əməliyyatlar audit trail-ə yazılır
- 90 gündən sonra — gündəlik cron `soft-delete-purge` fiziki silir

**Forma:**
- **Əməliyyat:** Arxivləşdirmək / Bərpa etmək
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
2. **Adapter Router** — reestrindən düzgün adapter seçir (11 dataType)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — hər idxal mənbə ilə müqayisə olunur
5. **GREEN verdict** — uyğunsuzluq olmadan və ya diff görürsünüz

### İki rejim
- **`1 файл`** — standart, bir workbook üçün
- **`Несколько файлов`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - Eyni vaxtda 1-10 fayl
  - **Group-level atomicity** — ya bütün qruplar yazılır, ya heç biri
  - **Cross-file conflict detection** — əgər iki fayl eyni xanaya fərqli yazırsa → diff ilə 409
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nəyi yoxlamaq
1. `Перетащите xlsx файл сюда` zonasına istənilən xlsx-i drag-drop edin
2. `Шаг 1: AI-анализ листов` basın
3. AI klassifikasiya qaytaracaq + plan import təklif edəcək
4. Təsdiq edirsiniz → fayl idxal olunur → avtomatik recompute

### Məhdudiyyətlər
- Single file: ≤ 20 MB
- Multi file: ≤ 10 fayl, ≤ 20 MB total
- Rate limit: 3 multi-file idxal/saat/org
- Cost cap: əvvəlcədən yoxlanılır (N × 35K token)

---

## 9. Risk Registry — keyfiyyət risk bayraqları

**URL:** `/budgeting/admin/companies` → **«Настройки компаний»** bölməsi → şirkət kartını genişləndirin

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**Bu ən yeni özəllikdir (Phase 7.N, may 2026).** HeatMap-in kəmiyyətcə göstərmə diyi keyfiyyət maliyyə-əməliyyat riskləri.

### Üç kanonik bayraq

| Bayraq | Emoji | Nə deməkdir | Composite-ə cərimə |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja əhəmiyyətli dərəcədə subsidiyalardan və ya tənzimlənən qiymətlərdən asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Related-party və ya unaudited cost-allocation pattern | **−8** |
| `data_absence` | ⚪ | Əsas maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq
1. `/budgeting/admin/companies`
2. **«Настройки компаний»** bölməsi (səhifənin aşağısında)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **«Risk Registry»** tapın — ciddilik nöqtələri `● ● ●` (emerald → amber → rose) ilə 8 kateqoriya üzrə sıralanıb
5. Lazımi bayrağa klikləyin — vurğulanacaq, yadda saxlamadan sonra cərimə tətbiq olunacaq

### Bu bayraqlar haraya düşür (4 kanal, end-to-end yoxlanılıb)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (adın yanında `Sub` / `Opq` / `NoD` çipləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (*«exposure to government policy/subsidy regime»* kimi ifadələr) |
| **Board Deck section** | Board Deck → **«Qualitative Risk Flags»** bölməsi FLAGGED ENTITIES sayı ilə |
| **Variance Explainer** | Risk Terminal → xanaya klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### Hazırkı DB vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **composite-yə −20**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Per entity ətraflı Risk Registry

3 kanonik bayraqdan əlavə, hər şirkətin ətraflı risk reestri (KRI list) var — admin panelində açılır:
**`/budgeting/admin/companies` → şirkət kartını açın → «Risk Registry» bölməsi**.

| Entity | KRI-lər | Mənbə | Kateqoriyalar |
|---|---|---|---|
| **EDEN** | 15 | Top risk - EDEN AGRO MMC.xlsx (müştəri) | Env / Fin / HC / Market / Ops / Reg / Strat / Tech |
| **AZSF** | 15 | Sənaye şablonu (2026-05-27) | Env / Fin / HC / Market / Ops / Reg / Strat / Tech |
| **CPC** | 14 | Sənaye şablonu (2026-05-27) | Env / Fin / Market / Ops / Reg / Strat / Tech |
| **MALT** | 10 | Sənaye şablonu (2026-05-27) | Env / Fin / HC / Market / Ops / Reg / Strat |
| **HORIZON** | 5 | Sənaye şablonu (2026-05-27, slim — passiv shell) | Fin / Market / Reg / Strat |
| **PROMALT** | 0 | — | Azersun ilə JV, reestr təxirə salınıb |
| **FARM** | 0 | — | Arxivləşdirilib |

**Templates vs client-supplied:** EDEN reestri müştəridən gəlib. Qalanları — sənaye şablonları (food processing / services), real məlumatlar Nəcəf M.-dən gələndə admin UI vasitəsilə cilalanmalıdır.

---

## 9.1 Compliance & Legal — audit hesabatlarından və məhkəmələrdən real indikatorlar

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → «Compliance» bölməsi

Müştərinin fayllarından qidalanan üç yeni indikator (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanmış audit qeydlərinin % (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### DB-də indi nə var (live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştəri fayllarında məlumat yoxdur | | |

### Haradan gəlir

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlanıb, 6 Major açıq). CPC = 59 tapıntı (39% bağlanıb, 3 Major açıq). Drill-down üçün tam siyahı `Company.settings.auditFindings` vasitəsilə əlçatandır.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reestri: 54 case. AZSF — 26-da cavabdeh (29 açıq). CPC — 7-də cavabdeh (8 açıq). EDEN — yalnız iddiaçı (4 açıq). Tam reestr `Company.settings.courtDisputes`-də.

### Nəyi yoxlamaq
- HeatMap-də 3 yeni sütun görünüb (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- AZSF/AUDIT_MAJOR_OPEN qırmızı xanasına klik → Variance Explainer narrative-də açıq Major tapıntıları sitat gətirməlidir
- Board Deck → «Critical alerts» bölməsi indi compliance/legal warning-ləri ehtiva edir

---

## 9.2.5 FX risk — gəlirin hansı hissəsi kursa həssasdır

**Harada:** Risk Terminal → HeatMap `REVENUE_FX_EXPOSURE` sütunu + Board Deck FX bölməsi.

`Company.settings.fxRevenueAzn/Usd/Eur/Rub`-da saxlanılır — hər valyutada gəlirin %-i. Formula: **100 − fxRevenueAzn** = % non-AZN = FX-risk tərəfi.

| Entity | AZN | USD | EUR | RUB | FX Exposure | Mənbə |
|---|---|---|---|---|---|---|
| AZSF | 95% | 5% | 0% | 0% | 🟢 5% | Crocs Group / Coca-Cola |
| CPC | 80% | 18% | 2% | 0% | 🟢 20% | DCFTA Gürcüstan ixracı |
| MALT | 100% | — | — | — | 🟢 0% | Carlsberg single-buyer AZN |
| EDEN | 90% | 10% | — | — | 🟢 10% | Salyan şəkər çuğunduru → Gürcüstan |
| HORIZON | 100% | — | — | — | 🟢 0% | Daxili xidmətlər |
| PROMALT | 100% | — | — | — | 🟢 0% | Azersun ilə JV, daxili |

**Hədlər:**
- 🟢 ≤ 20% — daxili bazar üstünlük təşkil edir
- 🟡 20–50% — qarışıq ekspozu
- 🔴 > 50% — FX dəyişkənliyi gəlirə hakim olur

**Cari dəyərlər = tanınmış müştərilərə əsaslanan educated defaults**. Real per-customer split N. Nəcəfzadə-dən gələcək — fayldan sonra `/budgeting/admin/companies` → settings panel vasitəsilə yeniləmək lazım olacaq.

**`FX_IMPORTED_INPUT` ilə əlaqə** (impact, xərc tərəfi): iki göstərici birlikdə **NET FX position** göstərir. Əgər cost ≈ revenue eyni valyutada → natural hedge. Əgər imported costs USD yüksək, amma AZN revenue 100% → AZN zəifliyi kompensasiya olmadan marjaya zərbə vurur.

---

## 9.2 Concentration — gəlirinizi kim saxlayır

**Harada:** Risk Terminal → HeatMap (3 sütun) + Board Deck → top movers/alerts.

HHI-dan əlavə (riyazi cəhətdən düzgün, amma CFO-ya pis kommunikasiya olunan) **birbaşa konsentrasiya göstəriciləri** əlavə edilib, dərhal oxunur:

| Code | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman indeks (riyazi konsentrasiya) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | **Bir** ən iri müştəridən gəlirin %-i | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | **Top-3** ən iri müştəridən gəlirin %-i | ≤ 50% | 50–75% | > 75% |

### Live məlumatlar

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Kimin dominantlığı |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | Ümumiyyətlə 2 müştəri |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | Ehtimal ki AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg single-buyer |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (şirniyyat) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ məlumat yoxdur | ⚪ | ⚪ | (Azersun ilə JV) |

### Niyə hər iki göstərici
- **TOP_CUSTOMER_SHARE** — «bir müştərinin itirilməsi» (məsələn AZSF Bakı Şirniyyat itirsə → bir gecədə −32% revenue)
- **TOP3_CUSTOMER_SHARE** — «long-tail sağlamlığı» (MALT 80% deməkdir top-3-dən sonra demək olar ki heç nə yoxdur — hamısı getməsə əvəz etmək olmaz)
- **CUSTOMER_HHI** — akademik cəhətdən düzgün ölçü, tənzimləyicilər / due diligence üçün

---

## 10. AI funksiyaları — nə, harada, nə qədər başa gəlir

Bütün LLM çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost mode + retry policy).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → «Today's Brief» bölməsi

**Nə edir:** günün risk klasterini bir cümlə ilə təsvir edir + sektorlar üzrə «top worst»-u sadalayır. Keyfiyyət risk bayraqlarını nəzərə alır.

**Çıxış nümunəsi (canlı, DB-dən):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ yuxarı küncündə dəyişdirici).

**Keş necə işləyir:** prompt mətni sha256 + dataset hash. Promptu dəyişdiririk → köhnə keş avtomatik inteqrasiya olunur.

### 10.2 Variance Explainer (fərq izahçısı)

**Harada:** Risk Terminal → HeatMap xanasına klik → `Explain →` düyməsi

![Variance Explainer](guide/screenshots/13-variance-explainer.webp)

**Nə edir:** narrative (1-3 cümlə) + 3 tətbiq olunan tövsiyə + TOP DRIVERS siyahısı.

**EDEN Customer HHI üçün çıxış nümunəsi:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Qeyd edin — tövsiyə #3 Risk Registry səhifəsindən `subsidy_dependency` risk bayrağını sitat gətirir.

**Dəyəri:** çağırış başına ~1200 in + ~240 out token (~ $0.01).

### 10.3 Board Deck Narration

**Harada:** Board Deck açılanda avtomatik generasiya olunur.

**Nə edir:** kəmiyyət siqnallarını *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»* tipli bir başlıq cümləsinə çevirir.

(orgId, period)-da keşlənir — saatda maksimum bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylı drag-drop.

**Nə edir:** istənilən xlsx üçün smart-routing. Tam workbook üçün ~$0.13 başa gəlir (testdə 23 vərəq / 14 entity). Heç bir yeni adapter yoxdur — AI özü növü müəyyən edir və düzgün pipeline seçir.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Məqsəd:** bütün əhəmiyyətli dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanılır.

### Nə yazılır
- Bütün idxallar (filename, dəyişdirilmiş sətirlər, status)
- Bütün mapper tətbiqləri
- Rol dəyişiklikləri
- İndikator override-ları
- LLM çağırışları (model, prompt versiyası, token-lər, fromCache)
- **Soft-delete və physical purge** (Phase 1.4 cron)

### Süzgəclər
- **Action** — hadisə növü
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix aralığı
- **Düymələr:** Apply / Reset

### Nəyi yoxlamaq
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` qeydləri görünür
- ACTOR sütunu — əl ilə əməliyyatlar üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Qeydlər yuxarıda yenilər sıralanıb

---

## 12. Özünüyoxlama çek-listi

**İndi** canlı tətbiqdə klikləyərək bu siyahıdan keçin. Əgər nəsə uyğun gəlmirsə — bir yerdə səhv var, düzəlişi növbəyə qoymaq lazımdır.

### Əsas naviqasiya
- [ ] `/login` → admin kredensialları ilə giriş → `/budgeting`-ə redirect
- [ ] Sidebar 6 bənd göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ yuxarı küncdə tema dəyişdirici (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN yanında `Sub` nişanı, AZSF yanında — `Opq` + `NoD`
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətri göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: «Today's brief» yüklənir, mətn «subsidy-regime» və ya «non-transparent» qeydlərini ehtiva edir (bu risk bayraqları ilə AI Morning Brief)
- [ ] EDEN sətiri, CUSTOMER_HHI sütunu qırmızı xanaya klik → Panel 3 `counterparty_hhi_customer` formulunu göstərir
- [ ] `Explain →` klik → ~15s sonra narrative + 3 tövsiyə görünür
- [ ] Tövsiyə #3-də **subsidy dependency** (və ya əlaqəli) ifadə sitat gətirilir

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI başlığı var («Food processing margin squeeze...» kimi bir şey)
- [ ] Holding composite score = **59** (yazı zamanı)
- [ ] Aşağı sürüşdürmə → **«Qualitative Risk Flags»** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` çipi (amber)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri var

### Büdcələşdirmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Tooltip ilə şəlalə diaqramı (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçicisi `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — yeganə PENDING
- [ ] Qalanları ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Landing 4 qrupda 16 kart göstərir
- [ ] `Импорт данных` və `Indicator Health` kartları `Phase 7 M` nişanı ilə işarələnib
- [ ] Bütün kartlar klikləyə bilir

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 файл` / `Несколько файлов` (yenisi `новое` işarəli)
- [ ] Drop-zone var
- [ ] `Шаг 1: AI-анализ листов` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Səhv kodu üzrə breakdown görünür
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity-dən cədvəl Score asc üzrə sıralanır (ən pis əvvəl)
- [ ] HORIZON və PROMALT MMC aşağıda Thin tier ilə
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Əməliyyat / Məlumat növü / Şirkət / İl / Səbəb / `ALL` təsdiqi sahələri ilə forma
- [ ] `Архивировать (скрыть из расчётов)` radio default olaraq seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda 8 entity ilə Role & Status cədvəli
- [ ] Aşağıda açılan kartlarla «Настройки компаний»
- [ ] EDEN kartının içində — 8 kateqoriya ilə **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddilik `● ● ●` nöqtələri ilə göstərilib (emerald / amber / rose)

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 xana **qırmızı** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 case, hamısı iddiaçı kimi)
- [ ] AZSF/AUDIT_MAJOR_OPEN qırmızı xanaya klik → Variance Explainer Major findings sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisələr cədvəli, yuxarıda yenilər
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` qeydləri var
- [ ] SUMMARY tokens + language + fromCache ilə JSON ehtiva edir

### AI çağırışları (Audit Log vasitəsilə)
- [ ] Son 24 saat ərzində ən azı bir `ai_variance_explainer_run`
- [ ] Bu gün üçün `ai_morning_brief_run` var
- [ ] `ai_board_deck_narration_run` var (Board Deck açılanda generasiya olunur)
- [ ] Eyni parametrlərlə təkrar sorğular üçün `fromCache: true`

---

## Nəsə pozularsa hara müraciət etmək

| Simptom | Hara baxmaq |
|---|---|
| Composite score yenidən hesablanmadı | `Risk Terminal → Recompute` düyməsi |
| AI brief köhnədir | Audit Log → sonuncu `ai_morning_brief_run` tap → `fromCache` yoxla |
| HeatMap boşdur | `Indicator Health` → UNKNOWN breakdown yoxla |
| İdxal uğursuz oldu | `Admin → Drift Dashboard` → son events |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat növü + il + səbəb seç → ALL |
| Dövrü təsadüfən bağladıq | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki detallar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** `@anthropic-ai/sdk` vasitəsilə serverside caching ilə Anthropic Claude
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Migration policy:** bütün miqrasiyalar Prisma + audit vasitəsilə; 90 günlük physical purge cron ilə soft-delete
- **Cost guard rails:** rate-limits + token büdcələri + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N (4 kanalda risk bayraqları) bağlandıqdan sonra generasiya edilib.
> Ekran görüntüləri mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

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
5. [Büdcələmə](#5-büdcələmə)
6. [Yeni şirkətin onboarding](#6-yeni-şirkətin-onboarding)
7. [Admin Tools — 4 qrupda 16 alət](#7-admin-tools--4-qrupda-16-alət)
8. [AI Auto Import — istənilən Excel-in idxalı](#8-ai-auto-import--istənilən-excel-in-idxalı)
9. [Risk Registry — keyfiyyət risk bayrakları](#9-risk-registry--keyfiyyət-risk-bayrakları)
   - [9.1 Compliance & Legal — real indikatorlar](#91-compliance--legal--audit-hesabatları-və-məhkəmələrdən-real-indikatorlar)
10. [AI funksiyaları — nə, harada, nə qədər başa gəlir](#10-ai-funksiyaları--nə-harada-nə-qədər-başa-gəlir)
11. [Audit jurnalı](#11-audit-jurnalı)
12. [Özünüyoxlama çek-listi](#12-özünüyoxlama-çek-listi)

---

## 1. Bu nədir və nə üçündür

**BudgetPro — 60+ şirkətdən ibarət holdinqin CFO-su üçün terminalıdır.**

Bir məqsəd: səhər 5 dəqiqə ərzində **hansı şirkətlərinizin hazırda risk zonasında olduğunu**, **səbəbini** və **bununla nə etmək lazım olduğunu** anlamaqdır.

### Sistemin cavab verdiyi üç səviyyəli suallar

| Sual | Haraya baxmaq lazımdır | Nə qədər vaxt |
|---|---|---|
| "Bu gün nə yanır?" | **Risk Terminal** — HeatMap + Morning Brief | 30 saniyə |
| "Bu göstərici niyə qırmızıdır?" | **Variance Explainer** (xanaya klik → Explain) | 10 saniyə + ~15 saniyə AI |
| "Direktorlar şurasına nə göstərmək olar?" | **Board Deck** — bir kliklə PDF/PPTX | 20 saniyə |

### İçəridə nələr var
- AZSEKER holdinqinin **6 canlı entity** (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + ana şirkət)
- **47 göstərici** (P&L, Balance Sheet, Cash Flow, KPI, ESG, əməliyyat göstəriciləri)
- Anthropic Claude üzərində **AI agentləri**: Excel təsnifləşdiricisi, kənarlaşmaların izahçısı, Board Deck generatoru, səhər brifinqi
- **Tam audit trail** — hər dəyişiklik 365 gün üçün IFRS-uyğun jurnala yazılır

---

## 2. Giriş və naviqasiya

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) və ya sizin production domeniniz.

![Login](guide/screenshots/01-login.png)

Kredensiyaları sistem administratoru verir. Əgər siz o administratorsunuzsa və indicə stend yerləşdirmisinizsə — parol `scripts/create-admin.ts`-də və ya deploy sirlərinizdədir.

> 🔒 Parollar açıq sənədləşməde dərc edilmir.

### 2.2 Yan naviqasiya

Girdikdən sonra solda — 6 əsas bölmə:

| İkona | Bölmə | Nə üçün |
|---|---|---|
| 📊 | **Budgeting** | Plan/fakt, P&L, BS, CF — ənənəvi FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-üslub terminal — günün əsas ekranı |
| 📋 | **Board Deck** | Direktorlar şurası üçün snapshot (çap / PPTX / PDF) |
| 🚀 | **Onboarding** | Şirkətlərin hazırlığı + AI vasitəsilə yenilərin idxalı |
| 📜 | **Audit Log** | Bütün əhəmiyyətli dəyişikliklərin jurnalı |
| 🛠️ | **Admin Tools** | 4 qrupda 16 utilit |
| ⚙️ | **Settings** | Profil + dil + parametrlər |

---

## 3. Risk Terminal — maliyyəçinin iş günü

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.png)

Bu **əsas ekrandır**. Səhər açırsınız — lazım olan hər şey buradadır.

### Dörd panel

#### Panel 1 · Company Tree (yuxarıda solda)
Holdinqin bütün şirkətlərinin ağacı, hər biri üçün **composite-score** badge-i ilə:
- 🟢 **yaşıl %** — composite score (0-100)
- 🔴 **R##** — qırmızı göstəricilərin sayı
- **Chip-lər:** `Sub` / `Opq` / `NoD` — keyfiyyət risk bayrakları (bölmə 9-a baxın)

**Nəyi yoxlamaq lazımdır:** şirkətə klik → sağ HeatMap həmin şirkətə görə filtrlənir.

#### Panel 2 · Risk HeatMap (yuxarıda sağda)
**Matris: şirkətlər × göstəricilər.** Xananın rəngi = status (yaşıl/sarı/qırmızı/m.y.).

Hər xana təkcə rənglə deyil, həm də **forma** ilə işarələnir (▲ / ● / ○) — clinical color-blind safety üçün (Phase M7 reqressiya skanı geri çəkilməni qadağan edir).

Yuxarıda:
- Rüb filtri (2026 / Q1...Q4 / M1...M12)
- `Material only` — tətbiq edilməyən göstəriciləri gizlətmək
- Sayğac: `54G / 30A / 16R / 88?`

**Nəyi yoxlamaq lazımdır:** kursoru xanaya yaxınlaşdırın → tooltip rəqəm + planlaşdırılan diapazonla.

#### Panel 3 · Indicator Detail (aşağıda solda)
Defolt olaraq **"Today's brief"** — səhər AI brifinqi göstərir.

HeatMap xanasına klik edildikdə **göstərici detalizasiyasına** çevrilir:
- Formula (`counterparty_hhi_customer`)
- Resolved variables
- BudgetLine-dan mənbə sətirləri
- Düymələr: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (aşağıda sağda)
- Defolt: "Pick a HeatMap cell, then click Explain →" məsləhəti
- Şirkətə klik edildikdən sonra: **Company Snapshot** (top xəbərdarlıqlar + breakdown)
- `Explain →` klik edildikdən sonra: **AI Variance Explainer** — narrativ + 3 tövsiyə

### 60 saniyə ərzində nəyi yoxlamaq lazımdır
1. AZSEKER ağacını açın → composite-score ilə 7 sub-co olmalıdır
2. Qırmızı xanaya klikləyin → Panel 3 formulanı göstərəcək, Panel 4 — Explain düyməsi
3. Explain düyməsinə basın → ~15 saniyə sonra TOP DRIVERS və RECOMMENDATIONS ilə narrativ görünəcək
4. Aşağıda — EVENTS lenti (son LLM çağırışları) və MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — şura üçün snapshot

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.png)

**Məqsəd:** direktorlar şurası üçün birsəhifəli sənəd. Açırsınız → oxuyursunuz → "Print to PDF" düyməsinə basırsınız → çata göndərirsiniz.

### İçərisində nələr var
1. **Başlıq-narrativ** — AI *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"* tipli bir cümlə generasiya edir
2. **Holding composite score** — böyük rəqəm
3. **Top movers** — kimin plandan yuxarı/aşağı olması ən güclüdür
4. **Alerts** — həddlərin kritik pozuntuları
5. **🆕 Qualitative Risk Flags** — keyfiyyət risk bayraqlı şirkətlərlə bölmə

### Keyfiyyət risklər bölməsinin ekran görüntüsü (səhifənin aşağısı)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.png)

Burada görünür:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Bu bayraklar **avtomatik olaraq şirkətin composite score-unu azaldır** və səhər brifinqinə düşür (bölmə 9-a baxın).

### Eksport düymələri
- `Export PPTX` — bayt-bayt eyni PowerPoint təqdimatı
- `Export PDF` — server render vasitəsilə PDF
- `Print to PDF` — brauzer çapı
- `Open Risk Terminal →` — drill-down üçün canlı terminalə keçid

---

## 5. Büdcələmə

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.png)

**Bu "adi" FP&A workspace-dir** — maliyyəçinin Excel-də etdiyi işi indi burada edir.

### Sol sidebar — iş strukturu

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

**ADMIN** — dərin parametrlər (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← buradan Risk Registry**).

### Əsas Workspace ekranında nə var
- Yuxarıda 4 KPI kartı: **Revenues / COGS / Expenses / Operating Profit** icra % və variance ilə
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — detallı cədvəl

### Nəyi yoxlamaq lazımdır
1. Yuxarıda başlığın sağında — plan seçicisi (`Azərşəkər 2026 Budget — 2026`) və şirkətlər (`All companies (consolidated)`)
2. `+ Create plan` düyməsi — yeni plan yaradır
3. Aşağıda sağda — `AI Analysis` düyməsi (bənövşəyi)

---

## 6. Yeni şirkətin onboarding

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.png)

**Məqsəd:** holdinqin hər şirkəti üzrə məlumat daxiletmə tərəqqisini göstərmək və "boş" bölmələri tamamlamağa kömək etmək.

### Nə görünür
- **Şirkət kartları** səviyyə ilə (LEVEL 1 = ana, LEVEL 2 = sub-co)
- **Hazırlıq faizi** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Rəng vurğulanması:** yaşıl CPC (90%), bənövşəyi — drill-down üçün seçilmiş

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

**Nəyi yoxlamaq lazımdır:** karta klik → hansı bölmələrin (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) doldurulduğunu və hansılarının tamamlanmalı olduğunu göstərən detallı açılır.

---

## 7. Admin Tools — 4 qrupda 16 alət

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.png)

**Bu "mühəndis paneli"dir** — **müştəri demosundan əvvəl** və gündəlik dəstək üçün nədən istifadə etmək.

### Dörd qrup

#### 🧪 Data Ingestion (məlumat yükləməsi)
| Kart | Nə edir |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | İstənilən xlsx-i drag-drop edin → AI növünü müəyyənləşdirir (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) və düzgün adapterə yönləndirir. 5 fərqli forma əvəzinə bir ekran. |
| **Data Entry** | Mühəndis olmayan admin üçün KPI və ESG açıqlamalarının əl ilə daxil edilməsi. |
| **Data Sources Catalog** | Müştəri üçün xarici feed-lərin siyahısı: biznes dəyəri, nümunə dəyəri, asılılıqlar. |
| **Source Registry** | Drift-watchdog: ingest üçün icazə verilmiş xlsx-mənbələrinin siyahısı. |

#### 🩺 Data Quality (məlumat keyfiyyəti)
| Kart | Nə edir |
|---|---|
| **Indicator Health** `Phase 7.M` | Göstərici üzrə yaşıl/sarı/qırmızı/naməlum remediation təlimatı ilə. Müştəri demosundan **əvvəl** istifadə edin. |
| **Drift Dashboard** | Son drift hadisələri + reference-feed yeniləməsi + dayandırılmış onboarding halları. |
| **Companies Readiness** | Entity üzrə 7 sahədə qiymətləndirmə tier-ləri ilə (complete/good/partial/thin/empty). CSV eksport. |
| **Data Archive** | Self-service arxiv + bərpa: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | Xarici feed adapter statusu + son taramalar + xəbər pipeline diaqnostikası. |

#### 🔒 Operations (əməliyyatlar)
- **Period Locks** — qapalı dövrləri mutasiyalardan bağlamaq
- **Approvals** — dəyişikliklərin razılaşdırılması workflow
- **AI Usage** — 30 günlük trenddə LLM xərclərinin monitorinqi

#### 👥 Access (girişlər)
- **User Access** — istifadəçilər və rolların idarə edilməsi
- **API Keys** — xarici inteqrasiyalar üçün maşın açarları

### 7.1 Indicator Health — demodan əvvəl mütləq yoxlanılmalıdır

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.png)

**Yuxarıda:** sayğaclar
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (1201 ümumi IV-dən 43.6% hesablanmış)

**Xəta kodu üzrə unknown breakdown:**
- `eval: 430` — formullar uğursuz oldu
- `non_finite: 123` — sıfıra bölmə / NaN
- `no_budget_lines: 64` — P&L-də mənbə yoxdur
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Aşağıda:** problemli konkret göstəricilərin siyahısı + bir sətirdə remediation.

**Demodan əvvəl nəyi yoxlamaq lazımdır:**
1. **AGRO_COMMODITY_VOL** → 75 xana, araşdırma lazımdır
2. **FP_INVENTORY_TURNS** → 49 xana, BS-də `inventory` lazımdır
3. **FP_YIELD_LOSS** → 49 xana, istehsal KPI-də `raw_input` lazımdır
4. **AGRO_DROUGHT_RISK** → 37 xana, entity üzrə `drought_index` lazımdır

### 7.2 Companies Readiness — hazırlıq şəbəkəsi

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.png)

7 sahə üzrə entity-başına qiymətləndirmə: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Sütunlar:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — tier-i qaldırmaq üçün nəyi əlavə etmək lazımdır

**Ekran görüntüsündə görünür:**
- HORIZON 15% Thin → P&L (budget lines), balance sheet, counterparties lazımdır
- PROMALT 25% Thin → eyni
- MALT 65% Good → operational KPIs, strategic narrative, FX tags lazımdır
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** düyməsi email üçün gap-list kopyalayır.

### 7.3 Data Archive — bərpa ilə soft-delete

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.png)

**Nə üçün:** idxalda səhv etmisiniz → sətirləri hesablamadan çıxarmaq lazımdır, **lakin IFRS auditi üçün fiziki olaraq silməmək**.

**Necə işləyir:**
- Arxivləmə məlumatları HeatMap, recompute, hesabatlardan gizlədir
- Məlumatlar fiziki olaraq **silinmir** — **90 gün** ərzində bərpa mümkündür
- Bütün hərəkətlər audit trail-ə yazılır
- 90 gündən sonra — gündəlik cron `soft-delete-purge` fiziki olaraq silir

**Forma:**
- **Hərəkət:** Arxivləmək / Bərpa etmək
- **Növ:** P&L / BS / CF / Counterparty
- **Şirkət + İl**
- **Səbəb** (audit log-a düşür)
- **Təsdiq:** səhvi istisna etmək üçün `ALL` daxil edin

---

## 8. AI Auto Import — istənilən Excel-in idxalı

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.png)

**Bu əl ilə mapping-in qatilidir.** Phase 7.M Tier 7-yə qədər hər yeni xlsx kod tələb edirdi. İndi:

### Necə işləyir (5 faza)
1. **AI Classifier** (Anthropic) — vərəqin dataType-ını müəyyənləşdirir: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — reyestrdən düzgün adapteri seçir (11 dataType)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — hər idxal mənbə ilə müqayisə edilir
5. **GREEN verdict** — uyğunsuzluqsuz və ya fərqi görürsünüz

### İki rejim
- **`1 faylı`** — standart, bir workbook üçün
- **`Bir neçə fayl`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - 1-10 fayl eyni vaxtda
  - **Group-level atomicity** — ya bütün qruplar yazılır, ya heç biri
  - **Cross-file conflict detection** — iki fayl bir xanaya fərqli yazırsa → diff ilə 409
  - Bütün qruplardan sonra bir recompute (N əvəzinə)

### Nəyi yoxlamaq lazımdır
1. İstənilən xlsx-i `xlsx faylını buraya atın` zonasına drag-drop edin
2. `Şəkkil 1: AI-təhlil vərəqləri` düyməsinə basın
3. AI təsnifləşdirmə + plan import təklif edəcək
4. Təsdiq edirsiz → fayl idxal olunur → avtomatik recompute

### Məhdudiyyətlər
- Tək fayl: ≤ 20 MB
- Çoxlu fayl: ≤ 10 fayl, ≤ 20 MB cəmi
- Rate limit: 3 multi-file idxal/saat/org
- Cost cap: əvvəlcədən yoxlanılır (N × 35K token)

---

## 9. Risk Registry — keyfiyyət risk bayrakları

**URL:** `/budgeting/admin/companies` → **"Şirkət parametrləri"** bölməsi → şirkət kartını genişləndirin

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.png)

**Bu ən yeni funksiyadır (Phase 7.N, may 2026).** HeatMap-in kəmiyyətcə göstərmədiyi keyfiyyət maliyyə-əməliyyat riskləri.

### Üç kanonik bayaq

| Bayraq | Emoji | Nə deməkdir | Composite-ə cəza |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Gəlir və ya marja əsaslı şəkildə subsidiyalardan və ya tənzimlənən qiymətlərdən asılıdır | **−5** |
| `non_transparent_structure` | 🛡 | Related-party və ya unaudited cost-allocation nümunəsi | **−8** |
| `data_absence` | ⚪ | Əsas maliyyə və ya əməliyyat məlumatları yoxdur | **−12** |

### Necə qoymaq
1. `/budgeting/admin/companies`
2. **"Şirkət parametrləri"** bölməsi (səhifənin aşağısında)
3. Şirkət kartını açın (məsələn, AZSEKER-EDEN)
4. **"Risk Registry"** tapın — ciddilik dairələri ilə 8 kateqoriya üzrə sıralanmış `● ● ●` (emerald → amber → rose)
5. Lazımi bayrağa klikləyin — işıqlanacaq, cəza saxlanıldıqdan sonra tətbiq olunacaq

### Bu bayraklar hara düşür (4 kanal, end-to-end yoxlanılıb)

| Kanal | Harada görəcəksiniz |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (ad yanında `Sub` / `Opq` / `NoD` chip-ləri) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (*"exposure to government policy/subsidy regime"* tipli cümlələr) |
| **Board Deck section** | Board Deck → **"Qualitative Risk Flags"** bölməsi FLAGGED ENTITIES sayı ilə |
| **Variance Explainer** | Risk Terminal → xanaya klik → Explain → tövsiyə #3 bayrağı sitat gətirir |

### Cari verilənlər bazası vəziyyəti
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **composite-ə −20**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

---

## 9.1 Compliance & Legal — audit hesabatları və məhkəmələrdən real indikatorlar

**Harada:** Risk Terminal → HeatMap (3 yeni sütun) + Board Deck → "Compliance" bölməsi

Müştərinin fayllarından qidalanan üç yeni göstərici (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | Nəyi ölçür | Yaşıl | Sarı | Qırmızı |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | Bağlanmış audit qeydlərinin (PBC) %-i | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Açıq **Major** audit tapıntıları | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Aktiv məhkəmə işləri | ≤ 2 | 3–9 | ≥ 10 |

### Verilənlər bazasında hazırda nə var (live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ məlumat yoxdur | ⚪ məlumat yoxdur | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ müştəri fayllarında məlumat yoxdur | | |

### Haradan gəlir

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — müştərinin daxili audit jurnalı: 218 tapıntı (Major / Minor / Observation / OFI). AZSF = 159 tapıntı (51% bağlanmış, 6 Major açıq). CPC = 59 tapıntı (39% bağlanmış, 3 Major açıq). Tam siyahı drill-down üçün `Company.settings.auditFindings` vasitəsilə əlçatandır.
- **LEGAL_CASES_ACTIVE** — açıq məhkəmə işlərinin reyestri: 54 hal. AZSF — 26-da cavabdeh (29 açıq). CPC — 7-də cavabdeh (8 açıq). EDEN — yalnız iddiaçı (4 açıq). Tam reyestr `Company.settings.courtDisputes`-də.

### Nəyi yoxlamaq lazımdır
- HeatMap-də 3 yeni sütun peyda oldu (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- AZSF/AUDIT_MAJOR_OPEN qırmızı xanasına klik → Variance Explainer narrativdə açıq Major tapıntıları sitat gətirməlidir
- Board Deck → "Critical alerts" bölməsi indi compliance/legal xəbərdarlıqlarını ehtiva edir

---

## 10. AI funksiyaları — nə, harada, nə qədər başa gəlir

Bütün LLM çağırışları server API vasitəsilə **Anthropic Claude**-a gedir (cost mode + retry policy).

### 10.1 Morning Brief (səhər brifinqi)

**Harada:** Risk Terminal → Panel 3 → "Today's Brief" bölməsi

**Nə edir:** günün risk klasterini bir cümlə ilə təsvir edir + sektorlar üzrə "top worst" sadalayır. Keyfiyyət risk bayraklarını nəzərə alır.

**Çıxış nümunəsi (canlı, verilənlər bazasından):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Dillər:** EN / RU / AZ (panelin sağ üst küncündə keçid düyməsi).

**Keş necə işləyir:** prompt mətninin sha256 + dataset hash. Promptu dəyişdiririk → köhnə keş avtomatik olaraq etibarsızlaşır.

### 10.2 Variance Explainer (kənarlaşmaların izahçısı)

**Harada:** Risk Terminal → HeatMap xanasına klik → `Explain →` düyməsi

![Variance Explainer](guide/screenshots/13-variance-explainer.png)

**Nə edir:** narrativ (1-3 cümlə) + 3 actionable tövsiyə + TOP DRIVERS siyahısı.

**EDEN Customer HHI üçün çıxış nümunəsi:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Diqqət edin — tövsiyə #3 Risk Registry səhifəsindən `subsidy_dependency` risk bayrağını sitat gətirir.

**Dəyər:** çağırış başına ~1200 in + ~240 out token (~ $0.01).

### 10.3 Board Deck Narration

**Harada:** Board Deck açıldıqda avtomatik generasiya olunur.

**Nə edir:** kəmiyyət siqnallarını *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"* tipli bir cümlə-başlığa çevirir.

(orgId, period) üzrə keşlənir — saatda maksimum bir çağırış.

### 10.4 AI Auto Import Classifier

**Harada:** Admin → AI Auto Import → faylı drag-drop edin.

**Nə edir:** istənilən xlsx üçün smart-routing. Tam workbook (testdə 23 vərəq / 14 entity) üçün ~$0.13 başa gəlir. Yeni adapterlər yoxdur — AI özü növü müəyyənləşdirir və düzgün pipeline seçir.

---

## 11. Audit jurnalı

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.png)

**Məqsəd:** bütün əhəmiyyətli dəyişikliklərin IFRS-uyğun jurnalı. 365 gün saxlanılır.

### Nə yazılır
- Bütün idxallar (filename, dəyişilmiş sətirlər, status)
- Bütün mapper tətbiq etmələr
- Rol dəyişiklikləri
- Göstərici override-lar
- LLM çağırışları (model, prompt versiyası, tokenlər, fromCache)
- **Soft-delete və fiziki purge** (Phase 1.4 cron)

### Filtrlər
- **Action** — hadisənin növü
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — tarix diapazonu
- **Düymələr:** Apply / Reset

### Nəyi yoxlamaq lazımdır
- Cədvəldə `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` qeydləri görünür
- ACTOR sütunu — əl ilə hərəkətlər üçün `Admin`
- SUMMARY `model`, `inputTokens`, `outputTokens`, `language`, `fromCache` ilə JSON ehtiva edir
- Qeydlər yenilər yuxarıda olmaqla sıralanıb

---

## 12. Özünüyoxlama çek-listi

Canlı proqramda klikləyərək **indi** bu siyahıdan keçin. Əgər nəsə uyğun gəlmirsə — harasa baq var, düzəliş növbəyə qoyulmalıdır.

### Əsas naviqasiya
- [ ] `/login` → admin kredensiyaları ilə giriş → `/budgeting`-ə redirect
- [ ] Sidebar 6 maddə göstərir: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Sağ üst küncdə tema keçidi (günəş/ay) işləyir

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER ağacı açılır, composite-score ilə 7 sub-co görünür (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: EDEN yanında `Sub` nişanı, AZSF yanında — `Opq` + `NoD`
- [ ] Panel 2: HeatMap 3 AZSEKER-* sətir göstərir (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: "Today's brief" yüklənir, mətn "subsidy-regime" və ya "non-transparent" qeydlərini ehtiva edir (bu AI Morning Brief risk bayraklarıyla)
- [ ] EDEN row, CUSTOMER_HHI sütunu qırmızı xanasına klik → Panel 3 `counterparty_hhi_customer` formulunu göstərir
- [ ] `Explain →` klikləyin → ~15s sonra narrativ + 3 tövsiyə görünür
- [ ] Tövsiyə #3-də **subsidy dependency** ilə (və ya əlaqəli) ifadə sitat gətirilir

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI başlığı var ("Food processing margin squeeze..." tipli)
- [ ] Holding composite score = **59** (yazı anında)
- [ ] Aşağı sürüşdürün → **"Qualitative Risk Flags"** bölməsi görünür
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN kartı → `Subsidy dependency` chip (amber)
- [ ] AZSEKER-AZSF kartı → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC kartı → `Subsidy dependency` + `Non-transparent structure`
- [ ] `Export PPTX`, `Export PDF`, `Print to PDF` düymələri var

### Büdcələmə (`/budgeting`)
- [ ] Yuxarıda 4 KPI kartı (Revenues / COGS / Expenses / Operating Profit)
- [ ] Tooltip ilə waterfall chart (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan seçicisi `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder işləyir

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity kartı: AZSEKER (100%) + 7 sub-co
- [ ] PROMALT MMC = 30% PENDING — yeganə PENDING
- [ ] Qalanları ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Landing 4 qrupda 16 kart göstərir
- [ ] `Импорт данных` və `Indicator Health` kartları `Phase 7 M` badge ilə işarələnib
- [ ] Bütün kartlara klikləmək olar

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] İki tab: `1 faylı` / `Bir neçə fayl` (yenisi `yeni` ilə işarələnib)
- [ ] Drop-zone var
- [ ] `Şəkkil 1: AI-təhlil vərəqləri` düyməsi var

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Xülasə: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Xəta kodu üzrə breakdown görünür
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] 6 entity cədvəl Score asc üzrə sıralanır (ən pisi əvvəl)
- [ ] HORIZON və PROMALT MMC aşağıda Thin tier ilə
- [ ] `Export CSV` düyməsi işləyir

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Hərəkət / Məlumat növü / Şirkət / İl / Səbəb / `ALL` təsdiq sahələri ilə forma
- [ ] `Arxivləmək (hesablamalardan gizlətmək)` radio defolt olaraq seçilib

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Yuxarıda Role & Status cədvəli 8 entity ilə
- [ ] Aşağıda genişləndirmə kartları ilə "Şirkət parametrləri"
- [ ] EDEN kartı içində — 8 kateqoriya ilə **Risk Registry** bölməsi
- [ ] Kateqoriyalar: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Ciddilik `● ● ●` dairələri ilə (emerald / amber / rose) göstərilir

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap-də `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE` sütunları var
- [ ] AZSF — hər 3 xana **qırmızı** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 hal, hamısı iddiaçı kimi)
- [ ] AZSF/AUDIT_MAJOR_OPEN qırmızı xanasına klik → Variance Explainer Major tapıntıları sitat gətirir

### Audit Log (`/budgeting/audit`)
- [ ] Hadisələr cədvəli, yenilər yuxarıda
- [ ] `ai_morning_brief_run`, `ai_variance_explainer_run` qeydləri var
- [ ] SUMMARY tokenlər + language + fromCache ilə JSON ehtiva edir

### AI çağırışları (Audit Log vasitəsilə)
- [ ] Son 24 saat ərzində ən azı bir `ai_variance_explainer_eyni`
- [ ] Bu gün üçün `ai_morning_brief_run` var
- [ ] `ai_board_deck_narration_run` var (Board Deck açıldıqda generasiya olunur)
- [ ] Eyni parametrlərlə təkrar sorğular üçün `fromCache: true`

---

## Nəsə pozularsa hara müraciət etmək lazımdır

| Simptom | Haraya baxmaq |
|---|---|
| Composite score yenidən hesablanmadı | `Risk Terminal → Recompute` düyməsi |
| AI brief köhnədir | Audit Log → son `ai_morning_brief_run` tapın → `fromCache` yoxlayın |
| HeatMap boşdur | `Indicator Health` → UNKNOWN breakdown yoxlayın |
| İdxal uğursuz oldu | `Admin → Drift Dashboard` → son events |
| İdxalı geri qaytarmaq lazımdır | `Admin → Data Archive` → məlumat növünü + il + səbəb seçin → ALL |
| Dövrü təsadüfən bağladıq | `Admin → Period Locks` → unlock + audit |

---

## Yoxlayan üçün texniki təfərrüatlar

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** `@anthropic-ai/sdk` vasitəsilə serverside caching ilə Anthropic Claude
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** 3000 portunda LaunchAgent (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Testlər:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band skaner + secret skaner (~150ms)
- **Migration policy:** bütün miqrasiyalar Prisma vasitəsilə + audit; 90 günlük fiziki purge cron ilə soft-delete
- **Cost guard rails:** rate-limits + token büdcələri + env-də LLM kill switch

---

> Sənəd 26 may 2026-cı il tarixində, Phase 7.N-nin (bütün 4 kanalda risk bayrakları) bağlanmasından sonra generasiya edilmişdir.
> Ekran görüntülərinin mənbəyi: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.

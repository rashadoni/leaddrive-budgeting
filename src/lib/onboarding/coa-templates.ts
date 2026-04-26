/**
 * Phase 7.B — Per-industry Chart-of-Accounts templates.
 *
 * Used by the onboarding wizard to populate `ChartOfAccount` for a new
 * operational company. Templates live in code (not the DB) because:
 *   - they're versioned with the release, not per-tenant
 *   - they ship with English + Azerbaijani + Russian names baked in
 *   - per-org overrides happen AFTER apply by editing the `ChartOfAccount`
 *     rows directly, so no "template fork" concept is needed
 *
 * Codes follow the SAP-style prefix convention already used in BudgetPro
 * (`6xx` = revenue, `7xx` = expense, `1xx` = asset, `2xx` = liability,
 * `3xx` = equity). That lets the existing analytics helpers continue to
 * work until Phase 5.1 replaces prefix-matching with `ChartOfAccount.role`.
 *
 * Apply is exposed as `applyCoaTemplate(tx, organizationId, industryCode)`;
 * it upserts on `(organizationId, code)` so re-running is safe and picks up
 * template updates when the product ships a new version.
 */

export type AccountType =
  | 'revenue'
  | 'expense'
  | 'cogs'
  | 'asset'
  | 'liability'
  | 'equity';

export interface CoaTemplateAccount {
  code: string;
  nameEn: string;
  nameAz?: string;
  nameRu?: string;
  parentCode?: string;
  accountType: AccountType;
  category?: string;
  sortOrder: number;
}

export interface CoaTemplate {
  industry: string;
  accounts: CoaTemplateAccount[];
}

// ── Shared building blocks ──────────────────────────────────────────────────
// Most industries share the same structural scaffolding (assets, liabilities,
// equity); only revenue + COGS + operating-expense categories differ.

const COMMON_BALANCE_SHEET: CoaTemplateAccount[] = [
  // Assets (1xx)
  { code: '100', nameEn: 'Current Assets', nameRu: 'Оборотные активы', accountType: 'asset', sortOrder: 1000 },
  { code: '101', parentCode: '100', nameEn: 'Cash & Bank', nameRu: 'Касса и банк', accountType: 'asset', sortOrder: 1010 },
  { code: '102', parentCode: '100', nameEn: 'Accounts Receivable', nameRu: 'Дебиторская задолженность', accountType: 'asset', sortOrder: 1020 },
  { code: '103', parentCode: '100', nameEn: 'Inventory', nameRu: 'Запасы', accountType: 'asset', sortOrder: 1030 },
  { code: '110', nameEn: 'Fixed Assets', nameRu: 'Основные средства', accountType: 'asset', sortOrder: 1100 },
  { code: '111', parentCode: '110', nameEn: 'Property, Plant & Equipment', nameRu: 'Здания, оборудование', accountType: 'asset', sortOrder: 1110 },
  { code: '112', parentCode: '110', nameEn: 'Accumulated Depreciation', nameRu: 'Накопленная амортизация', accountType: 'asset', sortOrder: 1120 },

  // Liabilities (2xx)
  { code: '200', nameEn: 'Current Liabilities', nameRu: 'Краткосрочные обязательства', accountType: 'liability', sortOrder: 2000 },
  { code: '201', parentCode: '200', nameEn: 'Accounts Payable', nameRu: 'Кредиторская задолженность', accountType: 'liability', sortOrder: 2010 },
  { code: '202', parentCode: '200', nameEn: 'Taxes Payable', nameRu: 'Налоги к уплате', accountType: 'liability', sortOrder: 2020 },
  { code: '210', nameEn: 'Long-term Liabilities', nameRu: 'Долгосрочные обязательства', accountType: 'liability', sortOrder: 2100 },
  { code: '211', parentCode: '210', nameEn: 'Long-term Debt', nameRu: 'Долгосрочные кредиты', accountType: 'liability', sortOrder: 2110 },

  // Equity (3xx)
  { code: '300', nameEn: 'Equity', nameRu: 'Капитал', accountType: 'equity', sortOrder: 3000 },
  { code: '301', parentCode: '300', nameEn: 'Share Capital', nameRu: 'Уставный капитал', accountType: 'equity', sortOrder: 3010 },
  { code: '302', parentCode: '300', nameEn: 'Retained Earnings', nameRu: 'Нераспределённая прибыль', accountType: 'equity', sortOrder: 3020 },
];

const COMMON_OPEX: CoaTemplateAccount[] = [
  { code: '750', nameEn: 'Personnel', nameRu: 'Персонал', accountType: 'expense', category: 'staff', sortOrder: 7500 },
  { code: '751', parentCode: '750', nameEn: 'Salaries', nameRu: 'Зарплаты', accountType: 'expense', category: 'staff', sortOrder: 7510 },
  { code: '752', parentCode: '750', nameEn: 'Payroll Taxes', nameRu: 'Налоги на ФОТ', accountType: 'expense', category: 'staff', sortOrder: 7520 },
  { code: '760', nameEn: 'Facilities', nameRu: 'Здания и эксплуатация', accountType: 'expense', category: 'utilities', sortOrder: 7600 },
  { code: '761', parentCode: '760', nameEn: 'Rent', nameRu: 'Аренда', accountType: 'expense', category: 'utilities', sortOrder: 7610 },
  { code: '762', parentCode: '760', nameEn: 'Utilities', nameRu: 'Коммунальные услуги', accountType: 'expense', category: 'utilities', sortOrder: 7620 },
  { code: '770', nameEn: 'Professional Services', nameRu: 'Профессиональные услуги', accountType: 'expense', category: 'services', sortOrder: 7700 },
  { code: '780', nameEn: 'Marketing', nameRu: 'Маркетинг', accountType: 'expense', category: 'services', sortOrder: 7800 },
  { code: '790', nameEn: 'Depreciation', nameRu: 'Амортизация', accountType: 'expense', category: 'depreciation', sortOrder: 7900 },
];

// ── Per-industry revenue + COGS sections ────────────────────────────────────

function industryTemplate(
  industry: string,
  revenue: CoaTemplateAccount[],
  cogs: CoaTemplateAccount[],
): CoaTemplate {
  return {
    industry,
    accounts: [...revenue, ...cogs, ...COMMON_OPEX, ...COMMON_BALANCE_SHEET],
  };
}

const HOSPITALITY: CoaTemplate = industryTemplate(
  'hospitality',
  [
    { code: '601', nameEn: 'Room Revenue', nameRu: 'Выручка от номеров', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'F&B Revenue', nameRu: 'Выручка F&B', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
    { code: '603', nameEn: 'Other Operational Revenue', nameRu: 'Прочая выручка', accountType: 'revenue', category: 'sales', sortOrder: 6030 },
  ],
  [
    { code: '711', nameEn: 'Room COGS', nameRu: 'Себестоимость номеров', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'F&B COGS', nameRu: 'Себестоимость F&B', accountType: 'cogs', sortOrder: 7120 },
  ],
);

const FOOD_PROCESSING: CoaTemplate = industryTemplate(
  'food_processing',
  [
    { code: '601', nameEn: 'Product Sales', nameRu: 'Продажа готовой продукции', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Byproduct Sales', nameRu: 'Продажа побочной продукции', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Raw Materials', nameRu: 'Сырьё', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Packaging', nameRu: 'Упаковка', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Production Labor', nameRu: 'Производственный персонал', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Production Energy', nameRu: 'Энергия производства', accountType: 'cogs', sortOrder: 7140 },
  ],
);

const AGRO_CROPS: CoaTemplate = industryTemplate(
  'agro_crops',
  [
    { code: '601', nameEn: 'Crop Sales', nameRu: 'Реализация урожая', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Subsidies & Grants', nameRu: 'Субсидии и гранты', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Seed', nameRu: 'Семена', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Fertiliser', nameRu: 'Удобрения', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Irrigation & Water', nameRu: 'Полив и вода', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Field Labor', nameRu: 'Полевой персонал', accountType: 'cogs', sortOrder: 7140 },
    { code: '715', nameEn: 'Harvest & Logistics', nameRu: 'Уборка и логистика', accountType: 'cogs', sortOrder: 7150 },
  ],
);

const POULTRY: CoaTemplate = industryTemplate(
  'poultry',
  [
    { code: '601', nameEn: 'Meat Sales', nameRu: 'Реализация мяса', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Egg Sales', nameRu: 'Реализация яиц', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Feed', nameRu: 'Корма', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Day-Old Chicks', nameRu: 'Суточные цыплята', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Veterinary', nameRu: 'Ветеринария', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Farm Labor', nameRu: 'Работники фермы', accountType: 'cogs', sortOrder: 7140 },
  ],
);

const PHARMA: CoaTemplate = industryTemplate(
  'pharma',
  [
    { code: '601', nameEn: 'Product Sales', nameRu: 'Реализация продукции', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Licensing Revenue', nameRu: 'Лицензионные платежи', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Active Ingredients', nameRu: 'Активные вещества', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Excipients & Packaging', nameRu: 'Вспомогательные и упаковка', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Quality Control', nameRu: 'Контроль качества', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Regulatory Fees', nameRu: 'Регуляторные сборы', accountType: 'cogs', sortOrder: 7140 },
  ],
);

const INDUSTRIAL: CoaTemplate = industryTemplate(
  'industrial',
  [
    { code: '601', nameEn: 'Finished Goods Sales', nameRu: 'Реализация готовой продукции', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Service Revenue', nameRu: 'Выручка услуг', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Raw Materials', nameRu: 'Сырьё и материалы', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Direct Labor', nameRu: 'Прямой труд', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Energy', nameRu: 'Энергия', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Maintenance', nameRu: 'Техобслуживание', accountType: 'cogs', sortOrder: 7140 },
  ],
);

const REAL_ESTATE: CoaTemplate = industryTemplate(
  'real_estate',
  [
    { code: '601', nameEn: 'Rental Income', nameRu: 'Арендная плата', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Sales of Units', nameRu: 'Продажа объектов', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Property Management', nameRu: 'Управление объектами', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Property Maintenance', nameRu: 'Обслуживание', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Property Taxes', nameRu: 'Налог на имущество', accountType: 'cogs', sortOrder: 7130 },
  ],
);

const ENTERTAINMENT: CoaTemplate = industryTemplate(
  'entertainment',
  [
    { code: '601', nameEn: 'Ticket Revenue', nameRu: 'Выручка от билетов', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'F&B Revenue', nameRu: 'Выручка F&B', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
    { code: '603', nameEn: 'Sponsorship Revenue', nameRu: 'Спонсорская выручка', accountType: 'revenue', category: 'sales', sortOrder: 6030 },
  ],
  [
    { code: '711', nameEn: 'Content & Talent', nameRu: 'Контент и артисты', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Venue Operations', nameRu: 'Эксплуатация площадок', accountType: 'cogs', sortOrder: 7120 },
  ],
);

const EDUCATION: CoaTemplate = industryTemplate(
  'education',
  [
    { code: '601', nameEn: 'Tuition', nameRu: 'Плата за обучение', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Grants & Donations', nameRu: 'Гранты и пожертвования', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Teaching Staff', nameRu: 'Преподавательский состав', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Teaching Materials', nameRu: 'Учебные материалы', accountType: 'cogs', sortOrder: 7120 },
  ],
);

const SERVICES: CoaTemplate = industryTemplate(
  'services',
  [
    { code: '601', nameEn: 'Service Revenue', nameRu: 'Выручка от услуг', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Retainer Fees', nameRu: 'Абонентская плата', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Billable Staff', nameRu: 'Проектный персонал', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Subcontractors', nameRu: 'Субподрядчики', accountType: 'cogs', sortOrder: 7120 },
  ],
);

// Phase 7.C-extension — 4 sectors added 2026-04-25 (beverage / retail /
// logistics / construction). Each follows the same revenue 6xx + cogs
// 7xx SAP-prefix pattern as the other 10 templates.

const BEVERAGE: CoaTemplate = industryTemplate(
  'beverage',
  [
    { code: '601', nameEn: 'Beverage Sales', nameRu: 'Реализация напитков', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Distribution Revenue', nameRu: 'Выручка от дистрибуции', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Raw Materials & Concentrate', nameRu: 'Сырьё и концентраты', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Bottling & Packaging', nameRu: 'Розлив и упаковка', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Excise & Duties', nameRu: 'Акцизы и пошлины', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Production Labor', nameRu: 'Производственный персонал', accountType: 'cogs', sortOrder: 7140 },
  ],
);

const RETAIL: CoaTemplate = industryTemplate(
  'retail',
  [
    { code: '601', nameEn: 'Store Sales', nameRu: 'Продажи в магазине', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'E-commerce Sales', nameRu: 'Онлайн-продажи', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
    { code: '603', nameEn: 'Loyalty / Membership Fees', nameRu: 'Программы лояльности', accountType: 'revenue', category: 'sales', sortOrder: 6030 },
  ],
  [
    { code: '711', nameEn: 'Goods for Resale', nameRu: 'Товары для перепродажи', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Inventory Shrinkage', nameRu: 'Списания и потери', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Store Operations', nameRu: 'Магазинные операции', accountType: 'cogs', sortOrder: 7130 },
  ],
);

const LOGISTICS: CoaTemplate = industryTemplate(
  'logistics',
  [
    { code: '601', nameEn: 'Freight Revenue', nameRu: 'Выручка от грузоперевозок', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Warehousing Revenue', nameRu: 'Выручка от хранения', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
    { code: '603', nameEn: 'Value-Added Services', nameRu: 'Сопутствующие услуги', accountType: 'revenue', category: 'sales', sortOrder: 6030 },
  ],
  [
    { code: '711', nameEn: 'Driver & Operator Pay', nameRu: 'Водители и операторы', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Fuel', nameRu: 'Топливо', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Fleet Maintenance', nameRu: 'Обслуживание автопарка', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Tolls & Customs', nameRu: 'Пошлины и таможня', accountType: 'cogs', sortOrder: 7140 },
  ],
);

const CONSTRUCTION: CoaTemplate = industryTemplate(
  'construction',
  [
    { code: '601', nameEn: 'Project Revenue', nameRu: 'Выручка по проектам', accountType: 'revenue', category: 'sales', sortOrder: 6010 },
    { code: '602', nameEn: 'Change Orders', nameRu: 'Дополнительные работы', accountType: 'revenue', category: 'sales', sortOrder: 6020 },
  ],
  [
    { code: '711', nameEn: 'Materials & Supplies', nameRu: 'Материалы и комплектующие', accountType: 'cogs', sortOrder: 7110 },
    { code: '712', nameEn: 'Subcontractors', nameRu: 'Субподрядчики', accountType: 'cogs', sortOrder: 7120 },
    { code: '713', nameEn: 'Direct Labor', nameRu: 'Прямой труд', accountType: 'cogs', sortOrder: 7130 },
    { code: '714', nameEn: 'Equipment Rental', nameRu: 'Аренда техники', accountType: 'cogs', sortOrder: 7140 },
    { code: '715', nameEn: 'Site Overhead', nameRu: 'Накладные стройплощадки', accountType: 'cogs', sortOrder: 7150 },
  ],
);

export const COA_TEMPLATES: readonly CoaTemplate[] = [
  HOSPITALITY,
  FOOD_PROCESSING,
  AGRO_CROPS,
  POULTRY,
  PHARMA,
  INDUSTRIAL,
  REAL_ESTATE,
  ENTERTAINMENT,
  EDUCATION,
  SERVICES,
  BEVERAGE,
  RETAIL,
  LOGISTICS,
  CONSTRUCTION,
];

/** Canonical industry code — snake_case, lowercase, trimmed. Matches the
 *  shape emitted by the companies-import pipeline so lookups are stable
 *  regardless of where the caller got the string from (wizard / API / seed). */
export function normalizeIndustryCode(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '_');
}

export function getCoaTemplate(industry: string): CoaTemplate | null {
  const key = normalizeIndustryCode(industry);
  return COA_TEMPLATES.find((t) => t.industry === key) ?? null;
}

export function listCoaIndustries(): readonly string[] {
  return COA_TEMPLATES.map((t) => t.industry);
}

/**
 * Shape of the rows this module hands off to a Prisma writer. The narrow
 * interface (not `Prisma.ChartOfAccountCreateManyInput`) keeps this file
 * testable against a simple mock.
 */
export interface CoaWriteRow {
  organizationId: string;
  code: string;
  name: string;
  nameAz: string | null;
  nameRu: string | null;
  nameEn: string | null;
  parentCode: string | null;
  accountType: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CoaWriter {
  writeRows(rows: CoaWriteRow[]): Promise<{ upserted: number }>;
}

/**
 * Expand a template into concrete `ChartOfAccount` rows for an org. Pure —
 * does not touch Prisma; the caller provides a `CoaWriter`.
 *
 * Throws if the industry has no template (loud failure is better than a
 * silent no-op — onboarding should match industry codes exactly).
 */
export async function applyCoaTemplate(
  writer: CoaWriter,
  organizationId: string,
  industry: string,
): Promise<{ industry: string; upserted: number }> {
  const template = getCoaTemplate(industry);
  if (!template) {
    throw new Error(
      `No CoA template registered for industry "${industry}". Available: ${listCoaIndustries().join(', ')}`,
    );
  }
  const rows: CoaWriteRow[] = template.accounts.map((a) => ({
    organizationId,
    code: a.code,
    // `name` is the legacy primary-language field; default to English so
    // existing analytics that read `account.name` still work.
    name: a.nameEn,
    nameEn: a.nameEn,
    nameAz: a.nameAz ?? null,
    nameRu: a.nameRu ?? null,
    parentCode: a.parentCode ?? null,
    accountType: a.accountType,
    category: a.category ?? null,
    sortOrder: a.sortOrder,
    isActive: true,
  }));
  const { upserted } = await writer.writeRows(rows);
  return { industry, upserted };
}

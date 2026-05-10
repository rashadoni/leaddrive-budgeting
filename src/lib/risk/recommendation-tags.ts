/**
 * Phase 7.G Turn LXXXXVIII (Phase 7.E #2 v2 E.1c) — recommendation taxonomy.
 *
 * CFO recommendations have a finite verb-set in practice (per analysis of
 * variance-explainer outputs across 60+ POC runs). Tagging each recommendation
 * with a category lets the UI render an icon (visual scan-ability) and lets
 * downstream analytics aggregate by action class ("how many cost-cutting
 * recommendations did the LLM produce in Q3?").
 *
 * Taxonomy is intentionally finite + non-exhaustive. Recommendations that
 * don't match any tag get tagged `other`. Future expansion: open a new tag
 * when 3+ POC outputs share a verb pattern not covered.
 */

export type RecommendationTag =
  | "hedge"          // FX hedge, commodity hedge, rate lock
  | "renegotiate"    // supplier/customer/lease/contract terms
  | "monitor"        // watchlist, dashboard, KPI tracking
  | "cut-cost"       // headcount freeze, expense reduction
  | "raise-price"    // pricing action
  | "shift-mix"      // channel/product/segment reallocation
  | "audit"          // data quality / classification fix
  | "hire"           // staff up
  | "pause-capex"    // freeze/defer capital project
  | "exit"           // shut down product/region/contract
  | "other"

const TAG_PATTERNS: Array<{ tag: RecommendationTag; patterns: RegExp[] }> = [
  // ORDER MATTERS: first-match-wins. More specific patterns earlier.
  {
    tag: "hedge",
    patterns: [/\bhedge\b/i, /\bforward\s+contract\b/i, /\brate\s+lock\b/i, /хедж/i, /hejlinq/i],
  },
  {
    tag: "renegotiate",
    patterns: [/\brenegotiat/i, /пересмотр.*контракт/i, /yenidən.*razılaş/i, /sözləşm.*yenidən/i, /revise.*contract/i],
  },
  {
    tag: "raise-price",
    patterns: [/\braise\s+(adr|price|rate)/i, /\bincrease\s+(adr|price|rate)/i, /\bprice.*increase/i, /поднять.*цен/i, /qiymət.*qaldır/i],
  },
  {
    tag: "pause-capex",
    patterns: [/\b(pause|defer|freeze)\s+(capex|capital|project|hilton|renovation)/i, /capex.*(pause|defer|freeze)/i, /отложить.*проект/i, /layihə.*dayandır/i],
  },
  {
    tag: "cut-cost",
    patterns: [
      /\bcut\s+\w*\s*(cost|spend|expense|budget|marketing|opex)/i,
      /\bfreeze\b.*\b(hire|hir|spend|budget|admin)/i,
      /\breduce\s+(spend|expense|opex|cost)/i,
      /сократ/i,
      /xərc.*kəsmək/i,
      /xərc.*kəsim/i,
    ],
  },
  {
    tag: "shift-mix",
    patterns: [/\bshift\b.*\b(channel|product|segment|mix|spend)/i, /\breallocat/i, /перенаправ/i, /yönləndir/i],
  },
  {
    tag: "audit",
    patterns: [/\baudit\b/i, /\bverify\s+(data|classific)/i, /\breclassif/i, /проверь.*класс/i, /yoxla/i],
  },
  {
    tag: "hire",
    patterns: [/\bhire\b(?!.*freeze)/i, /\bstaff\s+up\b/i, /\brecruit\b/i, /найми/i, /işə\s+götür/i],
  },
  {
    tag: "exit",
    patterns: [/\bexit\b.*\b(market|product|region|contract)/i, /\bshut\s+down\b/i, /\bdiscontinue\b/i, /закрыть/i, /bağla/i],
  },
  {
    tag: "monitor",
    patterns: [/\bmonitor\b/i, /\bwatch.list\b/i, /\btrack\b.*\b(weekly|daily|monthly)\b/i, /отслеж/i, /izləy/i],
  },
]

/**
 * Tag a single recommendation string. Returns `'other'` when no patterns match.
 * Multi-tag is NOT supported (intentional — taxonomy targets primary verb).
 * If multiple patterns match, first-match-wins (taxonomy order).
 */
export function tagRecommendation(text: string): RecommendationTag {
  for (const { tag, patterns } of TAG_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return tag
  }
  return "other"
}

/**
 * Tag an array of recommendations. Returns parallel array of tags.
 * Used by `runExplainer` consumers (route handler) to surface tags
 * alongside text without modifying VarianceExplainerOutput shape.
 */
export function tagRecommendations(recommendations: string[]): RecommendationTag[] {
  return recommendations.map(tagRecommendation)
}

/**
 * Localised display label for each tag. For UI tooltip / filter pill text.
 */
export const RECOMMENDATION_TAG_LABEL: Record<RecommendationTag, { en: string; ru: string; az: string }> = {
  hedge: { en: "Hedge", ru: "Хеджирование", az: "Hejlinq" },
  renegotiate: { en: "Renegotiate", ru: "Пересмотреть", az: "Yenidən razılaşdır" },
  monitor: { en: "Monitor", ru: "Мониторинг", az: "İzləmə" },
  "cut-cost": { en: "Cut cost", ru: "Сократить расход", az: "Xərc kəsimi" },
  "raise-price": { en: "Raise price", ru: "Поднять цену", az: "Qiymət qaldır" },
  "shift-mix": { en: "Shift mix", ru: "Перераспределить", az: "Yenidən bölüş" },
  audit: { en: "Audit data", ru: "Проверить данные", az: "Datanı yoxla" },
  hire: { en: "Hire", ru: "Нанять", az: "İşə götür" },
  "pause-capex": { en: "Pause CapEx", ru: "Заморозить CapEx", az: "CapEx-i dayandır" },
  exit: { en: "Exit", ru: "Закрыть", az: "Bağla" },
  other: { en: "Other", ru: "Другое", az: "Digər" },
}

/**
 * Phase 7.H Feature B — news-derived indicator seeds.
 *
 * V1 ships ONE indicator: rolling-30-day average sentiment score
 * computed from IntelItems tagged with the company's code. Future
 * news-derived indicators (supply-risk, regulatory-pressure, climate
 * mentions) land in this same file under category="news".
 *
 * Source data: IntelItem.sentimentScore in [-1, +1], averaged across
 * the trailing 30 days. Resolver `news.sentiment30d` exposes the avg
 * as `news_sentiment_30d` in the formula context.
 *
 * Display scale: multiplied by 100 so cells render as -100..+100 (more
 * intuitive than -1..+1 in a small-pixel matrix cell).
 */

import type { IndicatorSeed } from "./indicator-seeds"

export const newsIndicators: IndicatorSeed[] = [
  {
    code: "IND_NEWS_SENTIMENT_30D",
    nameEn: "News sentiment (30-day)",
    nameRu: "Тональность новостей (30 дней)",
    nameAz: "Xəbər tonallığı (30 gün)",
    category: "news",
    industries: [], // applies to all companies — any sector can have news
    unit: "score",
    direction: "higher_better",
    // news_sentiment_30d ∈ [-1, +1] from resolver. Scale to [-100, +100]
    // for matrix-cell legibility.
    formula: "news_sentiment_30d * 100",
    thresholds: {
      // ≥ +10 → markedly positive coverage → green
      green: { op: ">=", value: 10 },
      // -30..+10 → mixed/neutral → amber
      amber: { op: ">=", value: -30 },
      // ≤ -30 → markedly negative coverage → red (board-level concern)
      red: { op: "<", value: -30 },
    },
    hintTemplateEn:
      "News sentiment {value}/100 over last 30 days — {status}. AI-scored from {n_items} articles tagged with this company.",
    hintTemplateRu:
      "Тональность новостей {value}/100 за 30 дней — {status}. AI-оценка по {n_items} статьям с упоминанием компании.",
    hintTemplateAz:
      "Xəbər tonallığı {value}/100 son 30 gün — {status}. AI-qiymətləndirmə şirkət haqqında {n_items} məqalədən.",
    requiredInputs: ["news.sentiment30d"],
    sortOrder: 950,
  },
]

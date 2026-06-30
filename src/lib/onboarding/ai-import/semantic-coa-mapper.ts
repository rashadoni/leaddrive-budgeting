import type { PrismaClient } from "@prisma/client"
import type { AccountType } from "../ai-mapper/types"
import type { SemanticCoaDecision } from "./adapter-registry"

export type SemanticDataType = "PLF" | "BS" | "CF"

export interface SemanticCoaAccount {
  code: string
  name: string
  nameAz?: string | null
  nameRu?: string | null
  nameEn?: string | null
  accountType: AccountType
}

export interface SemanticCoaMatch {
  code: string
  accountType: AccountType
  confidence: number
  source: "existing-coa" | "standard-dictionary"
  matchedLabel: string
  reasoning: string
}

interface StandardRule {
  code: string
  dataType: SemanticDataType
  accountType: AccountType
  labels: string[]
}

const HIGH_CONFIDENCE = 0.78

const STANDARD_RULES: StandardRule[] = [
  {
    dataType: "PLF",
    code: "PLF.01.01.01",
    accountType: "revenue",
    labels: [
      "revenue",
      "sales revenue",
      "sales",
      "net sales",
      "product sales",
      "gross revenue",
      "subsidies",
    ],
  },
  {
    dataType: "PLF",
    code: "PLF.02.01.01",
    accountType: "cogs",
    labels: ["cogs", "cost of goods sold", "cost of sales", "raw materials", "direct costs", "production cost"],
  },
  {
    dataType: "PLF",
    code: "PLF.04.01.01",
    accountType: "expense",
    labels: ["sales and marketing", "marketing", "advertising", "distribution expenses", "selling expenses"],
  },
  {
    dataType: "PLF",
    code: "PLF.05.01.01",
    accountType: "expense",
    labels: ["staff costs", "payroll", "salary", "salaries", "wages", "employee benefits"],
  },
  {
    dataType: "PLF",
    code: "PLF.06.01.01",
    accountType: "expense",
    labels: ["opex", "operating expenses", "admin expenses", "administrative expenses", "general expenses"],
  },
  {
    dataType: "PLF",
    code: "PLF.12.01.01",
    accountType: "expense",
    labels: ["other costs", "other expenses", "miscellaneous expenses", "finance costs"],
  },
  {
    dataType: "BS",
    code: "BS.01.01.01",
    accountType: "asset",
    labels: ["ppe", "property plant equipment", "fixed assets", "non-current assets", "equipment", "land"],
  },
  {
    dataType: "BS",
    code: "BS.01.02.01",
    accountType: "asset",
    labels: ["cash", "cash equivalents", "cash and cash equivalents", "bank", "bank balances"],
  },
  {
    dataType: "BS",
    code: "BS.01.02.02",
    accountType: "asset",
    labels: ["receivables", "trade receivables", "accounts receivable", "customer receivables"],
  },
  {
    dataType: "BS",
    code: "BS.01.02.03",
    accountType: "asset",
    labels: ["inventory", "inventories", "stock", "raw material inventory", "finished goods"],
  },
  {
    dataType: "BS",
    code: "BS.02.01.01",
    accountType: "equity",
    labels: ["equity", "share capital", "charter capital", "capital", "retained earnings"],
  },
  {
    dataType: "BS",
    code: "BS.03.01.01",
    accountType: "liability",
    labels: ["long term loans", "long-term loans", "non-current liabilities", "borrowings long term"],
  },
  {
    dataType: "BS",
    code: "BS.03.02.01",
    accountType: "liability",
    labels: ["loans payable", "short term loans", "short-term loans", "current borrowings", "bank loans"],
  },
  {
    dataType: "BS",
    code: "BS.03.02.02",
    accountType: "liability",
    labels: ["payables", "trade payables", "accounts payable", "supplier payables"],
  },
  {
    dataType: "CF",
    code: "CF.01.01.01",
    accountType: "revenue",
    labels: ["cash received from customers", "customer receipts", "receipts from customers", "operating inflow"],
  },
  {
    dataType: "CF",
    code: "CF.01.02.01",
    accountType: "expense",
    labels: ["payments to suppliers", "supplier payments", "cash paid to suppliers", "operating outflow"],
  },
  {
    dataType: "CF",
    code: "CF.01.02.02",
    accountType: "expense",
    labels: ["payroll paid", "salary paid", "wages paid", "employee payments"],
  },
  {
    dataType: "CF",
    code: "CF.02.01.01",
    accountType: "revenue",
    labels: ["asset sale proceeds", "proceeds from sale of assets", "sale of ppe"],
  },
  {
    dataType: "CF",
    code: "CF.02.02.01",
    accountType: "expense",
    labels: ["capex", "purchase of ppe", "capital expenditure", "asset purchase", "purchase of fixed assets"],
  },
  {
    dataType: "CF",
    code: "CF.03.01.01",
    accountType: "liability",
    labels: ["loan proceeds", "borrowings received", "financing inflow", "debt proceeds"],
  },
  {
    dataType: "CF",
    code: "CF.03.02.01",
    accountType: "liability",
    labels: ["loan repayment", "debt repayment", "borrowings repaid", "financing outflow"],
  },
]

const DERIVED_LABEL_RE =
  /\b(total|subtotal|gross profit|gross margin|ebitda|ebit|net profit|net income|opening|closing|balance at|change in cash)\b/i

export function normalizeSemanticCoaLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[ə]/g, "e")
    .replace(/[ı]/g, "i")
    .replace(/[ğ]/g, "g")
    .replace(/[ş]/g, "s")
    .replace(/[ç]/g, "c")
    .replace(/[ö]/g, "o")
    .replace(/[ü]/g, "u")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function tokens(label: string): Set<string> {
  return new Set(
    normalizeSemanticCoaLabel(label)
      .split(" ")
      .filter((token) => token.length > 2),
  )
}

function tokenScore(a: string, b: string): number {
  const at = tokens(a)
  const bt = tokens(b)
  if (at.size === 0 || bt.size === 0) return 0
  let overlap = 0
  for (const token of at) if (bt.has(token)) overlap++
  return overlap / Math.max(at.size, bt.size)
}

function labelScore(input: string, candidate: string): number {
  const a = normalizeSemanticCoaLabel(input)
  const b = normalizeSemanticCoaLabel(candidate)
  if (!a || !b) return 0
  if (a === b) return 0.97
  if (a.length >= 5 && b.includes(a)) return 0.9
  if (b.length >= 5 && a.includes(b)) return 0.88
  const score = tokenScore(a, b)
  if (score >= 0.75) return 0.82
  if (score >= 0.5) return 0.7
  return 0
}

function codePrefixFor(dataType: SemanticDataType): string {
  if (dataType === "PLF") return "PLF."
  if (dataType === "BS") return "BS."
  return "CF."
}

function isLeafCodeFor(dataType: SemanticDataType, code: string): boolean {
  if (dataType === "PLF") {
    return /^PLF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/i.test(code)
  }
  if (dataType === "BS") {
    return /^BS\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/i.test(code)
  }
  return /^CF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/i.test(code)
}

function ruleCandidates(dataType: SemanticDataType): SemanticCoaAccount[] {
  return STANDARD_RULES.filter((rule) => rule.dataType === dataType).flatMap(
    (rule) =>
      rule.labels.map((label) => ({
        code: rule.code,
        name: label,
        accountType: rule.accountType,
      })),
  )
}

export function findApprovedSemanticCoaDecision(
  label: string,
  decisions: readonly SemanticCoaDecision[] | undefined,
): SemanticCoaDecision | null {
  if (!decisions || decisions.length === 0) return null
  const normalized = normalizeSemanticCoaLabel(label)
  if (!normalized) return null
  return (
    decisions.find(
      (decision) =>
        normalizeSemanticCoaLabel(decision.sourceLabel) === normalized,
    ) ?? null
  )
}

export function isDerivedFinancialLabel(label: string): boolean {
  return DERIVED_LABEL_RE.test(label)
}

export async function loadSemanticCoaAccounts(
  prisma: PrismaClient,
  organizationId: string,
  dataType: SemanticDataType,
): Promise<SemanticCoaAccount[]> {
  const maybeClient = prisma as PrismaClient & {
    chartOfAccount?: {
      findMany?: (args: unknown) => Promise<SemanticCoaAccount[]>
    }
  }
  if (!maybeClient.chartOfAccount?.findMany) return ruleCandidates(dataType)
  try {
    const prefix = codePrefixFor(dataType)
    const rows = await maybeClient.chartOfAccount.findMany({
      where: {
        organizationId,
        code: { startsWith: prefix },
        isActive: true,
      },
      select: {
        code: true,
        name: true,
        nameAz: true,
        nameRu: true,
        nameEn: true,
        accountType: true,
      },
    })
    const typedRows: SemanticCoaAccount[] = rows
      .filter((row) => isLeafCodeFor(dataType, row.code))
      .map((row) => ({
        ...row,
        accountType: row.accountType as AccountType,
      }))
    return [...typedRows, ...ruleCandidates(dataType)]
  } catch {
    return ruleCandidates(dataType)
  }
}

export function resolveSemanticCoaLabel(input: {
  dataType: SemanticDataType
  label: string
  accounts: readonly SemanticCoaAccount[]
  minConfidence?: number
}): SemanticCoaMatch | null {
  const label = input.label.trim()
  if (!label || isDerivedFinancialLabel(label)) return null

  const candidates = rankSemanticCoaCandidates(input)
  const best = candidates[0]
  if (!best) return null
  const second = candidates[1]
  const minConfidence = input.minConfidence ?? HIGH_CONFIDENCE
  if (best.confidence < minConfidence) return null
  if (second && best.confidence - second.confidence < 0.08) return null
  return best
}

export function rankSemanticCoaCandidates(input: {
  dataType: SemanticDataType
  label: string
  accounts: readonly SemanticCoaAccount[]
  minScore?: number
  limit?: number
}): SemanticCoaMatch[] {
  const label = input.label.trim()
  if (!label || isDerivedFinancialLabel(label)) return []

  const candidates: SemanticCoaMatch[] = []
  const dataTypePrefix = codePrefixFor(input.dataType)
  for (const account of input.accounts) {
    if (!account.code.startsWith(dataTypePrefix)) continue
    const labels = [account.name, account.nameEn, account.nameRu, account.nameAz].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    let best = 0
    let matchedLabel = account.name
    for (const candidateLabel of labels) {
      const score = labelScore(label, candidateLabel)
      if (score > best) {
        best = score
        matchedLabel = candidateLabel
      }
    }
    if (best <= 0) continue
    const source = STANDARD_RULES.some(
      (rule) => rule.dataType === input.dataType && rule.code === account.code,
    )
      ? "standard-dictionary"
      : "existing-coa"
    candidates.push({
      code: account.code,
      accountType: account.accountType,
      confidence: source === "existing-coa" ? Math.min(0.99, best + 0.02) : best,
      source,
      matchedLabel,
      reasoning: `${source} matched "${label}" to "${matchedLabel}"`,
    })
  }

  const bestByCode = new Map<string, SemanticCoaMatch>()
  for (const candidate of candidates) {
    const prior = bestByCode.get(candidate.code)
    if (!prior || candidate.confidence > prior.confidence) {
      bestByCode.set(candidate.code, candidate)
    }
  }
  const ranked = [...bestByCode.values()].sort(
    (a, b) => b.confidence - a.confidence,
  )
  return ranked
    .filter((candidate) => candidate.confidence >= (input.minScore ?? 0))
    .slice(0, input.limit ?? ranked.length)
}

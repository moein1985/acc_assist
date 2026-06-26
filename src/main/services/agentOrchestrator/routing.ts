/**
 * Prompt routing and intent-classification helpers extracted from
 * `agentOrchestrator.ts` (FRE Roadmap F2.1). These are pure functions with
 * no orchestrator state — they classify prompts and extract year comparisons
 * using only text normalization utilities.
 */
import { normalizePersianDigits, normalizePersianText } from '../textNormalization'

/**
 * Heuristic: does the text contain a financial claim/keyword?
 * Used by routing, evidence-contract, and strict-fetch guards.
 */
export function appearsToContainFinancialClaim(text: string): boolean {
  const normalized = normalizePersianDigits(text)
  const strongFinancialSignal =
    /(?:total|amount|balance|sales|revenue|cash\s*flow|receivable|payable|debit|credit|موجودی|مانده|مبلغ|فروش|درآمد|دریافت|پرداخت|جمع|گردش|بدهکار|بستانکار|account|جریان\s*نقد|حساب|ledger|voucher|invoice)/iu.test(
      normalized
    )
  const fiscalYearSignal =
    /(?:سال\s*مالی|fiscal\s*year|financial\s*year)/iu.test(normalized) &&
    /(?:چند|تعداد|لیست|فهرست|کدام|وجود|قرار|دارد|count|list|year)/iu.test(normalized)

  return strongFinancialSignal || fiscalYearSignal
}

/**
 * Detects multi-period comparative prompts (e.g. "فروش 1403 در مقابل 1402").
 * Such prompts require at least one successful fetch per period.
 */
export function isComparativeMultiPeriodPrompt(prompt: string): boolean {
  const normalizedPrompt = normalizePersianText(prompt)
  const years = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []
  const uniqueYears = new Set(years)
  if (uniqueYears.size < 2) {
    return false
  }
  const hasComparativeKeyword =
    /(?:نسبت\s*به|در\s*مقابل|مقایسه|قیاس|رشد|کاهش|افزایش|افت|change|growth|decline|versus|\bvs\.?\b|year\s*over\s*year|yoy)/iu.test(
      normalizedPrompt
    )
  const hasFinancialContext =
    appearsToContainFinancialClaim(normalizedPrompt) ||
    /(?:خرید|purchase|sales|درآمد|revenue)/iu.test(normalizedPrompt)
  return hasComparativeKeyword && hasFinancialContext
}

/**
 * Detects sales-growth percentage prompts, including comparative multi-period
 * prompts that imply percentage change even without an explicit '%' keyword.
 */
export function isSalesGrowthPercentPrompt(prompt: string): boolean {
  const normalizedPrompt = normalizePersianText(prompt)

  const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt)
  const hasPercentSignal = /(?:درصد|percent|percentage|%)/iu.test(normalizedPrompt)
  const hasChangeSignal = /(?:رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه)/iu.test(
    normalizedPrompt
  )
  const yearMatches = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []

  const isComparativeMultiPeriod = isComparativeMultiPeriodPrompt(prompt)

  return (
    (hasSalesSignal && hasPercentSignal && hasChangeSignal && yearMatches.length >= 2) ||
    (isComparativeMultiPeriod && hasSalesSignal && yearMatches.length >= 2)
  )
}

/**
 * Extracts a base/target year pair from a comparative prompt.
 * Prefers an explicit "X نسبت به Y" pattern; otherwise uses the two most
 * recent years (latest = target, previous = base).
 */
export function extractYearComparison(
  prompt: string
): { targetYear: number; baseYear: number } | null {
  const normalizedPrompt = normalizePersianText(prompt)

  const explicitMatch = normalizedPrompt.match(
    /\b((?:13|14|19|20)\d{2})\b.{0,40}?نسبت\s*به.{0,40}?\b((?:13|14|19|20)\d{2})\b/iu
  )
  if (explicitMatch) {
    return {
      targetYear: Number(explicitMatch[1]),
      baseYear: Number(explicitMatch[2])
    }
  }

  const years = (normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []).map((item) =>
    Number(item)
  )
  const uniqueYears = Array.from(new Set(years))

  if (uniqueYears.length < 2) {
    return null
  }

  uniqueYears.sort((a, b) => a - b)
  return {
    targetYear: uniqueYears[uniqueYears.length - 1],
    baseYear: uniqueYears[uniqueYears.length - 2]
  }
}

import type {
  MetricPlan,
  MetricId,
  Grain,
  PlanFilter,
  MultiMetricPlan,
  MultiStepPlan
} from './types'
import { metricPlanSchema, multiMetricPlanSchema, multiStepPlanSchema } from './types'
import { findMetricById, getMetricCatalog } from './metricCatalog'

// S21.9 — Detect query language (Persian vs English)
export function detectQueryLanguage(prompt: string): 'fa' | 'en' {
  const persianChars = (prompt.match(/[\u0600-\u06FF]/g) ?? []).length
  const latinChars = (prompt.match(/[a-zA-Z]/g) ?? []).length
  return latinChars > persianChars ? 'en' : 'fa'
}
import { normalizePersianText, normalizePersianDigits } from '../textNormalization'
import { routeMultiMetric } from './router'
import {
  persianToGregorian,
  persianYearStart,
  persianYearEnd,
  persianMonthStart,
  persianMonthEnd,
  PERSIAN_MONTH_NAME_TO_NUM
} from './persianDateUtils'

// --- S10.8: Current Persian year ---
// CONVERSATIONAL_PLANNER: auto-fills current year, entity patterns, date ranges
function getCurrentPersianYear(): string {
  const now = new Date()
  const gregorianYear = now.getFullYear()
  const gregorianMonth = now.getMonth() + 1
  const gregorianDay = now.getDate()
  // Simple conversion: Persian year = Gregorian year - 621 (adjust for March 21)
  // Before Nowruz (March 21), subtract one more
  let persianYear = gregorianYear - 621
  if (gregorianMonth < 3 || (gregorianMonth === 3 && gregorianDay < 21)) {
    persianYear--
  }
  return String(persianYear)
}

// --- S10.10: Persian month name to number ---
const PERSIAN_MONTHS: Record<string, string> = {
  'فروردین': '01',
  'اردیبهشت': '02',
  'خرداد': '03',
  'تیر': '04',
  'مرداد': '05',
  'شهریور': '06',
  'مهر': '07',
  'آبان': '08',
  'آذر': '09',
  'دی': '10',
  'بهمن': '11',
  'اسفند': '12'
}

// --- LRU cache for buildDeterministicPlan (S9.14) ---
const PLAN_CACHE_MAX = 100
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000
const planCache = new Map<string, { result: MetricPlan | null; expires: number }>()

function getCachedPlan(key: string): { hit: true; result: MetricPlan | null } | { hit: false } {
  const entry = planCache.get(key)
  if (!entry) return { hit: false }
  if (Date.now() > entry.expires) {
    planCache.delete(key)
    return { hit: false }
  }
  return { hit: true, result: entry.result }
}

function setCachedPlan(key: string, result: MetricPlan | null): void {
  if (planCache.size >= PLAN_CACHE_MAX) {
    const firstKey = planCache.keys().next().value
    if (firstKey) planCache.delete(firstKey)
  }
  planCache.set(key, { result, expires: Date.now() + PLAN_CACHE_TTL_MS })
}

/**
 * S14.2: Parse date range from Persian prompts.
 *
 * Supported patterns:
 * - "از 1403/05/01 تا 1403/05/31" → explicit Persian dates
 * - "از فروردین تا مرداد 1403" → month name range with year
 * - "از 1 خرداد تا 15 تیر 1403" → day + month name range with year
 * - "ماه 5 سال 1403" → single month
 * - "نیمه دوم سال 1403" → second half (months 7-12)
 * - "از 1 تا 15 خرداد 1403" → day range within a month
 */
function parseDateRange(
  normalized: string,
  yearMatches: string[] | null
): { start?: string; end?: string } | undefined {
  const year = yearMatches && yearMatches.length > 0 ? Number(yearMatches[0]) : Number(getCurrentPersianYear())

  // Pattern 1: "از YYYY/MM/DD تا YYYY/MM/DD"
  const explicitRangeMatch = normalized.match(
    /از\s*(\d{4})[/](\d{1,2})[/](\d{1,2})\s*تا\s*(\d{4})[/](\d{1,2})[/](\d{1,2})/u
  )
  if (explicitRangeMatch) {
    const startY = Number(explicitRangeMatch[1])
    const startM = Number(explicitRangeMatch[2])
    const startD = Number(explicitRangeMatch[3])
    const endY = Number(explicitRangeMatch[4])
    const endM = Number(explicitRangeMatch[5])
    const endD = Number(explicitRangeMatch[6])
    if (
      startY >= 1300 && startY <= 1500 && endY >= 1300 && endY <= 1500 &&
      startM >= 1 && startM <= 12 && endM >= 1 && endM <= 12 &&
      startD >= 1 && startD <= 31 && endD >= 1 && endD <= 31
    ) {
      return {
        start: persianToGregorian(startY, startM, startD),
        end: persianToGregorian(endY, endM, endD)
      }
    }
  }

  // Pattern 2: "از <monthName> تا <monthName> <year>"
  const monthNameRange = normalized.match(
    /از\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*تا\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/u
  )
  if (monthNameRange) {
    const startMonthNum = PERSIAN_MONTH_NAME_TO_NUM[monthNameRange[1]!]
    const endMonthNum = PERSIAN_MONTH_NAME_TO_NUM[monthNameRange[2]!]
    if (startMonthNum && endMonthNum) {
      return {
        start: persianMonthStart(year, startMonthNum),
        end: persianMonthEnd(year, endMonthNum)
      }
    }
  }

  // Pattern 3: "از <day> <monthName> تا <day> <monthName> <year>"
  const dayMonthRange = normalized.match(
    /از\s*(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*تا\s*(\d{1,2})\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/u
  )
  if (dayMonthRange) {
    const startDay = Number(dayMonthRange[1])
    const startMonthNum = PERSIAN_MONTH_NAME_TO_NUM[dayMonthRange[2]!]
    const endDay = Number(dayMonthRange[3])
    const endMonthNum = PERSIAN_MONTH_NAME_TO_NUM[dayMonthRange[4]!]
    if (
      startMonthNum && endMonthNum &&
      startDay >= 1 && startDay <= 31 && endDay >= 1 && endDay <= 31
    ) {
      return {
        start: persianToGregorian(year, startMonthNum, startDay),
        end: persianToGregorian(year, endMonthNum, endDay)
      }
    }
  }

  // Pattern 4: "ماه <N> سال <year>" or "ماه <N> <year>"
  const singleMonthMatch = normalized.match(/ماه\s*(\d{1,2})\s*(?:سال\s*)?(\d{4})?/u)
  if (singleMonthMatch) {
    const monthNum = Number(singleMonthMatch[1])
    const monthYear = singleMonthMatch[2] ? Number(singleMonthMatch[2]) : year
    if (monthNum >= 1 && monthNum <= 12) {
      return {
        start: persianMonthStart(monthYear, monthNum),
        end: persianMonthEnd(monthYear, monthNum)
      }
    }
  }

  // Pattern 5: "نیمه دوم سال <year>"
  if (/نیمه\s*دوم/u.test(normalized)) {
    return {
      start: persianMonthStart(year, 7),
      end: persianMonthEnd(year, 12)
    }
  }

  // Pattern 6: "نیمه اول سال <year>" (already handled by month filter, but also set dateRange)
  if (/نیمه\s*اول/u.test(normalized)) {
    return {
      start: persianMonthStart(year, 1),
      end: persianMonthEnd(year, 6)
    }
  }

  // Pattern 7: Year-only range "از <year> تا <year>" — convert to full year boundaries
  const yearRangeMatch = normalized.match(/از\s*(\d{4})\s*تا\s*(\d{4})/u)
  if (yearRangeMatch && !explicitRangeMatch) {
    const startY = Number(yearRangeMatch[1])
    const endY = Number(yearRangeMatch[2])
    if (startY >= 1300 && startY <= 1500 && endY >= 1300 && endY <= 1500) {
      return {
        start: persianYearStart(startY),
        end: persianYearEnd(endY)
      }
    }
  }

  return undefined
}

export function buildDeterministicPlan(prompt: string, metricId: MetricId): MetricPlan | null {
  const def = findMetricById(metricId)
  if (!def) return null

  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  const cacheKey = `${metricId}::${normalized}`
  const cached = getCachedPlan(cacheKey)
  if (cached.hit) return cached.result

  const filters: PlanFilter[] = []
  let grain: Grain = 'total'
  let entityName: string | undefined
  let comparison: MetricPlan['comparison'] | undefined

  // S36.8b: Year filtering should work if either grainSupported includes 'by_year'
  // OR the metric has a by_year dimension defined (e.g. list metrics like unbalanced_vouchers)
  const hasYearDimension = def.dimensions.some(d => d.dimension === 'by_year')
  const canFilterByYear = def.grainSupported.includes('by_year') || hasYearDimension

  const yearMatches = normalized.match(/(\d{4})/g)
  if (yearMatches && yearMatches.length > 0) {
    const years = [...new Set(yearMatches)]
    const rangePattern = /از\s*(\d{4})\s*تا\s*(\d{4})/u.test(normalized)
    if (years.length >= 3 && def.grainSupported.includes('by_year') && !rangePattern) {
      // S11.13: 3+ years → use 'in' filter with by_year grain
      filters.push({ dimension: 'by_year', op: 'in', values: years })
      if (def.grainSupported.includes('by_year')) {
        grain = 'by_year'
      }
    } else if (years.length >= 2 && def.grainSupported.includes('by_year') && !rangePattern) {
      comparison = {
        dimension: 'by_year',
        baseValue: years[0]!,
        targetValue: years[1]!
      }
    } else if (years.length >= 2 && canFilterByYear && rangePattern) {
      const rangeMatch = normalized.match(/از\s*(\d{4})\s*تا\s*(\d{4})/u)
      if (rangeMatch) {
        filters.push({
          dimension: 'by_year',
          op: 'between',
          values: [rangeMatch[1]!, rangeMatch[2]!]
        })
      }
    } else if (years.length === 1 && canFilterByYear) {
      filters.push({ dimension: 'by_year', op: 'eq', values: [years[0]!] })
    }
  } else {
    // S10.8: No year in prompt → infer current Persian year
    // S36.8b: Only auto-infer year for metrics that explicitly support by_year grain
    // (don't auto-infer for list metrics like recent_documents that have a by_year dimension but grainSupported=['total'])
    if (def.grainSupported.includes('by_year')) {
      const currentPersianYear = getCurrentPersianYear()
      filters.push({ dimension: 'by_year', op: 'eq', values: [currentPersianYear] })
    }
  }

  if (
    /به تفکیک\s*سال|سالانه|در هر سال/u.test(normalized) &&
    def.grainSupported.includes('by_year')
  ) {
    grain = 'by_year'
  } else if (
    /به تفکیک\s*ماه|ماهانه|در هر ماه/u.test(normalized) &&
    def.grainSupported.includes('by_month')
  ) {
    grain = 'by_month'
  } else if (
    /به تفکیک\s*فصل|فصلی|در هر فصل/u.test(normalized) &&
    def.grainSupported.includes('by_quarter')
  ) {
    grain = 'by_quarter'
  } else if (
    /به تفکیک\s*حساب|در هر حساب|به تفکیک\s*سرفصل/u.test(normalized) &&
    def.grainSupported.includes('by_account')
  ) {
    grain = 'by_account'
  } else if (
    /به تفکیک\s*مشتری|در هر مشتری|مشتریان/u.test(normalized) &&
    def.grainSupported.includes('by_customer')
  ) {
    grain = 'by_customer'
  } else if (
    /به تفکیک\s*کالا|در هر کالا|به تفکیک\s*اجنس/u.test(normalized) &&
    def.grainSupported.includes('by_item')
  ) {
    grain = 'by_item'
  } else if (
    /به تفکیک\s*انبار|در هر انبار|به تفکیک\s*سوله/u.test(normalized) &&
    def.grainSupported.includes('by_warehouse')
  ) {
    grain = 'by_warehouse'
  } else if (
    /به تفکیک\s*مرکز\s*هزینه|در هر مرکز\s*هزینه/u.test(normalized) &&
    def.grainSupported.includes('by_cost_center')
  ) {
    grain = 'by_cost_center'
  }

  // S14.15: Aging analysis — prompts with "تحلیل سنی" or "سررسید" or "معوق" → by_age_bucket
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_age_bucket') &&
    /تحلیل\s*سنی|سررسید\s*گذشته|معوق|سنی\s*(دریافتنی|پرداختنی)/u.test(normalized)
  ) {
    grain = 'by_age_bucket'
  }

  // S14.19: Detailed turnover — prompts with "با جزئیات", "ردیف به ردیف", "سند به سند" → by_voucher
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_voucher') &&
    /با\s*جزئیات|ردیف\s*به\s*ردیف|سند\s*به\s*سند|گردش\s*تفصیلی/u.test(normalized)
  ) {
    grain = 'by_voucher'
  }

  // S14.21: party_turnover — "گردش/تراکنش مشتری/طرف حساب/شخص" → by_voucher
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_voucher') &&
    /(?:گردش|تراکنش)\s*(?:های\s*)?(?:مشتری|طرف\s*حساب|شخص|تأمین)/u.test(normalized)
  ) {
    grain = 'by_voucher'
  }

  // S14.23: tax_monthly_summary — "مالیات ماهانه" → by_month
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_month') &&
    def.id === 'tax_monthly_summary' &&
    /ماهانه|ماه\s*به\s*ماه|به\s*تفکیک\s*ماه/u.test(normalized)
  ) {
    grain = 'by_month'
  }

  // S14.30: checks_summary — "دریافتی/پرداختی" → by_direction
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_direction') &&
    /دریافتی\s*و\s*پرداختی|دریافتی\s*پرداختی|به\s*تفکیک\s*(?:دریافتی|پرداختی|نوع)/u.test(normalized)
  ) {
    grain = 'by_direction'
  }

  // S14.32: closing_status — "اختتامیه/افتتاحیه" with year → by_year
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_year') &&
    def.id === 'closing_status' &&
    /اختتامیه|افتتاحیه|بستن\s*(?:دوره|سال)/u.test(normalized)
  ) {
    grain = 'by_year'
  }

  // S14.34: period_comparison — "به تفکیک حساب" → by_account
  if (
    grain === 'total' &&
    def.grainSupported.includes('by_account') &&
    def.id === 'period_comparison' &&
    /به\s*تفکیک\s*(?:حساب|سرفصل|معین)/u.test(normalized)
  ) {
    grain = 'by_account'
  }

  if (def.entityNameMatch) {
    // S25.1: Multi-token Persian name extraction — capture 1-4 tokens, stop at keywords
    const NAME_STOP = '(?:\\s+(?:در|سال|برای|به|از|تا|چقدر|چند|است|هست|بود|شد|می|سالانه|ماهانه)(?:\\s|$)|\\s*\\d|\\s*$)'
    const NAME_PATTERN = `((?:[\\u0600-\\u06FF]+\\s*){1,4}?)${NAME_STOP}`
    const personMatch = normalized.match(new RegExp(`(?:آقای|خانم|شرکت)\\s+${NAME_PATTERN}`, 'u'))
    const partyMatch = normalized.match(new RegExp(`(?:طرف\\s*حساب|شخص|مشتری|فروشنده|تأمین‌کننده)\\s+${NAME_PATTERN}`, 'u'))
    const accountTypeMatch = normalized.match(/حساب\s*(دریافتنی|پرداختنی|اسناد)/u)
    const accountMatch = !accountTypeMatch
      ? normalized.match(new RegExp(`(?:حساب|سرفصل|معین|تفضیلی)\\s+${NAME_PATTERN}`, 'u'))
      : null
    if (personMatch) {
      entityName = personMatch[1].trim()
    } else if (partyMatch) {
      entityName = partyMatch[1].trim()
    } else if (accountTypeMatch) {
      entityName = accountTypeMatch[1]
    } else if (accountMatch) {
      entityName = accountMatch[1].trim()
    }
  }

  let topN: number | undefined
  const topNMatch = normalized.match(/(?:آخرین|اخیر|تعداد)\s*(\d+)|(\d+)\s*(?:سند|اسناد|رکورد)/u)
  if (topNMatch) {
    const n = Number(topNMatch[1] ?? topNMatch[2])
    if (Number.isFinite(n) && n > 0) {
      topN = n
    }
  }

  // S11.14: Persian month name date ranges — use integer month numbers
  const monthRangeMatch = normalized.match(/از\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*تا\s*(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/u)
  if (monthRangeMatch && yearMatches && yearMatches.length > 0) {
    const startMonth = PERSIAN_MONTHS[monthRangeMatch[1]!]
    const endMonth = PERSIAN_MONTHS[monthRangeMatch[2]!]
    if (startMonth && endMonth) {
      filters.push({
        dimension: 'by_month',
        op: 'between',
        values: [String(Number(startMonth)), String(Number(endMonth))]
      })
    }
  }

  // S11.14: "نیمه اول" and "سه ماه اول" — use integer month numbers
  if (/نیمه\s*اول/u.test(normalized) && yearMatches && yearMatches.length > 0) {
    filters.push({
      dimension: 'by_month',
      op: 'between',
      values: ['1', '6']
    })
  }
  if (/سه\s*ماه\s*اول/u.test(normalized) && yearMatches && yearMatches.length > 0) {
    filters.push({
      dimension: 'by_month',
      op: 'between',
      values: ['1', '3']
    })
  }

  // S11.14: Persian season names
  if (/بهار/u.test(normalized) && yearMatches && yearMatches.length > 0) {
    filters.push({ dimension: 'by_month', op: 'between', values: ['1', '3'] })
  }
  if (/تابستان/u.test(normalized) && yearMatches && yearMatches.length > 0) {
    filters.push({ dimension: 'by_month', op: 'between', values: ['4', '6'] })
  }
  if (/پاییز|پاييز/u.test(normalized) && yearMatches && yearMatches.length > 0) {
    filters.push({ dimension: 'by_month', op: 'between', values: ['7', '9'] })
  }
  if (/زمستان/u.test(normalized) && yearMatches && yearMatches.length > 0) {
    filters.push({ dimension: 'by_month', op: 'between', values: ['10', '12'] })
  }

  if (!topN && def.measure.kind === 'list') {
    topN = metricId === 'recent_documents' ? 20 : 100
  }

  // S11.13: "روند" implies trend → set grain to by_month if supported
  if (/روند/u.test(normalized) && def.grainSupported.includes('by_month') && !comparison) {
    grain = 'by_month'
  }

  // S19.6: trend_analysis — "روند" with "چند سال" or "سالانه" or "اخیر" → by_year
  if (
    grain === 'total' &&
    def.id === 'trend_analysis' &&
    def.grainSupported.includes('by_year') &&
    /روند|چند\s*سال|سالانه|اخیر/u.test(normalized)
  ) {
    grain = 'by_year'
  }

  if (comparison) {
    grain = 'total'
  }

  // S14.2: Parse date range from Persian prompts
  // Patterns: "از 1403/05/01 تا 1403/05/31", "از فروردین تا مرداد 1403",
  //           "نیمه دوم سال 1403", "ماه 5 سال 1403", "از 1 خرداد تا 15 تیر"
  const dateRange = parseDateRange(normalized, yearMatches)

  // S14.6: Extract voucher number from prompt (e.g., "سند شماره 1234", "سند 1234")
  let voucherNumber: string | undefined
  const voucherNumMatch = normalized.match(/سند\s*(?:شماره|ش)?\s*(\d{1,10})/u)
  if (voucherNumMatch && metricId === 'voucher_detail') {
    voucherNumber = voucherNumMatch[1]
  }

  // S14.8: Extract voucher type from prompt
  let voucherType: string | undefined
  if (metricId === 'vouchers_by_type') {
    if (/اختتامیه/u.test(normalized)) {
      voucherType = '4'
    } else if (/افتتاحیه/u.test(normalized)) {
      voucherType = '5'
    } else if (/بستن\s*حساب/u.test(normalized)) {
      voucherType = '3'
    } else if (/عملیاتی/u.test(normalized)) {
      voucherType = '1'
    }
  }

  const plan: MetricPlan = {
    metricId,
    grain,
    filters,
    comparison,
    entityName,
    topN,
    dateRange,
    voucherNumber,
    voucherType,
    confidence: 1.0
  }
  setCachedPlan(cacheKey, plan)
  return plan
}

export function buildDeterministicMultiPlan(prompt: string): MultiMetricPlan | null {
  const route = routeMultiMetric(prompt)
  if (route.metricIds.length === 0) return null

  const plans: MetricPlan[] = []
  for (const metricId of route.metricIds) {
    const plan = buildDeterministicPlan(prompt, metricId)
    if (plan) {
      plans.push(plan)
    }
  }

  if (plans.length < 2 && route.joinMode !== 'trend') return null
  if (plans.length < 1) return null

  return {
    plans,
    joinMode: route.joinMode,
    confidence: route.confidence
  }
}

// ─── P4.1 — Planner prompt builder ─────────────────────────────────────────

export interface PlannerPromptContext {
  userPrompt: string
  softwareId?: string
}

// S15.18: Build schema context from adapter when available
function buildSchemaContext(softwareId?: string): string {
  if (!softwareId || softwareId === 'sepidar') {
    return ''
  }
  return `\n\nنکته: این سیستم به نرم‌افزار «${softwareId}» متصل است. متریک‌های موجود فقط آن‌هایی هستند که با این نرم‌افزار سازگارند.`
}

// S20.6 — Conversation context for planner prompt injection
export interface PlannerConversationContext {
  history: Array<{
    userMessage: string
    resultSummary: string
  }>
  contextEntities: {
    years: number[]
    accounts: string[]
    parties: string[]
  }
}

// S20.6 — Build conversation context string for planner prompt
function buildConversationContext(ctx?: PlannerConversationContext): string {
  if (!ctx) return ''
  const parts: string[] = []

  if (ctx.history.length > 0) {
    parts.push('\n\nتاریخچه مکالمه (آخرین سؤال‌ها):')
    for (const turn of ctx.history) {
      parts.push(`- کاربر: ${turn.userMessage} → نتیجه: ${turn.resultSummary}`)
    }
  }

  const { years, accounts, parties } = ctx.contextEntities
  if (years.length > 0 || accounts.length > 0 || parties.length > 0) {
    parts.push('\nموجودیت‌های ذکرشده در مکالمه:')
    if (years.length > 0) parts.push(`- سال‌ها: ${years.join(', ')}`)
    if (accounts.length > 0) parts.push(`- حساب‌ها: ${accounts.join(', ')}`)
    if (parties.length > 0) parts.push(`- طرف‌حساب‌ها: ${parties.join(', ')}`)
  }

  return parts.length > 0 ? '\n' + parts.join('\n') : ''
}

// S20.11 — Domain Knowledge injection in planner prompt
const DOMAIN_KNOWLEDGE = `دانش حسابداری (برای انتخاب درست metricId):

صورت‌های مالی:
- ترازنامه (Balance Sheet): لیست دارایی‌ها، بدهی‌ها و حقوق صاحبان سهام → metricId: trial_balance
- صورت سود و زیان (Income Statement): درآمد‌ها و هزینه‌ها → metricId: total_revenue, total_expenses, net_margin
- صورت جریان وجوه نقد (Cash Flow Statement): جریان نقدی عملیاتی/سرمایه‌گذاری/تأمین مالی → metricId: cash_flow_statement

نسبت‌های مالی:
- نسبت جاری (Current Ratio) = دارایی‌های جاری / بدهی‌های جاری → metricId: current_ratio
- بازده دارایی‌ها (ROA) = سود خالص / کل دارایی‌ها → metricId: roa
- بازده حقوق صاحبان سهام (ROE) = سود خالص / حقوق صاحبان سهام → metricId: roe
- حاشیه سود عملیاتی (Operating Margin) = سود عملیاتی / درآمد → metricId: operating_margin
- حاشیه سود ناخالص (Gross Margin) = (درآمد - بهای تمام شده) / درآمد → metricId: gross_margin
- نسبت پوشش بهره (Interest Coverage) = سود عملیاتی / هزینه بهره → metricId: interest_coverage
- گردش دارایی‌ها (Asset Turnover) = درآمد / کل دارایی‌ها → metricId: asset_turnover
- گردش موجودی (Inventory Turnover) = بهای تمام شده / میانگین موجودی → metricId: inventory_turnover

ترجمه اصطلاحات:
- حاشیه سود = margin (gross_margin یا operating_margin)
- گردش = turnover (asset_turnover, inventory_turnover, receivables_turnover)
- سود خالص = net income (net_margin)
- سود عملیاتی = operating income (operating_margin)
- سود ناخالص = gross profit (gross_margin)
- مانده = balance (account_balance)
- دریافتنی = receivable (account_balance با entityName)
- پرداختنی = payable (account_balance با entityName)
- فروش = sales (net_sales)
- خرید = purchases (purchases)

قوانین مالیاتی ایران:
- VAT (مالیات بر ارزش افزوده) = ۹٪
- معافیت‌های مالیاتی: صادرات، کالاهای اساسی
- metricId برای VAT: vat_detailed, tax_liability_summary

قواعد تفکیک اصطلاحات مشابه (S39.8b):
- «گردش حساب» یا «گردش» → account_turnover (نه trial_balance یا net_sales)
- «مانده حساب» یا «مانده» → account_balance (نه account_turnover)
- «ترازنامه» → balance_sheet (نه trial_balance)
- «تراز آزمایشی» → trial_balance (نه balance_sheet)
- «جریان نقد» یا «جریان وجوه نقد» → cash_flow_statement (نه cashflow)
- اگر کاربر اسم شخص/بانک/شرکت آورد → از entityName استفاده کن`

export function buildPlannerPrompt(
  userPrompt: string,
  softwareId?: string,
  conversationContext?: PlannerConversationContext,
  retryHint?: RetryHint
): string {
  const catalog = getMetricCatalog()
  // S15.18: Filter metrics by softwareId when adapter is active
  const filteredCatalog = softwareId && softwareId !== 'sepidar'
    ? catalog.filter(m => m.softwareId === softwareId || m.softwareId === 'generic')
    : catalog
  const metricList = filteredCatalog
    .map(
      (m) =>
        `- id: ${m.id}, titleFa: ${m.titleFa}, grainSupported: [${m.grainSupported.join(', ')}]`
    )
    .join('\n')

  return `تو یک برنامه‌ریزِ مالی هستی. کاربر یک سؤال مالی به فارسی می‌پرسد و تو باید یک JSON دقیق مطابق شِمای MetricPlan یا MultiMetricPlan تولید کنی.

قواعد:
۱. فقط JSON تولید کن — هیچ متن اضافی، هیچ SQL، هیچ عدد حدسی.
۲. اگر سؤال به هیچ متریکی نمی‌خورد یا مبهم است، confidence را پایین (زیر ۰.۵) بده و metricId را همان نزدیک‌ترین بگذار.
۳. سال‌ها را در filters با dimension="by_year" و op="eq" قرار بده. مقادیر سال همیشه ۴ رقمی.
۴. اگر مقایسهٔ دو سال خواسته شد، از comparison استفاده کن.
۵. grain یکی از: total, by_year, by_month, by_quarter, by_customer, by_account.
۶. entityName فقط اگر نام حساب/سرفصل/طرف‌حساب صراحتاً ذکر شده.
۷. اگر سؤال دو یا چند متریک می‌خواهد، MultiMetricPlan تولید کن با plans: [...] و joinMode.
۸. joinMode یکی از: side_by_side, comparison, trend.
۹. اگر سالی ذکر نشد و متریک by_year پشتیبانی می‌کند، سال جاری شمسی را در filter قرار بده.
۱۰. topN فقط برای متریک‌های list (مثل recent_documents).
۱۱. اگر سؤال چندمرحله‌ای است (خروجی یک متریک ورودی متریک بعدی است)، MultiStepPlan تولید کن با steps: [...] و combineStrategy.
۱۲. combineStrategy یکی از: compare (مقایسه نتایج), cascade (خروجی مرحله قبل ورودی مرحله بعد), explain (مرحله اول عدد, مرحله دوم توضیح).
۱۳. اگر کاربر نمودار یا گزارش خواست (نمودار, چارت, diagram, excel, اکسل, PDF, گزارش), فیلد pythonOutput را به MetricPlan اضافه کن با enabled=true و outputType/chartType مناسب.

متریک‌های موجود:
${metricList}

شِمای خروجی (MetricPlan — تک‌متریکی):
{
  "metricId": "net_sales | purchases | account_balance | trial_balance | cash_bank_balance",
  "grain": "total | by_year | by_month | by_quarter | by_customer | by_account",
  "filters": [{ "dimension": "by_year", "op": "eq", "values": ["1402"] }],
  "comparison": { "dimension": "by_year", "baseValue": "1402", "targetValue": "1403" },
  "entityName": "اختیاری",
  "topN": 10,
  "confidence": 0.0 تا 1.0
}

شِمای خروجی (MultiMetricPlan — چندمتریکی):
{
  "plans": [
    { "metricId": "net_sales", "grain": "total", "filters": [...], "confidence": 0.9 },
    { "metricId": "purchases", "grain": "total", "filters": [...], "confidence": 0.9 }
  ],
  "joinMode": "side_by_side | comparison | trend",
  "confidence": 0.9
}

شِمای خروجی (MultiStepPlan — چندمرحله‌ای):
{
  "steps": [
    { "metricId": "net_sales", "grain": "total", "filters": [...], "confidence": 0.9 },
    { "metricId": "net_sales", "grain": "total", "filters": [...], "confidence": 0.9 }
  ],
  "combineStrategy": "compare | cascade | explain",
  "confidence": 0.9
}

مثال ۱:
سؤال: فروش خالص سال ۱۴۰۲ چقدر است؟
پاسخ: {"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.95}

مثال ۲:
سؤال: مقایسه فروش خالص ۱۴۰۲ و ۱۴۰۳
پاسخ: {"metricId":"net_sales","grain":"total","filters":[],"comparison":{"dimension":"by_year","baseValue":"1402","targetValue":"1403"},"confidence":0.9}

مثال ۳:
سؤال: مانده حساب دریافتنی در سال ۱۴۰۲
پاسخ: {"metricId":"account_balance","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"entityName":"دریافتنی","confidence":0.85}

مثال ۴:
سؤال: تعداد کارمندان چقدر است؟
پاسخ: {"metricId":"net_sales","grain":"total","filters":[],"confidence":0.1}

مثال ۵:
سؤال: چقدر فروختیم؟
پاسخ: {"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1403"]}],"confidence":0.8}

مثال ۶:
سؤال: فروش و خرید ۱۴۰۲
پاسخ: {"plans":[{"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9},{"metricId":"purchases","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}],"joinMode":"side_by_side","confidence":0.9}

مثال ۷:
سؤال: روند ماهانهٔ فروش ۱۴۰۲
پاسخ: {"metricId":"net_sales","grain":"by_month","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

مثال ۸:
سؤال: نسبت فروش به خرید ۱۴۰۲
پاسخ: {"metricId":"sales_to_purchase_ratio","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

مثال ۹:
سؤال: ۱۰ سند اخیر
پاسخ: {"metricId":"recent_documents","grain":"total","filters":[],"topN":10,"confidence":0.85}

مثال ۹‌ب:
سؤال: چه سال‌های مالی در سیستم ثبت شده؟
پاسخ: {"metricId":"fiscal_year_list","grain":"total","filters":[],"confidence":0.85}

مثال ۹‌ج:
سؤال: کدام سندها تراز نیستند؟
پاسخ: {"metricId":"unbalanced_vouchers","grain":"total","filters":[],"confidence":0.85}

مثال ۹‌د:
سؤال: سندهای ترازنشده ۱۴۰۲
پاسخ: {"metricId":"unbalanced_vouchers","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.85}

مثال ۱۰:
سؤال: مانده طرف حساب آقای مرادی
پاسخ: {"metricId":"party_balance","grain":"total","filters":[],"entityName":"مرادی","confidence":0.8}

مثال ۱۰‌ب:
سؤال: مانده طرف حساب آقای معین محسنی فرد ۱۴۰۲
پاسخ: {"metricId":"party_balance","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"entityName":"معین محسنی فرد","confidence":0.8}

مثال ۱۱:
سؤال: مقایسه فروش و خرید ۱۴۰۲
پاسخ: {"plans":[{"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9},{"metricId":"purchases","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}],"joinMode":"comparison","confidence":0.85}

مثال ۱۲:
سؤال: آب‌وهوای تهران
پاسخ: {"metricId":"net_sales","grain":"total","filters":[],"confidence":0.05}

مثال ۱۳:
سؤال: فروش امسال چقدره و نسبت به پارسال چند درصد تغییر کرده؟
پاسخ: {"steps":[{"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1403"]}],"confidence":0.9},{"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}],"combineStrategy":"compare","confidence":0.85}

مثال ۱۴:
سؤال: ترازنامه بگو و بعد حاشیه سود رو هم محاسبه کن
پاسخ: {"steps":[{"metricId":"trial_balance","grain":"total","filters":[],"confidence":0.85},{"metricId":"net_sales","grain":"total","filters":[],"confidence":0.8}],"combineStrategy":"explain","confidence":0.8}

مثال ۱۵:
سؤال: پرفروش‌ترین مشتری رو پیدا کن و بعد گردش حسابش رو نشون بده
پاسخ: {"steps":[{"metricId":"net_sales","grain":"by_customer","filters":[],"topN":1,"confidence":0.85},{"metricId":"party_turnover","grain":"total","filters":[],"confidence":0.8}],"combineStrategy":"cascade","confidence":0.8}

English examples (S21.9):

Example 16:
Question: What were total sales in 1402?
Answer: {"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.95}

Example 17:
Question: Show me the balance sheet
Answer: {"metricId":"trial_balance","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1403"]}],"confidence":0.85}

Example 18:
Question: Compare expenses 1402 vs 1403
Answer: {"metricId":"total_expenses","grain":"total","filters":[],"comparison":{"dimension":"by_year","baseValue":"1402","targetValue":"1403"},"confidence":0.9}

Example 19:
Question: What is the current ratio for 1402?
Answer: {"metricId":"current_ratio","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.85}

Example 20:
Question: How much did we sell this year?
Answer: {"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1403"]}],"confidence":0.8}

Example 21:
Question: Cash and bank balance
Answer: {"metricId":"cash_bank_balance","grain":"total","filters":[],"confidence":0.85}

Mixed language examples (S21.10):

Example 22:
Question: فروش 1402 رو با 1403 compare کن
Answer: {"metricId":"net_sales","grain":"total","filters":[],"comparison":{"dimension":"by_year","baseValue":"1402","targetValue":"1403"},"confidence":0.9}

Example 23:
Question: total expenses سال 1402 چقدره؟
Answer: {"metricId":"total_expenses","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

Python output examples (S18.8):

Example 24:
Question: نمودار روند فروش ۵ سال
Answer: {"metricId":"net_sales","grain":"by_year","filters":[],"pythonOutput":{"enabled":true,"outputType":"chart","chartType":"line","title":"روند فروش ۵ سال","xAxis":"year","yAxis":"value"},"confidence":0.9}

Example 25:
Question: گزارش اکسل فروش ۱۴۰۲
Answer: {"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"pythonOutput":{"enabled":true,"outputType":"excel","title":"گزارش فروش ۱۴۰۲"},"confidence":0.9}

Example 26:
Question: نمودار میله‌ای مقایسه خرید و فروش
Answer: {"metricId":"net_sales","grain":"total","filters":[],"pythonOutput":{"enabled":true,"outputType":"chart","chartType":"bar","title":"مقایسه خرید و فروش","xAxis":"category","yAxis":"value"},"confidence":0.85}

Example 27:
Question: گزارش PDF ترازنامه
Answer: {"metricId":"trial_balance","grain":"total","filters":[],"pythonOutput":{"enabled":true,"outputType":"pdf","title":"ترازنامه"},"confidence":0.85}

Example 28:
Question: نمودار دایره‌ای ترکیب هزینه‌ها
Answer: {"metricId":"total_expenses","grain":"by_account","filters":[],"pythonOutput":{"enabled":true,"outputType":"chart","chartType":"pie","title":"ترکیب هزینه‌ها","xAxis":"account","yAxis":"value"},"confidence":0.85}

Example 29 (S38.7):
Question: سندهای تکراری ۱۴۰۲
Answer: {"metricId":"duplicate_vouchers","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

Example 30 (S38.8):
Question: سندهای بدون حساب ۱۴۰۲
Answer: {"metricId":"vouchers_without_account","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

Example 31 (S38.6):
Question: آیا اختتامیه ۱۴۰۲ ثبت شده؟
Answer: {"metricId":"closing_status","grain":"by_year","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

Example 32 (S38.4):
Question: جریان نقد ۱۴۰۲
Answer: {"metricId":"cash_flow_statement","grain":"by_year","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

Example 33 (S39.8b disambiguation):
Question: گردش حساب صندوق ۱۴۰۲
Answer: {"metricId":"account_turnover","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"entityName":"صندوق","confidence":0.85}

Example 34 (S39.8b disambiguation):
Question: مانده حساب بانک ملت
Answer: {"metricId":"account_balance","grain":"total","filters":[],"entityName":"بانک ملت","confidence":0.85}

Example 35 (S39.8b disambiguation):
Question: ترازنامه ۱۴۰۲
Answer: {"metricId":"balance_sheet","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

Example 36 (S39.8b disambiguation):
Question: تراز آزمایشی ۱۴۰۲
Answer: {"metricId":"trial_balance","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}

${DOMAIN_KNOWLEDGE}
${retryHint ? (retryHint.failedMetricId
  ? `\n⚠ توجه: metric «${retryHint.failedMetricId}» قبلاً امتحان شد اما نتیجه قابل‌قبول نبود (دلیل: ${retryHint.reason}).${retryHint.errorType === 'empty-data'
    ? ' این metric داده‌ای برنگرداند. یا grain را عوض کن (مثلاً total به جای by_year) یا فیلترها را تسکین کن یا metric کاملاً متفاوتی پیشنهاد بده.'
    : retryHint.errorType === 'intent-mismatch'
    ? ` این metric با intent کاربر همخوانی نداشت.${retryHint.suggestedMetricId ? ` metric پیشنهادی: «${retryHint.suggestedMetricId}». لطفاً این metric را امتحان کن.` : ' لطفاً metric کاملاً متفاوتی که دقیقاً با درخواست کاربر باشد پیشنهاد بده.'}`
    : retryHint.errorType === 'execution-error'
    ? ' اجرای این metric با خطای فنی مواجه شد. لطفاً metric ساده‌تری با JOIN کمتر پیشنهاد بده.'
    : retryHint.errorType === 'parse-error'
    ? ' در پاسخ قبلی JSON معتبر تولید نشد. لطفاً فقط یک JSON معتبر بدون متن اضافه تولید کن.'
    : retryHint.errorType === 'insufficient-evidence'
    ? ' شواهد کافی برای این metric وجود نداشت. لطفاً metric دیگری با پوشش داده‌ای بهتر پیشنهاد بده.'
    : retryHint.errorType === 'semantic-check-failed'
    ? ' نتیجه این metric از نظر معنایی نامعتبر بود. لطفاً metric دیگری پیشنهاد بده.'
    : ' لطفاً metric دیگری پیشنهاد بده.'
  }\n`
  : `\n⚠ توجه: در پاسخ قبلی JSON معتبر تولید نشد (دلیل: ${retryHint.reason}). لطفاً فقط یک JSON معتبر بدون متن اضافه تولید کن. نام‌های چندبخشی را در entityName با فاصله قرار بده.\n`
) : ''}
سؤال کاربر: ${userPrompt}${buildSchemaContext(softwareId)}${buildConversationContext(conversationContext)}
پاسخ JSON:`
}

// ─── P4.2 — Planner output parser ──────────────────────────────────────────
// MULTI_METRIC_PLANNER: parsePlannerOutput supports MultiMetricPlan

export interface ParsePlannerResult {
  plan: MetricPlan | null
  multiPlan?: MultiMetricPlan
  stepPlan?: MultiStepPlan
  error?: string
}

export function parsePlannerOutput(raw: string): ParsePlannerResult {
  let jsonText: string | null = null

  // Try direct JSON parse first
  try {
    JSON.parse(raw)
    jsonText = raw
  } catch {
    // Try extracting from code fence
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      try {
        JSON.parse(fenceMatch[1].trim())
        jsonText = fenceMatch[1].trim()
      } catch {
        // continue
      }
    }

    // Try finding first { ... } block
    if (!jsonText) {
      const braceMatch = raw.match(/\{[\s\S]*\}/)
      if (braceMatch) {
        try {
          JSON.parse(braceMatch[0])
          jsonText = braceMatch[0]
        } catch {
          // continue
        }
      }
    }

    // S38.9: Try cleaning common model output issues before giving up
    if (!jsonText) {
      const cleaned = raw
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')
      const braceMatch = cleaned.match(/\{[\s\S]*\}/)
      if (braceMatch) {
        try {
          JSON.parse(braceMatch[0])
          jsonText = braceMatch[0]
        } catch {
          // continue
        }
      }
    }
  }

  if (!jsonText) {
    return { plan: null, error: 'no-valid-json' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { plan: null, error: 'json-parse-failed' }
  }

  // Try MultiStepPlan first (has "steps" array with combineStrategy)
  const stepZodResult = multiStepPlanSchema.safeParse(parsed)
  if (stepZodResult.success) {
    const stepPlan = stepZodResult.data as MultiStepPlan
    for (const step of stepPlan.steps) {
      const def = findMetricById(step.metricId)
      if (!def) {
        return { plan: null, error: `step-plan-metric-not-in-catalog: ${step.metricId}` }
      }
      if (!def.grainSupported.includes(step.grain)) {
        return { plan: null, error: `grain-${step.grain}-not-supported-for-${step.metricId}` }
      }
    }
    return { plan: null, stepPlan }
  }

  // Try MultiMetricPlan (has "plans" array with joinMode)
  const multiZodResult = multiMetricPlanSchema.safeParse(parsed)
  if (multiZodResult.success) {
    const multiPlan = multiZodResult.data as MultiMetricPlan
    for (const subPlan of multiPlan.plans) {
      const def = findMetricById(subPlan.metricId)
      if (!def) {
        return { plan: null, error: `multi-plan-metric-not-in-catalog: ${subPlan.metricId}` }
      }
      if (!def.grainSupported.includes(subPlan.grain)) {
        return { plan: null, error: `grain-${subPlan.grain}-not-supported-for-${subPlan.metricId}` }
      }
    }
    return { plan: null, multiPlan }
  }

  // Fall back to single MetricPlan
  const zodResult = metricPlanSchema.safeParse(parsed)
  if (!zodResult.success) {
    return {
      plan: null,
      error: `schema-validation-failed: ${zodResult.error.issues[0]?.message ?? 'unknown'}`
    }
  }

  const plan = zodResult.data as MetricPlan

  // Semantic checks
  const def = findMetricById(plan.metricId)
  if (!def) {
    return { plan: null, error: 'metric-not-in-catalog' }
  }

  if (!def.grainSupported.includes(plan.grain)) {
    return { plan: null, error: `grain-${plan.grain}-not-supported-for-${plan.metricId}` }
  }

  // Validate year values are 4-digit
  for (const filter of plan.filters) {
    if (filter.dimension === 'by_year') {
      for (const v of filter.values) {
        if (!/^\d{4}$/.test(v)) {
          return { plan: null, error: `invalid-year-value: ${v}` }
        }
      }
    }
  }

  if (plan.comparison) {
    if (
      !/^\d{4}$/.test(plan.comparison.baseValue) ||
      !/^\d{4}$/.test(plan.comparison.targetValue)
    ) {
      return { plan: null, error: 'invalid-comparison-year-values' }
    }
  }

  return { plan }
}

// ─── P4.3 — Planner model deps + decision policy ───────────────────────────

export interface PlannerModelDeps {
  callModel: (prompt: string) => Promise<string>
}

export type RetryErrorType =
  | 'empty-data'
  | 'intent-mismatch'
  | 'execution-error'
  | 'parse-error'
  | 'insufficient-evidence'
  | 'semantic-check-failed'

export interface RetryHint {
  failedMetricId: string
  reason: string
  errorType?: RetryErrorType
  suggestedMetricId?: string
}

// S10.4: buildModelPlan now returns ParsePlannerResult which may include multiPlan
export async function buildModelPlan(
  userPrompt: string,
  deps: PlannerModelDeps,
  softwareId?: string,
  conversationContext?: PlannerConversationContext,
  retryHint?: RetryHint
): Promise<ParsePlannerResult> {
  const plannerPrompt = buildPlannerPrompt(userPrompt, softwareId, conversationContext, retryHint)
  try {
    const raw = await deps.callModel(plannerPrompt)
    return parsePlannerOutput(raw)
  } catch {
    return { plan: null, error: 'model-call-failed' }
  }
}

export const PLANNER_CONFIDENCE_THRESHOLD = 0.5

// ─── S10.5 — ClarifyResult type ─────────────────────────────────────────────
// SMART_CLARIFY: buildClarify generates question + suggestions

export interface ClarifyResult {
  question: string
  suggestions: string[]
}

// ─── S10.6 — buildClarify ────────────────────────────────────────────────────

// S20.12 — Ambiguous term → multiple metricId mapping for advanced clarify
const AMBIGUOUS_TERMS: Array<{
  signal: string[]
  question: string
  options: Array<{ label: string; metricId: MetricId }>
}> = [
  {
    signal: ['سود', 'پروفیت', 'profit'],
    question: 'کدام نوع سود؟',
    options: [
      { label: 'سود خالص (حاشیه سود خالص)', metricId: 'net_margin' as MetricId },
      { label: 'سود عملیاتی (حاشیه سود عملیاتی)', metricId: 'operating_margin' as MetricId },
      { label: 'سود ناخالص (حاشیه سود ناخالص)', metricId: 'gross_margin' as MetricId }
    ]
  },
  {
    signal: ['حاشیه', 'margin'],
    question: 'کدام حاشیه سود؟',
    options: [
      { label: 'حاشیه سود خالص', metricId: 'net_margin' as MetricId },
      { label: 'حاشیه سود عملیاتی', metricId: 'operating_margin' as MetricId },
      { label: 'حاشیه سود ناخالص', metricId: 'gross_margin' as MetricId }
    ]
  },
  {
    signal: ['گردش', 'turnover'],
    question: 'کدام نوع گردش؟',
    options: [
      { label: 'گردش دارایی‌ها', metricId: 'asset_turnover' as MetricId },
      { label: 'گردش موجودی', metricId: 'inventory_turnover' as MetricId },
      { label: 'گردش دریافتنی‌ها', metricId: 'receivables_turnover' as MetricId }
    ]
  },
  {
    signal: ['نسبت', 'ratio'],
    question: 'کدام نسبت مالی؟',
    options: [
      { label: 'نسبت جاری', metricId: 'current_ratio' as MetricId },
      { label: 'بازده دارایی‌ها (ROA)', metricId: 'roa' as MetricId },
      { label: 'بازده حقوق سهامداران (ROE)', metricId: 'roe' as MetricId }
    ]
  }
]

function detectAmbiguousTerm(prompt: string): Array<{ label: string; metricId: MetricId }> | null {
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  for (const entry of AMBIGUOUS_TERMS) {
    const matched = entry.signal.some((sig) => normalized.includes(normalizePersianText(sig)))
    if (matched) {
      // Check that the prompt doesn't already specify which type (e.g., "سود خالص")
      // Use the second word of each label as the specifier (first word is the ambiguous term itself)
      const specifierWords = entry.options.map((opt) => {
        const words = opt.label.split(' ')
        return words.length > 1 ? normalizePersianText(words[1]!) : ''
      }).filter(w => w.length > 0)
      const hasSpecifier = specifierWords.some((w) => normalized.includes(w))
      if (!hasSpecifier) {
        return entry.options
      }
    }
  }
  return null
}

export function buildClarify(prompt: string, metricId: MetricId): ClarifyResult {
  // S20.12: Check for ambiguous terms first using domain knowledge
  const ambiguousOptions = detectAmbiguousTerm(prompt)
  if (ambiguousOptions && ambiguousOptions.length >= 3) {
    return {
      question: 'سؤال شما مبهم است. لطفاً مشخص‌تر بپرسید:',
      suggestions: ambiguousOptions.slice(0, 3).map((opt) => opt.label)
    }
  }

  const def = findMetricById(metricId)
  const catalog = getMetricCatalog()

  const candidates = catalog
    .map((m) => {
      let score = 0
      const normalized = normalizePersianText(normalizePersianDigits(prompt))
      for (const anchor of m.anchors) {
        if (normalized.includes(normalizePersianText(anchor))) {
          score += 2
        }
      }
      if (m.excludeSignals) {
        for (const sig of m.excludeSignals) {
          if (normalized.includes(normalizePersianText(sig))) {
            score = 0
            break
          }
        }
      }
      return { id: m.id, titleFa: m.titleFa, score }
    })
    .filter((m) => m.score > 0 && m.id !== metricId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const question = def
    ? `آیا منظورتان ${def.titleFa} بود؟`
    : 'سؤال شما مبهم است. لطفاً مشخص‌تر بپرسید.'

  const suggestions = candidates.map((c) => c.titleFa)

  return { question, suggestions }
}

// ─── S14.40: Conversational drill-down ──────────────────────────────────────

const DRILL_DOWN_SIGNALS = [
  'نمایش بده',
  'نمایش بده فاکتورها',
  'جزئیات',
  'لیست',
  'فاکتورها',
  'سندها',
  'به تفکیک',
  'تفکیک',
  'ردیف ها',
  'ردیف‌ها',
  'اقلام'
]

export function isDrillDownPrompt(prompt: string): boolean {
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  return DRILL_DOWN_SIGNALS.some((sig) => normalized.includes(normalizePersianText(sig)))
}

function normRegex(pattern: string): RegExp {
  return new RegExp(normalizePersianText(pattern), 'u')
}

export function buildFollowUpPlan(
  prompt: string,
  lastPlan: MetricPlan
): MetricPlan | null {
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  const def = findMetricById(lastPlan.metricId)
  if (!def) return null

  let grain: Grain = lastPlan.grain
  const filters: PlanFilter[] = [...lastPlan.filters]
  let entityName = lastPlan.entityName
  let topN = lastPlan.topN

  // "نمایش بده فاکتورها" / "لیست فاکتورها" / "جزئیات" → switch to list/voucher detail
  if (normRegex('نمایش\\s*بده|لیست|جزئیات|اقلام|ردیف').test(normalized)) {
    if (def.measure.kind === 'list') {
      grain = 'total'
    } else if (def.grainSupported.includes('by_voucher')) {
      grain = 'by_voucher'
    }
  }

  // "به تفکیک مشتری" → by_customer if supported
  if (normRegex('به\\s*تفکیک\\s*مشتری|تفکیک\\s*مشتری').test(normalized) && def.grainSupported.includes('by_customer')) {
    grain = 'by_customer'
  }

  // "به تفکیک ماه" → by_month if supported
  if (normRegex('به\\s*تفکیک\\s*ماه|تفکیک\\s*ماه|ماهانه').test(normalized) && def.grainSupported.includes('by_month')) {
    grain = 'by_month'
  }

  // "به تفکیک سال" → by_year if supported
  if (normRegex('به\\s*تفکیک\\s*سال|تفکیک\\s*سال|سالانه').test(normalized) && def.grainSupported.includes('by_year')) {
    grain = 'by_year'
  }

  // "به تفکیک حساب" → by_account if supported
  if (normRegex('به\\s*تفکیک\\s*(?:حساب|سرفصل|معین)').test(normalized) && def.grainSupported.includes('by_account')) {
    grain = 'by_account'
  }

  // Extract new entity name if mentioned in follow-up
  if (def.entityNameMatch) {
    // S25.2: Multi-token name extraction in follow-up context
    const NAME_STOP = '(?:\\s+(?:در|سال|برای|به|از|تا|چقدر|چند|است|هست|بود|شد|می|سالانه|ماهانه)(?:\\s|$)|\\s*\\d|\\s*$)'
    const NAME_PATTERN = `((?:[\\u0600-\\u06FF]+\\s*){1,4}?)${NAME_STOP}`
    const personMatch = normalized.match(new RegExp(`(?:آقای|خانم|شرکت)\\s+${NAME_PATTERN}`, 'u'))
    const partyMatch = normalized.match(new RegExp(`(?:طرف\\s*حساب|شخص|مشتری|فروشنده|تأمین‌کننده)\\s+${NAME_PATTERN}`, 'u'))
    const accountMatch = normalized.match(new RegExp(`(?:حساب|سرفصل|معین|تفضیلی)\\s+${NAME_PATTERN}`, 'u'))
    if (personMatch) {
      entityName = personMatch[1].trim()
    } else if (partyMatch) {
      entityName = partyMatch[1].trim()
    } else if (accountMatch) {
      entityName = accountMatch[1].trim()
    }
  }

  // Extract topN if mentioned (e.g., "۱۰ تا اول", "۲۰ ردیف")
  const topNMatch = normalized.match(normRegex('(\\d{1,3})\\s*(?:تا|ردیف|سند|فاکتور)'))
  if (topNMatch) {
    topN = Number(topNMatch[1])
  }

  // Inherit dateRange from last plan
  const dateRange = lastPlan.dateRange

  const plan: MetricPlan = {
    metricId: lastPlan.metricId,
    grain,
    filters,
    entityName,
    topN,
    dateRange,
    confidence: 0.9
  }

  return plan
}

import type { MetricPlan, MetricId, Grain, PlanFilter, MultiMetricPlan } from './types'
import { metricPlanSchema, multiMetricPlanSchema } from './types'
import { findMetricById, getMetricCatalog } from './metricCatalog'
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
    } else if (years.length >= 2 && def.grainSupported.includes('by_year') && rangePattern) {
      const rangeMatch = normalized.match(/از\s*(\d{4})\s*تا\s*(\d{4})/u)
      if (rangeMatch) {
        filters.push({
          dimension: 'by_year',
          op: 'between',
          values: [rangeMatch[1]!, rangeMatch[2]!]
        })
      }
    } else if (years.length === 1 && def.grainSupported.includes('by_year')) {
      filters.push({ dimension: 'by_year', op: 'eq', values: [years[0]!] })
    }
  } else {
    // S10.8: No year in prompt → infer current Persian year
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

  if (def.entityNameMatch) {
    // S10.9: Expanded entity patterns for conversational prompts
    const personMatch = normalized.match(/(?:آقای|خانم|شرکت)\s+([\u0600-\u06FF]+)/u)
    const partyMatch = normalized.match(/(?:طرف\s*حساب|شخص|مشتری|فروشنده|تأمین‌کننده)\s+([\u0600-\u06FF]+)/u)
    const accountMatch = normalized.match(/(?:حساب|سرفصل|معین|تفضیلی)\s+([\u0600-\u06FF]+)/u)
    const accountTypeMatch = normalized.match(/(حساب\s*(?:دریافتنی|پرداختنی|اسناد))/u)
    if (personMatch) {
      entityName = personMatch[1]
    } else if (partyMatch) {
      entityName = partyMatch[1]
    } else if (accountMatch) {
      entityName = accountMatch[1]
    } else if (accountTypeMatch) {
      entityName = accountTypeMatch[1]
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

  if (comparison) {
    grain = 'total'
  }

  // S14.2: Parse date range from Persian prompts
  // Patterns: "از 1403/05/01 تا 1403/05/31", "از فروردین تا مرداد 1403",
  //           "نیمه دوم سال 1403", "ماه 5 سال 1403", "از 1 خرداد تا 15 تیر"
  const dateRange = parseDateRange(normalized, yearMatches)

  const plan: MetricPlan = {
    metricId,
    grain,
    filters,
    comparison,
    entityName,
    topN,
    dateRange,
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
}

export function buildPlannerPrompt(userPrompt: string): string {
  const catalog = getMetricCatalog()
  const metricList = catalog
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
سؤال: نسبت فروش به خرید
پاسخ: {"metricId":"net_sales","grain":"total","filters":[],"confidence":0.1}

مثال ۹:
سؤال: ۱۰ سند اخیر
پاسخ: {"metricId":"recent_documents","grain":"total","filters":[],"topN":10,"confidence":0.85}

مثال ۱۰:
سؤال: مانده طرف حساب آقای مرادی
پاسخ: {"metricId":"party_balance","grain":"total","filters":[],"entityName":"مرادی","confidence":0.8}

مثال ۱۱:
سؤال: مقایسه فروش و خرید ۱۴۰۲
پاسخ: {"plans":[{"metricId":"net_sales","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9},{"metricId":"purchases","grain":"total","filters":[{"dimension":"by_year","op":"eq","values":["1402"]}],"confidence":0.9}],"joinMode":"comparison","confidence":0.85}

مثال ۱۲:
سؤال: آب‌وهوای تهران
پاسخ: {"metricId":"net_sales","grain":"total","filters":[],"confidence":0.05}

سؤال کاربر: ${userPrompt}
پاسخ JSON:`
}

// ─── P4.2 — Planner output parser ──────────────────────────────────────────
// MULTI_METRIC_PLANNER: parsePlannerOutput supports MultiMetricPlan

export interface ParsePlannerResult {
  plan: MetricPlan | null
  multiPlan?: MultiMetricPlan
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

  // Try MultiMetricPlan first (has "plans" array)
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

// S10.4: buildModelPlan now returns ParsePlannerResult which may include multiPlan
export async function buildModelPlan(
  userPrompt: string,
  deps: PlannerModelDeps
): Promise<ParsePlannerResult> {
  const plannerPrompt = buildPlannerPrompt(userPrompt)
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

export function buildClarify(prompt: string, metricId: MetricId): ClarifyResult {
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

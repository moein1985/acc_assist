import type { MetricPlan, MetricId, Grain, PlanFilter } from './types'
import { metricPlanSchema } from './types'
import { findMetricById, getMetricCatalog } from './metricCatalog'
import { normalizePersianText, normalizePersianDigits } from '../textNormalization'

export function buildDeterministicPlan(prompt: string, metricId: MetricId): MetricPlan | null {
  const def = findMetricById(metricId)
  if (!def) return null

  const normalized = normalizePersianText(normalizePersianDigits(prompt))

  const filters: PlanFilter[] = []
  let grain: Grain = 'total'
  let entityName: string | undefined
  let comparison: MetricPlan['comparison'] | undefined

  const yearMatches = normalized.match(/(\d{4})/g)
  if (yearMatches && yearMatches.length > 0) {
    const years = [...new Set(yearMatches)]
    const rangePattern = /از\s*(\d{4})\s*تا\s*(\d{4})/u.test(normalized)
    if (
      years.length >= 2 &&
      def.grainSupported.includes('by_year') &&
      !rangePattern
    ) {
      comparison = {
        dimension: 'by_year',
        baseValue: years[0],
        targetValue: years[1]
      }
    } else if (
      years.length >= 2 &&
      def.grainSupported.includes('by_year') &&
      rangePattern
    ) {
      const rangeMatch = normalized.match(/از\s*(\d{4})\s*تا\s*(\d{4})/u)
      if (rangeMatch) {
        filters.push({
          dimension: 'by_year',
          op: 'between',
          values: [rangeMatch[1], rangeMatch[2]]
        })
      }
    } else if (years.length === 1 && def.grainSupported.includes('by_year')) {
      filters.push({ dimension: 'by_year', op: 'eq', values: [years[0]] })
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
    /به تفکیک\s*فصل|فصلی|در هر فصل|سه ماهه/u.test(normalized) &&
    def.grainSupported.includes('by_quarter')
  ) {
    grain = 'by_quarter'
  } else if (
    /به تفکیک\s*حساب|در هر حساب|به تفکیک\s*سرفصل/u.test(normalized) &&
    def.grainSupported.includes('by_account')
  ) {
    grain = 'by_account'
  }

  if (def.entityNameMatch) {
    const personMatch = normalized.match(/(?:آقای|خانم|شرکت)\s+([\u0600-\u06FF]+)/u)
    const partyMatch = normalized.match(/(?:طرف\s*حساب|شخص|مشتری|فروشنده|تأمین‌کننده)\s+([\u0600-\u06FF]+)/u)
    const accountMatch = normalized.match(/(?:حساب|سرفصل|معین|تفضیلی)\s+([\u0600-\u06FF]+)/u)
    if (personMatch) {
      entityName = personMatch[1]
    } else if (partyMatch) {
      entityName = partyMatch[1]
    } else if (accountMatch) {
      entityName = accountMatch[1]
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

  if (comparison) {
    grain = 'total'
  }

  return {
    metricId,
    grain,
    filters,
    comparison,
    entityName,
    topN,
    confidence: 1.0
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

  return `تو یک برنامه‌ریزِ مالی هستی. کاربر یک سؤال مالی به فارسی می‌پرسد و تو باید یک JSON دقیق مطابق شِمای MetricPlan تولید کنی.

قواعد:
۱. فقط JSON تولید کن — هیچ متن اضافی، هیچ SQL، هیچ عدد حدسی.
۲. اگر سؤال به هیچ متریکی نمی‌خورد یا مبهم است، confidence را پایین (زیر ۰.۵) بده و metricId را همان نزدیک‌ترین بگذار.
۳. سال‌ها را در filters با dimension="by_year" و op="eq" قرار بده. مقادیر سال همیشه ۴ رقمی.
۴. اگر مقایسهٔ دو سال خواسته شد، از comparison استفاده کن.
۵. grain یکی از: total, by_year, by_month, by_account.
۶. entityName فقط اگر نام حساب/سرفصل صراحتاً ذکر شده.

متریک‌های موجود:
${metricList}

شِمای خروجی (MetricPlan):
{
  "metricId": "net_sales | purchases | account_balance | trial_balance | cash_bank_balance",
  "grain": "total | by_year | by_month | by_account",
  "filters": [{ "dimension": "by_year", "op": "eq", "values": ["1402"] }],
  "comparison": { "dimension": "by_year", "baseValue": "1402", "targetValue": "1403" },
  "entityName": "اختیاری",
  "confidence": 0.0 تا 1.0
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

سؤال کاربر: ${userPrompt}
پاسخ JSON:`
}

// ─── P4.2 — Planner output parser ──────────────────────────────────────────

export interface ParsePlannerResult {
  plan: MetricPlan | null
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

  // Zod validation
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

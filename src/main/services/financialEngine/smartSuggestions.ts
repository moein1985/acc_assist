/**
 * S20.7 — Smart Suggestions engine.
 * Generates follow-up question suggestions based on the last executed metric plan,
 * context entities, and anomaly flags.
 */

import type { MetricPlan, MetricId } from './types'
import { findMetricById } from './metricCatalog'

export interface Suggestion {
  text: string
  plan?: MetricPlan
}

export interface SuggestionContext {
  metricId: MetricId
  filters?: MetricPlan['filters']
  contextEntities?: {
    years: number[]
    accounts: string[]
    parties: string[]
  }
  hasAnomaly?: boolean
}

// Map of metricId → related suggestion templates
const SUGGESTION_MAP: Partial<Record<MetricId, Array<(ctx: SuggestionContext) => Suggestion>>> = {
  net_sales: [
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `مقایسه فروش ${y} و ${y ? Number(y) + 1 : ''}` : 'مقایسه فروش امسال و پارسال',
        plan: { metricId: 'net_sales', grain: 'total', filters: [], comparison: { dimension: 'by_year', baseValue: y, targetValue: y ? String(Number(y) + 1) : '' }, confidence: 0.8 }
      }
    },
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `پرفروش‌ترین مشتری ${y}` : 'پرفروش‌ترین مشتری',
        plan: { metricId: 'net_sales', grain: 'by_customer', filters: y ? [{ dimension: 'by_year', op: 'eq', values: [y] }] : [], topN: 5, confidence: 0.8 }
      }
    },
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `حاشیه سود ${y}` : 'حاشیه سود',
        plan: { metricId: 'gross_margin' as MetricId, grain: 'total', filters: y ? [{ dimension: 'by_year', op: 'eq', values: [y] }] : [], confidence: 0.75 }
      }
    }
  ],
  total_revenue: [
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `مقایسه درآمد ${y} و ${y ? Number(y) + 1 : ''}` : 'مقایسه درآمد دو سال',
        plan: { metricId: 'total_revenue', grain: 'total', filters: [], comparison: { dimension: 'by_year', baseValue: y, targetValue: y ? String(Number(y) + 1) : '' }, confidence: 0.8 }
      }
    },
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `هزینه‌های ${y}` : 'هزینه‌ها',
        plan: { metricId: 'total_expenses' as MetricId, grain: 'total', filters: y ? [{ dimension: 'by_year', op: 'eq', values: [y] }] : [], confidence: 0.8 }
      }
    },
    (_ctx) => ({
      text: 'صورت سود و زیان',
      plan: { metricId: 'trial_balance' as MetricId, grain: 'total', filters: [], confidence: 0.7 }
    })
  ],
  trial_balance: [
    (_ctx) => ({
      text: 'نسبت جاری چقدر است؟',
      plan: { metricId: 'cash_ratio' as MetricId, grain: 'total', filters: [], confidence: 0.75 }
    }),
    (_ctx) => ({
      text: 'تحلیل سنی دریافتنی‌ها',
      plan: { metricId: 'receivables_aging' as MetricId, grain: 'by_age_bucket', filters: [], confidence: 0.75 }
    }),
    (_ctx) => ({
      text: 'صورت سود و زیان',
      plan: { metricId: 'total_revenue', grain: 'total', filters: [], confidence: 0.7 }
    })
  ],
  purchases: [
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `مقایسه خرید و فروش ${y}` : 'مقایسه خرید و فروش',
        plan: { metricId: 'net_sales', grain: 'total', filters: y ? [{ dimension: 'by_year', op: 'eq', values: [y] }] : [], confidence: 0.8 }
      }
    },
    (ctx) => {
      const year = ctx.contextEntities?.years?.[0]
      const y = year ? String(year) : ''
      return {
        text: y ? `بزرگ‌ترین تأمین‌کنندگان ${y}` : 'بزرگ‌ترین تأمین‌کنندگان',
        plan: { metricId: 'purchases', grain: 'by_customer', filters: y ? [{ dimension: 'by_year', op: 'eq', values: [y] }] : [], topN: 5, confidence: 0.75 }
      }
    },
    (_ctx) => ({
      text: 'مانده حساب‌های پرداختنی',
      plan: { metricId: 'payables' as MetricId, grain: 'total', filters: [], confidence: 0.7 }
    })
  ],
  cash_bank_balance: [
    (_ctx) => ({
      text: 'صورت جریان وجوه نقد',
      plan: { metricId: 'cash_flow_statement' as MetricId, grain: 'total', filters: [], confidence: 0.75 }
    }),
    (_ctx) => ({
      text: 'مقایسه نقد و بانک دو سال اخیر',
      plan: { metricId: 'cash_bank_balance', grain: 'by_year', filters: [], confidence: 0.7 }
    }),
    (_ctx) => ({
      text: 'نسبت جاری',
      plan: { metricId: 'cash_ratio' as MetricId, grain: 'total', filters: [], confidence: 0.7 }
    })
  ],
  party_turnover: [
    (ctx) => {
      const party = ctx.contextEntities?.parties?.[0]
      return {
        text: party ? `مانده حساب ${party}` : 'مانده حساب طرف‌حساب',
        plan: { metricId: 'party_balance' as MetricId, grain: 'total', filters: [], entityName: party, confidence: 0.75 }
      }
    },
    (_ctx) => ({
      text: 'تحلیل سنی دریافتنی‌ها',
      plan: { metricId: 'receivables_aging' as MetricId, grain: 'by_age_bucket', filters: [], confidence: 0.7 }
    }),
    (_ctx) => ({
      text: 'چک‌های در جریان',
      plan: { metricId: 'checks_summary' as MetricId, grain: 'total', filters: [], confidence: 0.7 }
    })
  ]
}

// Default suggestions for unknown metrics
function defaultSuggestions(ctx: SuggestionContext): Suggestion[] {
  const def = findMetricById(ctx.metricId)
  const title = def?.titleFa ?? ctx.metricId
  const year = ctx.contextEntities?.years?.[0]
  const y = year ? String(year) : ''

  return [
    {
      text: y ? `مقایسه ${title} ${y} و ${Number(y) + 1}` : `مقایسه ${title} دو سال`,
      plan: { metricId: ctx.metricId, grain: 'total', filters: [], comparison: { dimension: 'by_year', baseValue: y, targetValue: y ? String(Number(y) + 1) : '' }, confidence: 0.7 }
    },
    {
      text: y ? `${title} به تفکیک ماه ${y}` : `${title} به تفکیک ماه`,
      plan: { metricId: ctx.metricId, grain: 'by_month', filters: y ? [{ dimension: 'by_year', op: 'eq', values: [y] }] : [], confidence: 0.7 }
    },
    {
      text: 'ترازنامه',
      plan: { metricId: 'trial_balance' as MetricId, grain: 'total', filters: [], confidence: 0.6 }
    }
  ]
}

export function generateSmartSuggestions(ctx: SuggestionContext): Suggestion[] {
  const generators = SUGGESTION_MAP[ctx.metricId]
  let suggestions: Suggestion[]

  if (generators) {
    suggestions = generators.map(gen => gen(ctx))
  } else {
    suggestions = defaultSuggestions(ctx)
  }

  // S20.7: If anomaly detected, add anomaly-related suggestion
  if (ctx.hasAnomaly) {
    suggestions.unshift({
      text: '⚠️ ناهنجاری کشف شد — بررسی جزئیات',
      plan: { metricId: ctx.metricId, grain: 'by_month', filters: ctx.filters ?? [], confidence: 0.6 }
    })
    suggestions = suggestions.slice(0, 4) // Keep max 4 (anomaly + 3)
  }

  return suggestions.slice(0, 3)
}

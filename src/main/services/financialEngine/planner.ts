import type { MetricPlan, MetricId, Grain, PlanFilter } from './types'
import { findMetricById } from './metricCatalog'
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
    if (years.length >= 2 && def.grainSupported.includes('by_year')) {
      comparison = {
        dimension: 'by_year',
        baseValue: years[0],
        targetValue: years[1]
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
    /به تفکیک\s*حساب|در هر حساب|به تفکیک\s*سرفصل/u.test(normalized) &&
    def.grainSupported.includes('by_account')
  ) {
    grain = 'by_account'
  }

  if (def.entityNameMatch) {
    const accountMatch = normalized.match(/(?:حساب|سرفصل|معین|تفضیلی)\s+([\u0600-\u06FF]+)/u)
    if (accountMatch) {
      entityName = accountMatch[1]
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
    confidence: 1.0
  }
}

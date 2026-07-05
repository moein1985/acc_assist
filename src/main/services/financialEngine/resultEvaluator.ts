import type { MetricId, MetricPlan } from './types'
import type { SqlQueryRow } from '../../../shared/contracts'
import { normalizePersianText, normalizePersianDigits } from '../textNormalization'
import { findMetricById } from './metricCatalog'

export interface EvaluationResult {
  acceptable: boolean
  reason: string
  suggestedMetricId?: MetricId
}

const MISMATCH_SIGNALS: Array<{ signal: string; wrongMetrics: string[]; correctMetric: MetricId }> = [
  { signal: 'گردش', wrongMetrics: ['fiscal_year_list', 'fiscal_year_count'], correctMetric: 'account_turnover' },
  { signal: 'گردش حساب', wrongMetrics: ['trial_balance', 'balance_sheet', 'net_sales', 'total_revenue', 'total_expenses'], correctMetric: 'account_turnover' },
  { signal: 'مانده', wrongMetrics: ['account_turnover', 'net_sales', 'total_revenue', 'total_expenses'], correctMetric: 'account_balance' },
  { signal: 'ترازنامه', wrongMetrics: ['trial_balance', 'net_sales'], correctMetric: 'balance_sheet' },
  { signal: 'تراز آزمایشی', wrongMetrics: ['balance_sheet', 'net_sales'], correctMetric: 'trial_balance' },
]

export function evaluateResult(
  prompt: string,
  metricId: MetricId,
  rows: SqlQueryRow[],
  _plan: MetricPlan
): EvaluationResult {
  const normalized = normalizePersianText(normalizePersianDigits(prompt)).toLowerCase()

  if (rows.length === 0) {
    for (const mismatch of MISMATCH_SIGNALS) {
      if (normalized.includes(mismatch.signal) && mismatch.wrongMetrics.includes(metricId)) {
        return {
          acceptable: false,
          reason: `metric-mismatch:${mismatch.signal}→${metricId}`,
          suggestedMetricId: mismatch.correctMetric
        }
      }
    }
    const def = findMetricById(metricId)
    if (def?.measure.kind === 'list') {
      return { acceptable: true, reason: 'empty-list' }
    }
    return { acceptable: false, reason: 'zero-rows' }
  }

  for (const mismatch of MISMATCH_SIGNALS) {
    if (normalized.includes(mismatch.signal) && mismatch.wrongMetrics.includes(metricId)) {
      return {
        acceptable: false,
        reason: `metric-mismatch:${mismatch.signal}→${metricId}`,
        suggestedMetricId: mismatch.correctMetric
      }
    }
  }

  return { acceptable: true, reason: 'ok' }
}

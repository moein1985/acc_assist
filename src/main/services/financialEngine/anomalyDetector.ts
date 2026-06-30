/**
 * S20.9 — Anomaly Detection Service.
 * Analyzes engine result rows to detect financial anomalies:
 * 1. Year-over-year change > 50%
 * 2. Balance mismatch (zero balance with many vouchers, or large balance with few vouchers)
 * 3. Unusual voucher (amount > 3 standard deviations from mean)
 * 4. Account with no activity (balance but no vouchers in period)
 */

import type { MetricId } from './types'
import type { EngineResult } from './types'

export type AnomalyType =
  | 'year_over_year_change'
  | 'balance_mismatch'
  | 'unusual_voucher'
  | 'no_activity_account'

export type AnomalySeverity = 'low' | 'medium' | 'high'

export interface Anomaly {
  type: AnomalyType
  severity: AnomalySeverity
  description: string
  metricId: MetricId
  data: Record<string, unknown>
}

export interface AnomalyDetectionContext {
  metricId: MetricId
  rows: Record<string, unknown>[]
  plan: EngineResult['plan']
}

// Threshold constants
const YOY_CHANGE_THRESHOLD = 0.5 // 50%
const YOY_HIGH_SEVERITY_THRESHOLD = 0.8 // 80%
const Z_SCORE_THRESHOLD = 3 // 3 standard deviations
const LARGE_BALANCE_VOUCHER_RATIO = 10 // balance/voucher count ratio
const ZERO_BALANCE_VOUCHER_THRESHOLD = 10 // many vouchers with zero balance

/**
 * Detect year-over-year change > 50%.
 * Works with rows that have year and amount columns.
 */
function detectYearOverYearChange(ctx: AnomalyDetectionContext): Anomaly[] {
  const anomalies: Anomaly[] = []
  const { rows, metricId } = ctx

  // Look for year and amount/value columns
  if (rows.length < 2) return anomalies

  const yearCol = findColumn(rows[0], ['year', 'sal', 'fiscal_year', 'Year'])
  const amountCol = findColumn(rows[0], ['amount', 'value', 'total', 'mandeh', 'Amount', 'balance', 'jam'])

  if (!yearCol || !amountCol) return anomalies

  // Sort by year
  const sorted = [...rows]
    .map(r => ({ year: Number(r[yearCol]), amount: Number(r[amountCol]) }))
    .filter(r => !isNaN(r.year) && !isNaN(r.amount))
    .sort((a, b) => a.year - b.year)

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (prev.amount === 0) continue

    const change = Math.abs((curr.amount - prev.amount) / prev.amount)
    if (change >= YOY_CHANGE_THRESHOLD) {
      const severity: AnomalySeverity = change >= YOY_HIGH_SEVERITY_THRESHOLD ? 'high' : 'medium'
      const direction = curr.amount > prev.amount ? 'افزایش' : 'کاهش'
      const pct = (change * 100).toFixed(1)
      anomalies.push({
        type: 'year_over_year_change',
        severity,
        description: `${direction} ${pct}٪ از سال ${prev.year} به ${curr.year}`,
        metricId,
        data: {
          prevYear: prev.year,
          currYear: curr.year,
          prevAmount: prev.amount,
          currAmount: curr.amount,
          changePercent: Number(pct)
        }
      })
    }
  }

  return anomalies
}

/**
 * Detect balance mismatch: zero balance with many vouchers, or large balance with few vouchers.
 */
function detectBalanceMismatch(ctx: AnomalyDetectionContext): Anomaly[] {
  const anomalies: Anomaly[] = []
  const { rows, metricId } = ctx

  if (rows.length === 0) return anomalies

  const balanceCol = findColumn(rows[0], ['balance', 'mandeh', 'Mandeh', 'jam'])
  const countCol = findColumn(rows[0], ['count', 'voucher_count', 'tedad', 'Count', 'voucherCount'])

  if (!balanceCol || !countCol) return anomalies

  for (const row of rows) {
    const balance = Number(row[balanceCol])
    const count = Number(row[countCol])
    if (isNaN(balance) || isNaN(count)) continue

    // Zero balance with many vouchers
    if (Math.abs(balance) < 1 && count >= ZERO_BALANCE_VOUCHER_THRESHOLD) {
      anomalies.push({
        type: 'balance_mismatch',
        severity: 'medium',
        description: `مانده صفر با ${count} سند — احتمال نیاز به بررسی`,
        metricId,
        data: { balance, voucherCount: count }
      })
    }

    // Large balance with very few vouchers
    if (Math.abs(balance) > 1000000 && count > 0 && Math.abs(balance) / count > LARGE_BALANCE_VOUCHER_RATIO * 1000000) {
      anomalies.push({
        type: 'balance_mismatch',
        severity: 'low',
        description: `مانده بزرگ (${balance.toLocaleString()}) با تعداد سند کم (${count})`,
        metricId,
        data: { balance, voucherCount: count }
      })
    }
  }

  return anomalies
}

/**
 * Detect unusual voucher: amount > 3 standard deviations from mean.
 */
function detectUnusualVoucher(ctx: AnomalyDetectionContext): Anomaly[] {
  const anomalies: Anomaly[] = []
  const { rows, metricId } = ctx

  if (rows.length < 4) return anomalies // Need enough data for meaningful statistics

  const amountCol = findColumn(rows[0], ['amount', 'value', 'total', 'mablagh', 'Amount', 'jam'])
  if (!amountCol) return anomalies

  const amounts = rows
    .map(r => Number(r[amountCol]))
    .filter(a => !isNaN(a))

  if (amounts.length < 4) return anomalies

  const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
  const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) return anomalies

  for (const row of rows) {
    const amount = Number(row[amountCol])
    if (isNaN(amount)) continue

    const zScore = Math.abs((amount - mean) / stdDev)
    if (zScore >= Z_SCORE_THRESHOLD) {
      anomalies.push({
        type: 'unusual_voucher',
        severity: 'high',
        description: `سند با مبلغ ${amount.toLocaleString()} (۳ انحراف معیار از میانگین: z=${zScore.toFixed(2)})`,
        metricId,
        data: { amount, mean, stdDev, zScore: Number(zScore.toFixed(2)) }
      })
    }
  }

  return anomalies
}

/**
 * Detect accounts with balance but no activity (no vouchers in period).
 */
function detectNoActivityAccount(ctx: AnomalyDetectionContext): Anomaly[] {
  const anomalies: Anomaly[] = []
  const { rows, metricId } = ctx

  if (rows.length === 0) return anomalies

  const balanceCol = findColumn(rows[0], ['balance', 'mandeh', 'Mandeh', 'jam'])
  const countCol = findColumn(rows[0], ['count', 'voucher_count', 'tedad', 'Count', 'voucherCount'])
  const nameCol = findColumn(rows[0], ['name', 'title', 'account_name', 'Name', 'Title', 'hesab'])

  if (!balanceCol || !countCol) return anomalies

  for (const row of rows) {
    const balance = Number(row[balanceCol])
    const count = Number(row[countCol])
    if (isNaN(balance) || isNaN(count)) continue

    if (Math.abs(balance) > 1000 && count === 0) {
      const accountName = nameCol ? String(row[nameCol] ?? 'نامشخص') : 'نامشخص'
      anomalies.push({
        type: 'no_activity_account',
        severity: 'low',
        description: `حساب «${accountName}» با مانده ${balance.toLocaleString()} بدون سند در دوره`,
        metricId,
        data: { accountName, balance, voucherCount: count }
      })
    }
  }

  return anomalies
}

/**
 * Find a column name from candidates that exists in the row.
 */
function findColumn(row: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(row)
  for (const candidate of candidates) {
    const match = keys.find(k => k.toLowerCase() === candidate.toLowerCase())
    if (match) return match
  }
  // Also check for partial matches
  for (const candidate of candidates) {
    const match = keys.find(k => k.toLowerCase().includes(candidate.toLowerCase()))
    if (match) return match
  }
  return null
}

/**
 * Main entry point: run all anomaly detectors on the given context.
 */
export function detectAnomalies(ctx: AnomalyDetectionContext): Anomaly[] {
  const anomalies: Anomaly[] = []

  anomalies.push(...detectYearOverYearChange(ctx))
  anomalies.push(...detectBalanceMismatch(ctx))
  anomalies.push(...detectUnusualVoucher(ctx))
  anomalies.push(...detectNoActivityAccount(ctx))

  return anomalies
}

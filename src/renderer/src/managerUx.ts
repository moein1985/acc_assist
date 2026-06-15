import type {
  AgentProgressEvent,
  AuditLogViewerEntry,
  ReportExportEvidenceItem,
  SqlQueryRow
} from '../../shared/contracts'

export interface ManagerKpiCardModel {
  label: string
  value: string
  hint: string
}

export interface QualityCardModel {
  label: string
  value: string
}

export function buildManagerKpiCards(snapshot: {
  evidence: ReportExportEvidenceItem[]
}): ManagerKpiCardModel[] {
  const evidenceItems = Array.isArray(snapshot?.evidence) ? snapshot.evidence : []
  const evidenceCount = evidenceItems.length
  const totalRows = evidenceItems.reduce((sum, item) => sum + (Number.isFinite(item.rowCount) ? item.rowCount : 0), 0)

  const cards: ManagerKpiCardModel[] = [
    {
      label: 'تعداد ابزارهای دارای شواهد',
      value: formatKpiNumber(evidenceCount),
      hint: 'جمع ابزارهایی که خروجی قابل استناد برگردانده‌اند.'
    },
    {
      label: 'جمع ردیف های شواهد',
      value: formatKpiNumber(totalRows),
      hint: 'نمایی از حجم داده تحلیل شده در پاسخ جاری.'
    }
  ]

  const metric = findPrimaryNumericMetric(evidenceItems)
  if (!metric) {
    return cards
  }

  cards.push({
    label: `جمع ${metric.columnName}`,
    value: formatKpiNumber(metric.sum),
    hint: `ابزار: ${metric.toolName}`
  })
  cards.push({
    label: `بیشینه ${metric.columnName}`,
    value: formatKpiNumber(metric.max),
    hint: `کمینه: ${formatKpiNumber(metric.min)} | میانگین: ${formatKpiNumber(metric.avg)}`
  })

  return cards
}

export function buildQualityDashboardCards(entries: AuditLogViewerEntry[]): QualityCardModel[] {
  const toolSuccessCount = entries.filter((entry) => entry.stage === 'tool-success').length
  const toolErrorCount = entries.filter((entry) => entry.stage === 'tool-error').length
  const finalCount = entries.filter((entry) => entry.stage === 'final').length
  const errorCount = entries.filter((entry) => entry.stage === 'error').length
  const qualityDenominator = toolSuccessCount + toolErrorCount
  const toolSuccessRate = qualityDenominator > 0 ? (toolSuccessCount / qualityDenominator) * 100 : null

  const durationValues = entries
    .map((entry) => entry.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  const avgDuration = durationValues.length > 0
    ? durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length
    : null

  const rowCountValues = entries
    .map((entry) => entry.rowCount)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  const avgRowCount = rowCountValues.length > 0
    ? rowCountValues.reduce((sum, value) => sum + value, 0) / rowCountValues.length
    : null

  return [
    { label: 'نرخ موفقیت ابزارها', value: toolSuccessRate === null ? '-' : `${formatKpiNumber(toolSuccessRate)}%` },
    { label: 'ابزار موفق', value: formatKpiNumber(toolSuccessCount) },
    { label: 'ابزار خطادار', value: formatKpiNumber(toolErrorCount) },
    { label: 'پاسخ نهایی', value: formatKpiNumber(finalCount) },
    { label: 'خطاهای نهایی', value: formatKpiNumber(errorCount) },
    { label: 'میانگین زمان (ms)', value: avgDuration === null ? '-' : formatKpiNumber(avgDuration) },
    { label: 'میانگین ردیف شواهد', value: avgRowCount === null ? '-' : formatKpiNumber(avgRowCount) }
  ]
}

function findPrimaryNumericMetric(evidenceItems: ReportExportEvidenceItem[]): {
  toolName: string
  columnName: string
  sum: number
  min: number
  max: number
  avg: number
} | null {
  for (const item of evidenceItems) {
    if (!Array.isArray(item.rows) || item.rows.length === 0) {
      continue
    }

    const columns = Array.isArray(item.columns) ? item.columns.filter((column) => column.trim()) : []
    if (columns.length === 0) {
      continue
    }

    const metricColumn = selectMetricColumn(columns, item.rows)
    if (!metricColumn) {
      continue
    }

    const values: number[] = []
    for (const row of item.rows) {
      const parsed = toChartNumber(row[metricColumn])
      if (parsed !== null) {
        values.push(parsed)
      }
    }

    if (values.length === 0) {
      continue
    }

    const sum = values.reduce((acc, value) => acc + value, 0)
    return {
      toolName: item.toolName,
      columnName: metricColumn,
      sum,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: sum / values.length
    }
  }

  return null
}

function selectMetricColumn(columns: string[], rows: SqlQueryRow[]): string | null {
  const numericColumns = columns.filter((column) => rows.some((row) => toChartNumber(row[column]) !== null))
  if (numericColumns.length === 0) {
    return null
  }

  const metricHintPattern = /(amount|total|sum|balance|debit|credit|sales|revenue|profit|cost|value|count|qty|مانده|مبلغ|جمع|فروش|درآمد|هزینه|تعداد)/i
  return numericColumns.find((column) => metricHintPattern.test(column)) ?? numericColumns[0]
}

function toChartNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  if (typeof value === 'string') {
    const normalizedDigits = value
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    const normalized = normalizedDigits.replace(/[،,\s]/g, '')
    if (!normalized) {
      return null
    }
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export type AgentStatusState = 'idle' | 'thinking' | 'running-tool' | 'answered' | 'degraded' | 'circuit-open' | 'aborted'

export function resolveAgentStatusState(event: AgentProgressEvent): AgentStatusState {
  switch (event.type) {
    case 'thinking':
    case 'planning':
      return 'thinking'
    case 'tool-start':
    case 'tool-running':
      return 'running-tool'
    case 'answer':
    case 'final':
      return 'answered'
    case 'network-degraded':
      return 'degraded'
    case 'provider-circuit-open':
      return 'circuit-open'
    case 'loop-aborted':
      return 'aborted'
    default:
      return 'idle'
  }
}

export function buildAgentRecoverySummary(event: AgentProgressEvent): string {
  const evidenceRows = Array.isArray(event.evidence?.rows) ? event.evidence.rows.length : 0
  const partialText = evidenceRows > 0
    ? `تا این مرحله ${evidenceRows} ردیف شواهد جمع‌آوری شد. جزئیات موجود را بررسی کنید.`
    : 'تا این مرحله شواهد قابل استنادی در دسترس نیست.'

  const actions = (event.suggestedActions ?? []).map((action) => {
    switch (action) {
      case 'retry':
        return 'تلاش مجدد'
      case 'narrow-scope':
        return 'محدوده را کوچک‌تر کنید'
      case 'simplify':
        return 'سؤال را ساده‌تر بپرسید'
      case 'view-partial':
        return 'مشاهده جزئیات موجود'
      default:
        return action
    }
  })

  const actionText = actions.length > 0 ? ` اقدام‌های پیشنهادی: ${actions.join(' • ')}` : ''

  return `${event.message || 'درخواست به‌دلیل مشکل شبکه متوقف شد.'}${actionText}\n${partialText}`
}

function formatKpiNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-'
  }

  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value)
}

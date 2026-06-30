/**
 * Explainer for the Financial Reasoning Engine (FRE).
 *
 * Phase 5: Renders verified engine results into Persian markdown.
 * Two modes: (1) deterministic template (default, no model), (2) model-assisted (optional).
 *
 * @see FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md
 */

import type { EngineResult, MetricPlan } from './types'
import type { EngineVerdict } from './types'
import type { MultiMetricResult, MultiStepResult } from './index'
import { findMetricById } from './metricCatalog'

/**
 * X5.6 — Deterministic template renderer (no model required).
 * Builds markdown from verified engine numbers.
 */
export function composeEngineResponseMarkdown(
  result: EngineResult,
  verdict: EngineVerdict,
  _prompt: string
): string {
  const def = findMetricById(result.plan.metricId)
  const titleFa = def?.titleFa ?? result.plan.metricId
  const value = extractResultValue(result)

  const summaryLine = formatSummaryLine(titleFa, value, result.plan)
  const findingsLines = formatFindingsLines(titleFa, value, result.plan)
  const evidenceLines = formatEvidenceLines(result, verdict)
  const assumptionsLines = formatAssumptionsLines(result.plan, verdict)
  const actionsLines = formatActionsLines(result.plan)

  return [
    '### Summary',
    summaryLine,
    '',
    '### Findings',
    `- مسیر پاسخ: engine`,
    ...findingsLines,
    '',
    '### Evidence',
    ...evidenceLines,
    '',
    '### Assumptions',
    ...assumptionsLines,
    '',
    '### Actions',
    ...actionsLines
  ].join('\n')
}

/**
 * X5.6 — Model-assisted explainer (optional).
 * Sends verified numbers to the model for richer narrative.
 * The model is told: "these numbers are final; do not change them or invent new ones."
 */
export interface ExplainerModelDeps {
  callModel: (prompt: string) => Promise<string>
}

export async function composeModelExplainerResponse(
  result: EngineResult,
  verdict: EngineVerdict,
  prompt: string,
  deps: ExplainerModelDeps
): Promise<string> {
  const def = findMetricById(result.plan.metricId)
  const titleFa = def?.titleFa ?? result.plan.metricId
  const value = extractResultValue(result)

  const numbersContext = `اعداد تأییدشده (قطعی، تغییر ندهید):\n${titleFa}: ${value ?? 'ناموجود'}\nmetricId: ${result.plan.metricId}\ngrain: ${result.plan.grain}`

  const modelPrompt = `تو یک توضیح‌نویس مالی هستی. اعداد زیر قطعی و تأییدشده‌اند — آن‌ها را تغییر نده و عدد جدید نساز.
${numbersContext}

سؤال کاربر: ${prompt}

یک متن فارسی با ساختار زیر بنویس:
### Summary
(خلاصهٔ یک‌خطی)
### Findings
(یافته‌ها)
### Evidence
(شواهد)
### Assumptions
(فرض‌ها)
### Actions
(پیشنهادها)`

  try {
    const modelOutput = await deps.callModel(modelPrompt)
    // Post-generation guard: ensure the verified number appears in the output
    if (value !== null) {
      const valueStr = String(value)
      if (
        !modelOutput.includes(valueStr) &&
        !modelOutput.includes(Number(value).toLocaleString('en-US'))
      ) {
        // Fallback to deterministic if model dropped the number
        return composeEngineResponseMarkdown(result, verdict, prompt)
      }
    }
    return modelOutput
  } catch {
    return composeEngineResponseMarkdown(result, verdict, prompt)
  }
}

function formatSummaryLine(titleFa: string, value: number | null, plan: MetricPlan): string {
  if (value === null) {
    return `${titleFa}: رکوردی یافت نشد.`
  }

  const formatted = value.toLocaleString('en-US')

  if (plan.comparison) {
    return `${titleFa} — مقایسهٔ ${plan.comparison.baseValue} و ${plan.comparison.targetValue}.`
  }

  const yearFilter = plan.filters.find((f) => f.dimension === 'by_year')
  if (yearFilter && yearFilter.values.length > 0) {
    return `${titleFa} سال ${yearFilter.values[0]}: ${formatted}`
  }

  return `${titleFa}: ${formatted}`
}

function formatFindingsLines(titleFa: string, value: number | null, plan: MetricPlan): string[] {
  const lines: string[] = []

  if (value !== null) {
    lines.push(`- ${titleFa}: ${value.toLocaleString('en-US')}`)
  } else {
    lines.push(`- ${titleFa}: رکوردی ثبت نشده است.`)
  }

  if (plan.comparison) {
    lines.push(`- مقایسه: سال ${plan.comparison.baseValue} با سال ${plan.comparison.targetValue}`)
  }

  if (plan.entityName) {
    lines.push(`- موجودیت: ${plan.entityName}`)
  }

  return lines
}

function formatEvidenceLines(result: EngineResult, verdict: EngineVerdict): string[] {
  const lines: string[] = []
  lines.push(`- منبع داده: Financial Engine (metricId=${result.plan.metricId})`)
  lines.push(`- SQL: ${result.compiled.sql.replace(/\s+/g, ' ').slice(0, 220)}`)
  lines.push(`- Verifier: ${verdict.ok ? 'passed' : 'failed'}`)

  if (verdict.reconciliations.length > 0) {
    for (const r of verdict.reconciliations) {
      lines.push(`- Reconciliation ${r.id}: ${r.passed ? 'passed' : 'failed'}`)
    }
  }

  return lines
}

function formatAssumptionsLines(plan: MetricPlan, verdict: EngineVerdict): string[] {
  const lines: string[] = []
  lines.push('- پاسخ بر پایه دادهٔ واقعی ابزار read-only است.')

  if (plan.comparison) {
    lines.push('- درصد تغییر طبق فرمول استاندارد محاسبه شده است.')
  }

  if (!verdict.ok) {
    lines.push(`- هشدار: Verifier نتیجه را رد کرد (${verdict.reason ?? 'unknown'}).`)
  }

  return lines
}

function formatActionsLines(plan: MetricPlan): string[] {
  const lines: string[] = []
  lines.push('- در صورت نیاز، بازه زمانی یا scope را دقیق‌تر مشخص کنید.')

  if (plan.comparison) {
    lines.push('- می‌توانید همین مقایسه را به تفکیک ماه/شعبه هم درخواست کنید.')
  }

  return lines
}

function extractResultValue(result: EngineResult): number | null {
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  const raw = row['result_value'] ?? row['base_value']
  if (raw === null || raw === undefined) return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

export function composeMultiMetricMarkdown(
  multiResult: MultiMetricResult,
  _prompt: string
): string {
  const { results, verdicts, plan } = multiResult

  const lines: string[] = ['### Summary']

  if (plan.joinMode === 'side_by_side') {
    const parts = results.map((r) => {
      const def = findMetricById(r.plan.metricId)
      const title = def?.titleFa ?? r.plan.metricId
      const val = extractResultValue(r)
      return `${title}: ${val !== null ? val.toLocaleString('en-US') : 'ناموجود'}`
    })
    lines.push(parts.join(' | '))
  } else if (plan.joinMode === 'comparison') {
    const vals = results.map((r) => extractResultValue(r))
    lines.push('مقایسهٔ متریک‌ها:')
    for (let i = 0; i < results.length; i++) {
      const def = findMetricById(results[i].plan.metricId)
      const title = def?.titleFa ?? results[i].plan.metricId
      lines.push(`- ${title}: ${vals[i] !== null ? vals[i]!.toLocaleString('en-US') : 'ناموجود'}`)
    }
    if (vals.length === 2 && vals[0] !== null && vals[1] !== null && vals[0] !== 0) {
      const pct = ((vals[1]! - vals[0]!) / Math.abs(vals[0]!) * 100).toFixed(1)
      lines.push(`- درصد تفاوت: ${pct}%`)
    }
  } else {
    lines.push('روند متریک:')
  }

  lines.push('', '### Findings', '- مسیر پاسخ: engine (multi-metric)')

  for (let i = 0; i < results.length; i++) {
    const def = findMetricById(results[i].plan.metricId)
    const title = def?.titleFa ?? results[i].plan.metricId
    const val = extractResultValue(results[i])
    const vok = verdicts[i]?.ok ?? false
    lines.push(`- ${title}: ${val !== null ? val.toLocaleString('en-US') : 'ناموجود'} (verdict: ${vok ? 'ok' : 'failed'})`)
  }

  lines.push('', '### Evidence')
  for (let i = 0; i < results.length; i++) {
    const def = findMetricById(results[i].plan.metricId)
    const title = def?.titleFa ?? results[i].plan.metricId
    const sql = results[i].compiled.sql.replace(/\s+/g, ' ').slice(0, 180)
    lines.push(`- ${title}: ${sql}`)
  }

  lines.push('', '### Assumptions', '- پاسخ بر پایه دادهٔ واقعی ابزار read-only است.')

  return lines.join('\n')
}

// S20.4 — composeMultiStepMarkdown for MultiStepPlan results
export function composeMultiStepMarkdown(
  stepResult: MultiStepResult,
  _prompt: string
): string {
  const { results, verdicts, plan } = stepResult
  const strategy = plan.combineStrategy ?? 'compare'

  const lines: string[] = ['### Summary']

  const vals = results.map((r) => extractResultValue(r))

  if (strategy === 'compare') {
    lines.push('مقایسهٔ مراحل:')
    for (let i = 0; i < results.length; i++) {
      const def = findMetricById(results[i].plan.metricId)
      const title = def?.titleFa ?? results[i].plan.metricId
      lines.push(`- ${title}: ${vals[i] !== null ? vals[i]!.toLocaleString('en-US') : 'ناموجود'}`)
    }
    if (vals.length === 2 && vals[0] !== null && vals[1] !== null && vals[0] !== 0) {
      const pct = (((vals[1]! - vals[0]!) / Math.abs(vals[0]!)) * 100).toFixed(1)
      lines.push(`- درصد تفاوت: ${pct}%`)
    }
  } else if (strategy === 'cascade') {
    lines.push('نتایج زنجیره‌ای:')
    for (let i = 0; i < results.length; i++) {
      const def = findMetricById(results[i].plan.metricId)
      const title = def?.titleFa ?? results[i].plan.metricId
      lines.push(`- مرحله ${i + 1} — ${title}: ${vals[i] !== null ? vals[i]!.toLocaleString('en-US') : 'ناموجود'}`)
    }
  } else {
    // explain
    lines.push('تحلیل توضیحی:')
    for (let i = 0; i < results.length; i++) {
      const def = findMetricById(results[i].plan.metricId)
      const title = def?.titleFa ?? results[i].plan.metricId
      lines.push(`- ${title}: ${vals[i] !== null ? vals[i]!.toLocaleString('en-US') : 'ناموجود'}`)
    }
  }

  lines.push('', '### Findings', `- مسیر پاسخ: engine (multi-step, strategy=${strategy})`)

  for (let i = 0; i < results.length; i++) {
    const def = findMetricById(results[i].plan.metricId)
    const title = def?.titleFa ?? results[i].plan.metricId
    const vok = verdicts[i]?.ok ?? false
    lines.push(`- مرحله ${i + 1} — ${title}: ${vals[i] !== null ? vals[i]!.toLocaleString('en-US') : 'ناموجود'} (verdict: ${vok ? 'ok' : 'failed'})`)
  }

  lines.push('', '### Evidence')
  for (let i = 0; i < results.length; i++) {
    const def = findMetricById(results[i].plan.metricId)
    const title = def?.titleFa ?? results[i].plan.metricId
    const sql = results[i].compiled.sql.replace(/\s+/g, ' ').slice(0, 180)
    lines.push(`- مرحله ${i + 1} — ${title}: ${sql}`)
  }

  lines.push('', '### Assumptions', '- پاسخ بر پایه دادهٔ واقعی ابزار read-only است.')

  return lines.join('\n')
}

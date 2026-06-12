import { pathToFileURL } from 'node:url'

import {
  detectFinancialIntent,
  listFinancialIntentDefinitions
} from '../../src/main/services/financialIntentRegistry'

export type GoldenPromptCase = {
  id: string
  prompt: string
  expectedIntentId: string
  expectedMode?: 'deterministic' | 'model-assisted'
  expectedTools?: string[]
  expectedEvidenceKeywords?: string[]
}

export const DEFAULT_GOLDEN_CASES: GoldenPromptCase[] = [
  {
    id: 'fiscal-year-count',
    prompt: 'در دیتابیس چند سال مالی قرار داره؟',
    expectedIntentId: 'count_fiscal_years',
    expectedMode: 'deterministic',
    expectedTools: ['count_fiscal_years'],
    expectedEvidenceKeywords: ['fiscal_year_count']
  },
  {
    id: 'fiscal-year-list',
    prompt: 'لیست سال‌های مالی را نمایش بده',
    expectedIntentId: 'list_fiscal_years',
    expectedMode: 'deterministic',
    expectedTools: ['list_fiscal_years'],
    expectedEvidenceKeywords: ['fiscal_year']
  },
  {
    id: 'account-balance',
    prompt: 'مانده حساب فروشگاه را بگو',
    expectedIntentId: 'get_account_balance',
    expectedMode: 'deterministic',
    expectedTools: ['get_account_balance'],
    expectedEvidenceKeywords: ['balance']
  }
]

export type GoldenPromptEvaluationResult = {
  total: number
  passed: number
  failures: string[]
  score: number
  maxScore: number
  results: Array<{
    id: string
    prompt: string
    intentId: string | null
    responseMode: 'deterministic' | 'model-assisted' | 'unknown'
    passed: boolean
    checks: {
      intent: boolean
      mode: boolean
      tool: boolean
      evidence: boolean
    }
    score: number
  }>
}

const CHECK_WEIGHTS = {
  intent: 25,
  mode: 25,
  tool: 25,
  evidence: 25
} as const

function getEvidenceHints(intentId: string | null): string[] {
  if (!intentId) {
    return []
  }

  const hintMap: Record<string, string[]> = {
    count_fiscal_years: ['fiscal_year_count', 'fiscal_year', 'count'],
    list_fiscal_years: ['fiscal_year', 'year_list', 'list'],
    get_account_balance: ['account_balance', 'balance', 'account'],
    get_party_balance: ['party_balance', 'balance', 'party'],
    get_cashflow_summary: ['cashflow', 'cash', 'flow'],
    get_sales_summary_by_period: ['sales', 'period'],
    get_receivables_summary: ['receivables', 'receivable'],
    get_payables_summary: ['payables', 'payable'],
    get_account_turnover: ['turnover', 'account'],
    get_recent_or_suspicious_documents: ['documents', 'suspicious']
  }

  return hintMap[intentId] ?? [intentId]
}

export function evaluateGoldenPromptSet(cases: GoldenPromptCase[]): GoldenPromptEvaluationResult {
  const results = cases.map((testCase) => {
    const detected = detectFinancialIntent(testCase.prompt)
    const intentId = detected?.intentId ?? null
    const definitions = listFinancialIntentDefinitions()
    const matchedDefinition = definitions.find((item) => item.id === intentId)
    const responseMode = (matchedDefinition?.responseMode ?? 'unknown') as
      | 'deterministic'
      | 'model-assisted'
      | 'unknown'

    const checks = {
      intent: intentId === testCase.expectedIntentId,
      mode: testCase.expectedMode ? responseMode === testCase.expectedMode : true,
      tool: testCase.expectedTools?.length
        ? testCase.expectedTools.some((toolId) => toolId === intentId || toolId === matchedDefinition?.id)
        : true,
      evidence: testCase.expectedEvidenceKeywords?.length
        ? testCase.expectedEvidenceKeywords.every((keyword) => {
            const candidates = [testCase.prompt, intentId ?? '', matchedDefinition?.description ?? '', ...getEvidenceHints(intentId)]
            return candidates.some((candidate) => candidate.toLowerCase().includes(keyword.toLowerCase()))
          })
        : true
    }

    const passed = checks.intent && checks.mode && checks.tool && checks.evidence
    const score = Object.entries(CHECK_WEIGHTS).reduce((total, [key, weight]) => {
      return total + (checks[key as keyof typeof checks] ? weight : 0)
    }, 0)

    return {
      id: testCase.id,
      prompt: testCase.prompt,
      intentId,
      responseMode,
      passed,
      checks,
      score
    }
  })

  const failures = results
    .filter((entry) => !entry.passed)
    .map((entry) => `Golden prompt '${entry.id}' failed: expected intent '${entry.intentId ?? 'unknown'}' to match '${entry.prompt}'`)

  const score = results.reduce((total, entry) => total + entry.score, 0)

  return {
    total: results.length,
    passed: results.filter((entry) => entry.passed).length,
    failures,
    score,
    maxScore: results.length * 100,
    results
  }
}

export function formatSummary(result: GoldenPromptEvaluationResult): string {
  return [
    'Golden prompt evaluation summary',
    `Total: ${result.total}`,
    `Passed: ${result.passed}`,
    `Failed: ${result.total - result.passed}`,
    `Score: ${result.score}/${result.maxScore}`,
    result.failures.length > 0 ? `Failures:\n- ${result.failures.join('\n- ')}` : 'Failures: none'
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluateGoldenPromptSet(DEFAULT_GOLDEN_CASES)
  console.log(formatSummary(result))
  if (result.total - result.passed > 0) {
    process.exitCode = 1
  }
}

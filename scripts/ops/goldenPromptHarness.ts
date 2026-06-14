import { pathToFileURL } from 'node:url'

import {
  detectFinancialIntent,
  listFinancialIntentDefinitions
} from '../../src/main/services/financialIntentRegistry'

export type GoldenPromptCase = {
  id: string
  prompt: string
  paraphrases?: string[]
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
  },
  {
    id: 'receivables-summary',
    prompt: 'بدهکاران ماهانه را با شواهد عددی خلاصه کن',
    expectedIntentId: 'get_receivables_summary',
    expectedMode: 'deterministic',
    expectedTools: ['get_receivables_summary'],
    expectedEvidenceKeywords: ['receivables']
  },
  {
    id: 'payables-summary',
    prompt: 'بستانکاران این ماه را جمع‌بندی کن',
    expectedIntentId: 'get_payables_summary',
    expectedMode: 'deterministic',
    expectedTools: ['get_payables_summary'],
    expectedEvidenceKeywords: ['payables']
  },
  {
    id: 'cashflow-summary',
    prompt: 'جریان نقدی سه ماه اخیر را با شواهد نشان بده',
    expectedIntentId: 'get_cashflow_summary',
    expectedMode: 'deterministic',
    expectedTools: ['get_cashflow_summary'],
    expectedEvidenceKeywords: ['cashflow', 'جریان نقد']
  },
  {
    id: 'sales-summary',
    prompt: 'فروش ماهانه را با جمع و روند گزارش بده',
    paraphrases: ['جمع‌بندی فروش ماهانه', 'خلاصه فروش ماهانه'],
    expectedIntentId: 'get_sales_summary_by_period',
    expectedMode: 'model-assisted',
    expectedTools: ['get_sales_summary_by_period'],
    expectedEvidenceKeywords: ['sales', 'فروش']
  },
  {
    id: 'party-balance',
    prompt: 'مانده طرف حساب فروشگاه را بگو',
    paraphrases: ['تعادل حساب فروشنده', 'مانده مشتری'],
    expectedIntentId: 'get_party_balance',
    expectedMode: 'deterministic',
    expectedTools: ['get_party_balance'],
    expectedEvidenceKeywords: ['party', 'مانده']
  },
  {
    id: 'account-turnover',
    prompt: 'گردش حساب فروش را در این بازه نشان بده',
    paraphrases: ['نرخ گردش حساب فروش', 'گردش حساب در ماه جاری'],
    expectedIntentId: 'get_account_turnover',
    expectedMode: 'model-assisted',
    expectedTools: ['get_account_turnover'],
    expectedEvidenceKeywords: ['turnover', 'گردش']
  },
  {
    id: 'recent-documents',
    prompt: 'اسناد مشکوک اخیر را فهرست کن',
    paraphrases: ['اسناد اخیر با ریسک بالا', 'اسناد مشکوک جدید'],
    expectedIntentId: 'get_recent_or_suspicious_documents',
    expectedMode: 'model-assisted',
    expectedTools: ['get_recent_or_suspicious_documents'],
    expectedEvidenceKeywords: ['document', 'اسناد']
  },
  {
    id: 'cashflow-range',
    prompt: 'جریان نقدی سه ماه اخیر را با شواهد نشان بده',
    paraphrases: ['خلاصه جریان وجه سه ماه', 'نقدینگی سه ماه اخیر'],
    expectedIntentId: 'get_cashflow_summary',
    expectedMode: 'deterministic',
    expectedTools: ['get_cashflow_summary'],
    expectedEvidenceKeywords: ['cashflow', 'جریان نقد']
  },
  {
    id: 'receivables-monthly',
    prompt: 'خلاصه بدهکاران این ماه را گزارش بده',
    paraphrases: ['جمع دریافتی‌ها در ماه جاری', 'بدهکاران ماهانه'],
    expectedIntentId: 'get_receivables_summary',
    expectedMode: 'deterministic',
    expectedTools: ['get_receivables_summary'],
    expectedEvidenceKeywords: ['receivables', 'بدهکاران']
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
    expectedIntentId: string
    intentId: string | null
    responseMode: 'deterministic' | 'model-assisted' | 'unknown'
    passed: boolean
    checks: {
      intent: boolean
      mode: boolean
      tool: boolean
      evidence: boolean
    }
    paraphraseCoverage: number
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
    const paraphrases = Array.from(new Set((testCase.paraphrases ?? []).filter(Boolean)))
    const paraphraseCoverage = paraphrases.filter((candidate) => detectFinancialIntent(candidate)?.intentId === testCase.expectedIntentId).length
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
      expectedIntentId: testCase.expectedIntentId,
      intentId,
      responseMode,
      passed,
      checks,
      paraphraseCoverage,
      score
    }
  })

  const failures = results
    .filter((entry) => !entry.passed)
    .map((entry) => {
      const failedChecks = Object.entries(entry.checks)
        .filter(([_, passed]) => !passed)
        .map(([key]) => key)
        .join(', ')
      return `Golden prompt '${entry.id}' failed (${failedChecks}): expected intent='${entry.expectedIntentId ?? 'unknown'}' but detected='${entry.intentId ?? 'unknown'}'; prompt='${entry.prompt}'`
    })

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

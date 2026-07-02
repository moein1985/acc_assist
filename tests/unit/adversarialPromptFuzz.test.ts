import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'

function createHarness() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const orchestrator = new AgentOrchestrator({
    geminiClient: {
      chat: async () => ({
        text: '',
        raw: {},
        toolCalls: []
      })
    },
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: {
      write: async () => undefined
    }
  })

  return orchestrator as any
}

function runContract(orchestrator: any, prompt: string, finalText: string, trace?: any) {
  return orchestrator.enforceEvidenceFirstContract(
    prompt,
    finalText,
    1,
    trace ? 1 : 0,
    trace,
    { attempts: 0 },
    'adversarial-fuzz',
    'adversarial-fuzz-conversation'
  )
}

test('adversarial fuzz prompts reject fabricated numeric claims without trace evidence', () => {
  const orchestrator = createHarness()

  const cases = [
    {
      prompt: 'فروش ماهانه امسال را با جزئیات کامل بده',
      finalText: [
        '### Summary',
        'مبلغ فروش 1250000 تومان است.',
        '',
        '### Findings',
        'این عدد از حدس مدل و بدون داده واقعی است.',
        '',
        '### Evidence',
        'بدون اجرای کوئری واقعی.',
        '',
        '### Assumptions',
        'استفاده از برآورد مدل.',
        '',
        '### Actions',
        'داده واقعی را دوباره بررسی کن.'
      ].join('\n')
    },
    {
      prompt: 'رشد فروش در سال 1403 را گزارش کن',
      finalText: [
        '### Summary',
        'رشد فروش 15 درصد است.',
        '',
        '### Findings',
        'این درصد توسط مدل تخمین زده شده است.',
        '',
        '### Evidence',
        'هیچ fetch_financial_data اجرا نشده است.',
        '',
        '### Assumptions',
        'پاسخ بر اساس حدس است.',
        '',
        '### Actions',
        'برای پاسخ دقیق، داده واقعی را استخراج کن.'
      ].join('\n')
    },
    {
      prompt: 'موجودی حساب صندوق را برای این ماه نشان بده',
      finalText: [
        '### Summary',
        'موجودی حساب 3000000 تومان است.',
        '',
        '### Findings',
        'این عدد ساختگی است.',
        '',
        '### Evidence',
        'شواهد ساخت‌یافته وجود ندارد.',
        '',
        '### Assumptions',
        'تخمین مدل.',
        '',
        '### Actions',
        'داده واقعی را بازیابی کن.'
      ].join('\n')
    }
  ]

  for (const testCase of cases) {
    const output = runContract(orchestrator, testCase.prompt, testCase.finalText)
    assert.match(output, /Cannot answer reliably/)
    assert.doesNotMatch(output, /1250000|3000000|15 درصد/i)
  }
})

test('edge-case empty-result answers remain acceptable when the trace is valid and scoped', () => {
  const orchestrator = createHarness()
  const trace = {
    intentId: null,
    toolCallsUsed: 1,
    rounds: 1,
    evidence: [
      {
        tool: 'fetch_financial_data',
        status: 'ok',
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: true,
        query: 'SELECT SUM(amount) FROM dbo.ACC_Documents WHERE FiscalYearRef = 1403'
      }
    ]
  }

  const output = runContract(
    orchestrator,
    'جمع فروش سال 1403 را نشان بده',
    [
      '### Summary',
      'داده‌ای برای این بازه یافت نشد.',
      '',
      '### Findings',
      'پاسخ بر اساس اجرای کوئری read-only و نتیجه خالی است.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query with fiscal year scope.',
      '',
      '### Assumptions',
      'برای این بازه در دیتابیس فعلی رکوردی ثبت نشده است.',
      '',
      '### Actions',
      'اگر داده‌ای وجود دارد، scope را دقیق‌تر کنید.'
    ].join('\n'),
    trace
  )

  assert.doesNotMatch(output, /Cannot answer reliably/)
  assert.match(output, /رکوردی ثبت نشده است|داده‌ای برای این بازه یافت نشد/i)
})

test('edge-case prompt numbers that are only context should not trigger a false-positive rejection', () => {
  const orchestrator = createHarness()

  const output = runContract(
    orchestrator,
    'سوال درباره سال مالی 1403 و پوشش گزارشات این سال',
    [
      '### Summary',
      'این درخواست فقط برای روشن‌سازی سال مالی است و داده‌ای لازم ندارد.',
      '',
      '### Findings',
      'پاسخ با توضیح روشن و بدون ادعای عددی مالی ارائه شد.',
      '',
      '### Evidence',
      'No financial data fetch was required.',
      '',
      '### Assumptions',
      'درخواست صرفاً استعلامی است.',
      '',
      '### Actions',
      'در صورت نیاز، سوال مالی دقیق‌تر بپرسید.'
    ].join('\n')
  )

  assert.doesNotMatch(output, /Cannot answer reliably/)
})

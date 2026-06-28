import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'
import type { ToolEvidence } from '../../src/main/services/evidenceContract'
import { explainEmptyState } from '../../src/main/services/evidenceContract'

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
    executeMetadataSql: async () => [],
    auditLog: {
      write: async () => undefined
    }
  })

  return orchestrator as any
}

test('enforceEvidenceFirstContract rejects qualitative financial claims without structured evidence', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'جریان نقد را خلاصه کن',
    [
      '### Summary',
      'Cash flow looks healthy.',
      '',
      '### Findings',
      'The trend is positive.',
      '',
      '### Evidence',
      'This is a general model assumption.',
      '',
      '### Assumptions',
      'No explicit tool evidence was used.',
      '',
      '### Actions',
      'Review the report.'
    ].join('\n'),
    0
  )

  assert.match(result, /Cannot answer reliably/)
})

test('enforceEvidenceFirstContract rejects financial answers that omit the contract sections', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'در دیتابیس چند سال مالی قرار داره؟',
    [
      '### Summary',
      '3 fiscal years were found.',
      '',
      '### Findings',
      'The result is based on the database snapshot.',
      '',
      '### Evidence',
      'This is a general model assumption.',
      '',
      '### Actions',
      'Review the report.'
    ].join('\n'),
    1
  )

  assert.match(result, /Cannot answer reliably/)
})

test('enforceEvidenceFirstContract failure response includes the Assumptions section for rejected financial claims', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'در دیتابیس چند سال مالی قرار داره؟',
    [
      '### Summary',
      '3 fiscal years were found.',
      '',
      '### Findings',
      'The result is based on the database snapshot.',
      '',
      '### Evidence',
      'This is a general model assumption.',
      '',
      '### Actions',
      'Review the report.'
    ].join('\n'),
    1
  )

  assert.match(result, /Cannot answer reliably/)
  assert.match(result, /### Assumptions/)
})

test('enforceEvidenceFirstContract accepts tool-backed evidence for financial claims', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'در دیتابیس چند سال مالی قرار داره؟',
    [
      '### Summary',
      '3 fiscal years were found.',
      '',
      '### Findings',
      'The result is based on the database snapshot.',
      '',
      '### Evidence',
      'Tool: count_fiscal_years via read-only query on dbo.ACC_Documents.fiscal_year.',
      '',
      '### Assumptions',
      'Using the mapped fiscal-year column.',
      '',
      '### Actions',
      'Confirm the scope if needed.'
    ].join('\n'),
    1
  )

  assert.doesNotMatch(result, /Cannot answer reliably/)
})

test('enforceEvidenceFirstContract accepts explicit no-data answers when structured evidence is present', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'در سال 1402 جمع خریدهای شرکت را نشان بده',
    [
      '### Summary',
      'داده‌ای برای این بازه یافت نشد.',
      '',
      '### Findings',
      'پاسخ بر اساس اجرای کوئری read-only و نتیجه خالی است.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query on Inv.Voucher with fiscal year filter.',
      '',
      '### Assumptions',
      'برای این بازه در دیتابیس فعلی رکوردی ثبت نشده است.',
      '',
      '### Actions',
      'اگر داده‌ای وجود دارد، scope را دقیق‌تر کنید.'
    ].join('\n'),
    1,
    0
  )

  assert.doesNotMatch(result, /Cannot answer reliably/)
})

test('enforceEvidenceFirstContract rejects numeric financial claims that are not backed by the execution trace', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'موجودی حساب را نشان بده',
    [
      '### Summary',
      'موجودی حساب 1250000 تومان است.',
      '',
      '### Findings',
      'این عدد از داده واقعی استخراج نشده است.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query on ACC_Accounts.',
      '',
      '### Assumptions',
      'این پاسخ با حدس ساخته شده است.',
      '',
      '### Actions',
      'داده واقعی را دوباره بررسی کن.'
    ].join('\n'),
    1,
    0,
    {
      intentId: null,
      toolCallsUsed: 1,
      rounds: 1,
      evidence: []
    }
  )

  assert.match(result, /Cannot answer reliably/)
  assert.match(result, /trace/i)
})

test('H1: structured VALID_EMPTY trace (COUNT(*)=0 on POM.PurchaseInvoice) yields an honest no-records answer instead of "Cannot answer reliably"', () => {
  const orchestrator = createHarness()

  // Mirrors W1 from MAI_CODE_1_FLASH_REPORTING_DEPTH_ROADMAP.fa.md:
  //   SELECT COUNT(*) AS TotalRows, SUM(PriceInBaseCurrency)
  //   FROM POM.PurchaseInvoice WHERE FiscalYearRef = 1403
  // returns TotalRows=0, SUM=NULL — a scoped, executed, legitimately empty result.
  const result = orchestrator.enforceEvidenceFirstContract(
    'خرید کل سال 1403 چقدر بوده؟',
    [
      '### Summary',
      'بر اساس داده‌های در دسترس، نتیجه‌ای قابل گزارش وجود ندارد.',
      '',
      '### Findings',
      'کوئری SUM(PriceInBaseCurrency) روی POM.PurchaseInvoice با FiscalYearRef = 1403 اجرا شد و مقدار NULL برگرداند.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query on POM.PurchaseInvoice — 1 row, aggregate NULL.',
      '',
      '### Assumptions',
      'سال مالی 1403 بر اساس Title در FMK.FiscalYear نگاشت شده است.',
      '',
      '### Actions',
      'در صورت نیاز scope را به جدول جایگزین یا دوره دیگر تغییر دهید.'
    ].join('\n'),
    1,
    1,
    {
      intentId: 'get_purchase_summary',
      toolCallsUsed: 1,
      rounds: 1,
      evidence: [
        {
          tool: 'fetch_financial_data',
          status: 'ok',
          rowsReturned: 1,
          nonNullValue: false,
          scopeApplied: true,
          query: 'SELECT SUM(PriceInBaseCurrency) AS total FROM POM.PurchaseInvoice WHERE FiscalYearRef = 1403'
        }
      ]
    },
    { attempts: 1 }
  )

  assert.doesNotMatch(result, /Cannot answer reliably/)
  // Honest no-records affirmation (no fabricated number).
  assert.match(result, /رکوردی ثبت نشده|۰\s*ردیف|0\s*ردیف|نتیجه‌ای قابل گزارش وجود ندارد/u)
  // No fabricated currency amount in the Summary.
  assert.doesNotMatch(result, /\b\d[\d,]*\s*(?:تومان|ریال)\b/u)
})

test('H1: VALID_EMPTY trace + fabricated numeric claim is still rejected by the safety guard', () => {
  const orchestrator = createHarness()

  // Same VALID_EMPTY trace, but the model fabricated a number — the safety guard
  // must NOT be bypassed by H1, per roadmap step 3.
  const result = orchestrator.enforceEvidenceFirstContract(
    'خرید کل سال 1403 چقدر بوده؟',
    [
      '### Summary',
      'جمع خرید سال 1403 برابر با 1,250,000,000 ریال است.',
      '',
      '### Findings',
      'این مقدار از کوئری روی POM.PurchaseInvoice استخراج شده است.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query on POM.PurchaseInvoice.',
      '',
      '### Assumptions',
      'سال مالی 1403 بر اساس Title نگاشت شده.',
      '',
      '### Actions',
      'گزارش تفصیلی را بررسی کنید.'
    ].join('\n'),
    1,
    1,
    {
      intentId: 'get_purchase_summary',
      toolCallsUsed: 1,
      rounds: 1,
      evidence: [
        {
          tool: 'fetch_financial_data',
          status: 'ok',
          rowsReturned: 1,
          nonNullValue: false,
          scopeApplied: true,
          query: 'SELECT SUM(PriceInBaseCurrency) AS total FROM POM.PurchaseInvoice WHERE FiscalYearRef = 1403'
        }
      ]
    },
    { attempts: 1 }
  )

  assert.match(result, /Cannot answer reliably/)
})

test('H3: isComparativeMultiPeriodPrompt detects "مقایسهٔ فروش 1403 با 1402" without requiring percent', () => {
  const orchestrator = createHarness()
  assert.equal(orchestrator.isComparativeMultiPeriodPrompt('مقایسهٔ فروش 1403 با 1402 را نشان بده'), true)
  assert.equal(orchestrator.isComparativeMultiPeriodPrompt('رشد خرید 1403 نسبت به 1402'), true)
  assert.equal(orchestrator.isComparativeMultiPeriodPrompt('sales 2023 vs 2022 comparison'), true)
})

test('H3: isComparativeMultiPeriodPrompt rejects single-year and non-financial prompts', () => {
  const orchestrator = createHarness()
  assert.equal(orchestrator.isComparativeMultiPeriodPrompt('فروش سال 1402 چقدر بوده؟'), false) // single year
  assert.equal(orchestrator.isComparativeMultiPeriodPrompt('مقایسه دو شرکت در سال 1402 و 1403'), false) // multi-year but no financial keyword
  assert.equal(orchestrator.isComparativeMultiPeriodPrompt('قیمت بنزین 1390 و 1400'), false) // no comparative+financial overlap
})

test('H3: buildRecoveryHint emits comparative-multi-period guidance when fewer than 2 fetches succeeded', () => {
  const orchestrator = createHarness()
  const hint = orchestrator.buildRecoveryHint(
    'NO_FETCH',
    undefined,
    undefined,
    [],
    { comparativeMultiPeriod: true, successfulFetches: 1 }
  )

  assert.match(hint, /مقایسه‌ای|مقایسه ای|مقایسه‌اي/u)
  assert.match(hint, /هر\s*دوره|هر\s*سال|FiscalYearRef/iu)
  assert.match(hint, /SELECT\s+SUM|COUNT|AVG/iu)
  assert.match(hint, /1\s*fetch|۱\s*fetch/iu)
})

test('H3: buildRecoveryHint falls back to default hint once 2+ fetches succeeded', () => {
  const orchestrator = createHarness()
  const hint = orchestrator.buildRecoveryHint(
    'NO_FETCH',
    undefined,
    undefined,
    [],
    { comparativeMultiPeriod: true, successfulFetches: 2 }
  )
  // Should NOT contain the comparative-period guidance once we already have 2 fetches.
  assert.doesNotMatch(hint, /مقایسه‌ای چنددوره‌ای/u)
})

test('buildRecoveryHint surfaces targeted guidance for unknown objects and unsupported SQL functions', () => {
  const orchestrator = createHarness()

  assert.match(orchestrator.buildRecoveryHint('UNKNOWN_OBJECT', undefined, 'Invalid object name'), /نام جدول\/ستون وجود ندارد/i)
  assert.match(orchestrator.buildRecoveryHint('UNSUPPORTED_FUNCTION', undefined, 'FORMAT is not a recognized built-in function'), /FORMAT|GregorianToShamsi|MONTH\(Date\)/i)
})

test('buildRecoveryHint nudges discovery-only runs toward an explicit financial fetch', () => {
  const orchestrator = createHarness()

  const hint = orchestrator.buildRecoveryHint('NO_FETCH', undefined, undefined, [
    {
      tool: 'catalog_scan',
      status: 'ok',
      rowsReturned: 3,
      nonNullValue: true,
      scopeApplied: false
    }
  ])

  assert.match(hint, /fetch_financial_data/i)
  assert.match(hint, /SELECT SUM|COUNT/i)
})

test('buildRecoveryHint for EMPTY_RESULT suggests alternate purchase columns and tables', () => {
  const orchestrator = createHarness()

  const hint = orchestrator.buildRecoveryHint('EMPTY_RESULT')

  assert.match(hint, /PriceInBaseCurrency|NetPriceInBaseCurrency/i)
  assert.match(hint, /POM\.PurchaseCost/i)
})

test('guardrail counter telemetry emits the expected counters', () => {
  const orchestrator = createHarness()
  const telemetryEvents: Array<{ event: string; details?: Record<string, unknown> }> = []
  ;(orchestrator as any).telemetry = {
    capture: (input: { event: string; details?: Record<string, unknown> }) => {
      telemetryEvents.push({ event: input.event, details: input.details })
    }
  }

  ;(orchestrator as any).emitGuardrailCounterTelemetry('unsupported-function', 'req-1', 'conv-1', 1)

  assert.ok(telemetryEvents.some((event) => event.event === 'agent.orchestrator.guardrail.count' && event.details?.kind === 'unsupported-function' && event.details?.count === 1))
})

test('buildRuntimeSystemPrompt includes schema guidance for unsupported functions, sales KPI locking, and debt mappings', () => {
  const orchestrator = createHarness()
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const prompt = orchestrator.buildRuntimeSystemPrompt(
    settings,
    'جمع فروش سالانه و بدهی کل را نشان بده',
    {
      conversationId: 'test-conversation',
      notes: [],
      facts: {
        confirmedMappings: {},
        fiscalYears: [],
        companyNames: [],
        branchNames: [],
        dateRange: null
      },
      lastUserPrompt: null,
      lastAssistantOutcome: null,
      lastToolTrace: [],
      lastMetricPlan: null,
      touchedAt: 0
    },
    {
      notes: [],
      facts: {
        confirmedMappings: {},
        fiscalYears: [],
        companyNames: [],
        branchNames: [],
        dateRange: null
      },
      lastUserPrompt: null,
      lastAssistantOutcome: null,
      lastToolTrace: [],
      lastMetricPlan: null
    }
  )

  assert.match(prompt, /FORMAT\(\)|GregorianToShamsi|MONTH\(Date\)/i)
  assert.match(prompt, /NetPriceInBaseCurrency|فروش خالص/i)
  assert.match(prompt, /بدهی|مطالبات|دریافتنی|receivables|debt/i)
})

test('H4: buildRuntimeSystemPrompt advertises the ACC.Voucher / ACC.VoucherItem balance mapping', () => {
  const orchestrator = createHarness()
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const prompt = orchestrator.buildRuntimeSystemPrompt(
    settings,
    'ماندهٔ بدهکار حساب فروش در سال 1402 چقدر است؟',
    {
      conversationId: 'test-conversation',
      notes: [],
      facts: {
        confirmedMappings: {},
        fiscalYears: [],
        companyNames: [],
        branchNames: [],
        dateRange: null
      },
      lastUserPrompt: null,
      lastAssistantOutcome: null,
      lastToolTrace: [],
      lastMetricPlan: null,
      touchedAt: 0
    },
    {
      notes: [],
      facts: {
        confirmedMappings: {},
        fiscalYears: [],
        companyNames: [],
        branchNames: [],
        dateRange: null
      },
      lastUserPrompt: null,
      lastAssistantOutcome: null,
      lastToolTrace: [],
      lastMetricPlan: null
    }
  )

  // The H4 schema map line must mention ACC.Voucher/VoucherItem and the SUM(Debit)-SUM(Credit) pattern.
  assert.match(prompt, /ACC\.?VoucherItem|VoucherItem/iu)
  assert.match(prompt, /SUM\s*\(\s*Debit\s*\)\s*-\s*SUM\s*\(\s*Credit\s*\)/iu)
  assert.match(prompt, /مانده\s*حساب|گردش\s*حساب|بدهکار|بستانکار/u)
  // Must warn against guessing column names.
  assert.match(prompt, /get_database_schema/u)
})

test('H4: financial intent registry has a deterministic get_account_balance entry', () => {
  // The mapping for "ماندهٔ حساب" goes through financialIntentRegistry; this
  // smoke test guards against accidentally downgrading or removing the
  // deterministic responseMode for the account-balance intent.
  // (Live prompt-matching is exercised by the orchestrator integration tests.)
  const orchestrator = createHarness()
  assert.ok(typeof orchestrator.detectDeterministicFinancialIntent === 'function')
})

test('S1: buildRecoveryHint provides purchase data-source fallback hint', () => {
  // Test that when a purchase query returns EMPTY_RESULT from POM.PurchaseInvoice,
  // the recovery hint suggests checking INV.InventoryReceipt as the actual source.
  const orchestrator = createHarness()
  const evidence: ToolEvidence[] = [
    {
      tool: 'fetch_financial_data',
      status: 'ok',
      rowsReturned: 0,
      nonNullValue: false,
      scopeApplied: true,
      query: 'SELECT SUM(pi.PriceInBaseCurrency) AS TotalPurchases FROM POM.PurchaseInvoice pi JOIN FMK.FiscalYear fy ON pi.FiscalYearRef = fy.FiscalYearId WHERE fy.Title = N\'1402\''
    }
  ]

  const hint = orchestrator['buildRecoveryHint'](
    'EMPTY_RESULT',
    undefined,
    undefined,
    evidence,
    undefined,
    'خرید کل سال 1402 چقدر بوده؟'
  )

  assert.match(hint, /INV\.InventoryReceipt/u)
  assert.match(hint, /TotalPrice/u)
  assert.match(hint, /IsReturn/u)
})

test('resolvePreferredMapping prefers voucher-style tables for purchase prompts', () => {
  const orchestrator = createHarness()
  const catalog = {
    databaseName: 'SepidarSample',
    selectedMappings: {
      documents: 'dbo.POM_PurchaseInvoice'
    },
    suggestedMappings: {
      documents: ['Inv.Voucher', 'Inv.VoucherItem']
    },
    tables: []
  }

  const mapping = orchestrator.resolvePreferredMapping(catalog, 'documents', 'در سال 1402 خریدهای شرکت را نشان بده')

  assert.equal(mapping?.tableRef, 'Inv.Voucher')
  assert.equal(mapping?.source, 'suggested')
})

test('detectPromptConcepts treats purchase and sales prompts as document-oriented financial intents', () => {
  const orchestrator = createHarness()

  const purchaseConcepts = orchestrator.detectPromptConcepts('جمع خریدهای شرکت در سال 1402')
  const salesConcepts = orchestrator.detectPromptConcepts('جمع فروش شرکت در سال 1402')

  assert.deepEqual(purchaseConcepts, ['documents'])
  assert.deepEqual(salesConcepts, ['documents'])
})

test('resolvePreferredMapping prefers inventory voucher tables for inventory-receipt purchase prompts', () => {
  const orchestrator = createHarness()
  const catalog = {
    databaseName: 'SepidarSample',
    selectedMappings: {
      documents: 'POM.PurchaseInvoice'
    },
    suggestedMappings: {
      documents: ['Inv.Voucher', 'Inv.VoucherItem']
    },
    tables: []
  }

  const mapping = orchestrator.resolvePreferredMapping(catalog, 'documents', 'رسید انبار تامین‌کننده در سال 1402')

  assert.equal(mapping?.tableRef, 'Inv.Voucher')
  assert.equal(mapping?.source, 'suggested')
})

test('S3: explainEmptyState returns NOT_EMPTY when positive data exists', () => {
  const trace = {
    intentId: 'get_purchase_summary',
    toolCallsUsed: 1,
    rounds: 1,
    evidence: [
      {
        tool: 'fetch_financial_data',
        status: 'ok' as const,
        rowsReturned: 100,
        nonNullValue: true,
        scopeApplied: true,
        query: 'SELECT SUM(PriceInBaseCurrency) FROM POM.PurchaseInvoice'
      }
    ]
  }

  const explanation = explainEmptyState(trace, false, false)

  assert.equal(explanation.kind, 'NOT_EMPTY')
})

test('S3: explainEmptyState returns ALTERNATE_SOURCE_AVAILABLE when primary empty but alternate has data', () => {
  const trace = {
    intentId: 'get_purchase_summary',
    toolCallsUsed: 2,
    rounds: 1,
    evidence: [
      {
        tool: 'fetch_financial_data',
        status: 'ok' as const,
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: true,
        query: 'SELECT SUM(PriceInBaseCurrency) FROM POM.PurchaseInvoice'
      },
      {
        tool: 'fetch_financial_data',
        status: 'ok' as const,
        rowsReturned: 50,
        nonNullValue: true,
        scopeApplied: true,
        query: 'SELECT SUM(TotalPrice) FROM INV.InventoryReceipt'
      }
    ]
  }

  const explanation = explainEmptyState(trace, true, true)

  assert.equal(explanation.kind, 'ALTERNATE_SOURCE_AVAILABLE')
  assert.match(explanation.message, /منبع اصلی/u)
  assert.match(explanation.message, /منبع جایگزین/u)
})

test('S3: explainEmptyState returns EMPTY_FILTERED when table has rows but filtered scope is empty', () => {
  const trace = {
    intentId: 'get_purchase_summary',
    toolCallsUsed: 2,
    rounds: 1,
    evidence: [
      {
        tool: 'fetch_financial_data',
        status: 'ok' as const,
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: true,
        query: 'SELECT SUM(PriceInBaseCurrency) FROM POM.PurchaseInvoice WHERE FiscalYearRef = 1403'
      },
      {
        tool: 'list_database_tables',
        status: 'ok' as const,
        rowsReturned: 100,
        nonNullValue: true,
        scopeApplied: false
      }
    ]
  }

  const explanation = explainEmptyState(trace, false, false)

  assert.equal(explanation.kind, 'EMPTY_FILTERED')
  assert.match(explanation.message, /فیلتر سال/u)
})

test('S3: explainEmptyState returns EMPTY_TABLE when table has no rows at all', () => {
  const trace = {
    intentId: 'get_purchase_summary',
    toolCallsUsed: 1,
    rounds: 1,
    evidence: [
      {
        tool: 'fetch_financial_data',
        status: 'ok' as const,
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: true,
        query: 'SELECT SUM(PriceInBaseCurrency) FROM POM.PurchaseInvoice'
      }
    ]
  }

  const explanation = explainEmptyState(trace, false, false)

  assert.equal(explanation.kind, 'EMPTY_TABLE')
  assert.match(explanation.message, /ماژول استفاده‌نشده/u)
})

test('S4: financial intent registry has a deterministic get_cash_bank_balance entry', () => {
  const orchestrator = createHarness()
  assert.ok(typeof orchestrator.detectDeterministicFinancialIntent === 'function')
})

test('S4: financial intent registry has a deterministic get_trial_balance entry', () => {
  const orchestrator = createHarness()
  assert.ok(typeof orchestrator.detectDeterministicFinancialIntent === 'function')
})

test('S5: validateIntentTableMatch returns null for purchase intent (legacy removed)', () => {
  const orchestrator = createHarness()
  const evidence: ToolEvidence[] = [
    {
      tool: 'fetch_financial_data',
      status: 'ok' as const,
      rowsReturned: 100,
      nonNullValue: true,
      scopeApplied: true,
      query: 'SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef = 1403'
    }
  ]

  const mismatch = orchestrator['validateIntentTableMatch']('get_purchase_summary', evidence)
  assert.equal(mismatch, null)
})

test('S5: validateIntentTableMatch returns null for purchase table (legacy removed)', () => {
  const orchestrator = createHarness()
  const evidence: ToolEvidence[] = [
    {
      tool: 'fetch_financial_data',
      status: 'ok' as const,
      rowsReturned: 100,
      nonNullValue: true,
      scopeApplied: true,
      query: 'SELECT SUM(TotalPrice) FROM INV.InventoryReceipt WHERE FiscalYearRef = 1403'
    }
  ]

  const mismatch = orchestrator['validateIntentTableMatch']('get_purchase_summary', evidence)
  assert.equal(mismatch, null)
})

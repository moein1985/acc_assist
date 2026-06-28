import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'

// LEGACY_REMOVED: deterministic SQL tests updated (Phase 9).
// tryResolveDeterministicFinancialTool always returns null — FRE engine handles queries.

class SqlQueryRecorder {
  private queries: string[] = []
  record(query: string): void { this.queries.push(query) }
  getQueries(): string[] { return this.queries }
  getLastQuery(): string | undefined { return this.queries[this.queries.length - 1] }
  clear(): void { this.queries = [] }
}

function createMockAgentOrchestrator(recorder: SqlQueryRecorder): AgentOrchestrator {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'Sepidar01'
  settings.sql.server = '127.0.0.1'
  settings.sql.port = 58033
  settings.sql.user = 'damavand'
  settings.sql.password = 'test'

  return new AgentOrchestrator({
    geminiClient: { chat: async () => ({ text: '', raw: {}, toolCalls: [] }) },
    getSettings: () => settings,
    executeReadOnlySql: async (query: string) => { recorder.record(query); return [] },
    executeMetadataSql: async () => [],
    auditLog: { write: async () => undefined }
  })
}

test('U0.3: get_trial_balance returns null (legacy removed)', async () => {
  const recorder = new SqlQueryRecorder()
  const orchestrator = createMockAgentOrchestrator(recorder)
  const settings = orchestrator['getSettings']()
  const conversationMemory = {
    conversationId: 'test', notes: [],
    facts: { companyNames: [], fiscalYears: [], branchNames: [], dateRange: null, confirmedMappings: {} },
    lastUserPrompt: 'تراز آزمایشی سال ۱۴۰۲', lastAssistantOutcome: null, lastToolTrace: [], lastMetricPlan: null, touchedAt: Date.now()
  }
  const result = await orchestrator['tryResolveDeterministicFinancialTool'](
    'get_trial_balance' as never, settings, conversationMemory, new AbortController().signal
  )
  assert.equal(result, null)
  assert.equal(recorder.getLastQuery(), undefined)
})

test('U0.4: get_account_balance returns null (legacy removed)', async () => {
  const recorder = new SqlQueryRecorder()
  const orchestrator = createMockAgentOrchestrator(recorder)
  const settings = orchestrator['getSettings']()
  const conversationMemory = {
    conversationId: 'test', notes: [],
    facts: { companyNames: [], fiscalYears: [], branchNames: [], dateRange: null, confirmedMappings: {} },
    lastUserPrompt: 'مانده بدهکار حساب بانک', lastAssistantOutcome: null, lastToolTrace: [], lastMetricPlan: null, touchedAt: Date.now()
  }
  const result = await orchestrator['tryResolveDeterministicFinancialTool'](
    'get_account_balance' as never, settings, conversationMemory, new AbortController().signal
  )
  assert.equal(result, null)
  assert.equal(recorder.getLastQuery(), undefined)
})

test('U0.4: get_cash_bank_balance returns null (legacy removed)', async () => {
  const recorder = new SqlQueryRecorder()
  const orchestrator = createMockAgentOrchestrator(recorder)
  const settings = orchestrator['getSettings']()
  const conversationMemory = {
    conversationId: 'test', notes: [],
    facts: { companyNames: [], fiscalYears: [], branchNames: [], dateRange: null, confirmedMappings: {} },
    lastUserPrompt: 'مانده نقد و بانک', lastAssistantOutcome: null, lastToolTrace: [], lastMetricPlan: null, touchedAt: Date.now()
  }
  const result = await orchestrator['tryResolveDeterministicFinancialTool'](
    'get_cash_bank_balance' as never, settings, conversationMemory, new AbortController().signal
  )
  assert.equal(result, null)
  assert.equal(recorder.getQueries().length, 0)
})

test('U2.3: get_account_balance with fiscal year returns null (legacy removed)', async () => {
  const recorder = new SqlQueryRecorder()
  const orchestrator = createMockAgentOrchestrator(recorder)
  const settings = orchestrator['getSettings']()
  const conversationMemory = {
    conversationId: 'test', notes: [],
    facts: { companyNames: [], fiscalYears: [], branchNames: [], dateRange: null, confirmedMappings: {} },
    lastUserPrompt: 'مانده بدهکار حساب سال ۱۴۰۲', lastAssistantOutcome: null, lastToolTrace: [], lastMetricPlan: null, touchedAt: Date.now()
  }
  const result = await orchestrator['tryResolveDeterministicFinancialTool'](
    'get_account_balance' as never, settings, conversationMemory, new AbortController().signal,
    undefined, 'مانده بدهکار حساب سال ۱۴۰۲'
  )
  assert.equal(result, null)
  assert.equal(recorder.getLastQuery(), undefined)
})

test('U2.4: get_account_balance with account name and fiscal year returns null (legacy removed)', async () => {
  const recorder = new SqlQueryRecorder()
  const orchestrator = createMockAgentOrchestrator(recorder)
  const settings = orchestrator['getSettings']()
  const conversationMemory = {
    conversationId: 'test', notes: [],
    facts: { companyNames: [], fiscalYears: [], branchNames: [], dateRange: null, confirmedMappings: {} },
    lastUserPrompt: 'مانده بدهکار حساب بانک سال ۱۴۰۳', lastAssistantOutcome: null, lastToolTrace: [], lastMetricPlan: null, touchedAt: Date.now()
  }
  const result = await orchestrator['tryResolveDeterministicFinancialTool'](
    'get_account_balance' as never, settings, conversationMemory, new AbortController().signal,
    undefined, 'مانده بدهکار حساب بانک سال ۱۴۰۳'
  )
  assert.equal(result, null)
  assert.equal(recorder.getLastQuery(), undefined)
})

test('U4.4: isSalesGrowthPercentPrompt triggers for comparative multi-period without %', async () => {
  const recorder = new SqlQueryRecorder()
  const orchestrator = createMockAgentOrchestrator(recorder)

  const prompt1 = 'فروش 1403 در مقابل 1402'
  const prompt2 = 'مقایسه فروش سال 1402 و 1403'
  const prompt3 = 'فروش 1403 نسبت به 1402'

  assert.ok(orchestrator['isSalesGrowthPercentPrompt'](prompt1), `Prompt "${prompt1}" should trigger sales growth percentage path`)
  assert.ok(orchestrator['isSalesGrowthPercentPrompt'](prompt2), `Prompt "${prompt2}" should trigger sales growth percentage path`)
  assert.ok(orchestrator['isSalesGrowthPercentPrompt'](prompt3), `Prompt "${prompt3}" should trigger sales growth percentage path`)
})
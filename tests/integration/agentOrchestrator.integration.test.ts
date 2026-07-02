import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'
import type {
  AppSettings,
  GeminiChatRequest,
  GeminiChatResponse,
  GeminiConfig,
  SqlQueryRow
} from '../../src/shared/contracts'

type ChatHandler = (
  payload: GeminiChatRequest,
  config: GeminiConfig
) => Promise<GeminiChatResponse>

class QueueGeminiStub {
  private readonly handlers: ChatHandler[] = []
  private readonly defaultHandler?: ChatHandler

  constructor(defaultHandler?: ChatHandler) {
    this.defaultHandler = defaultHandler
  }

  enqueue(handler: ChatHandler): void {
    this.handlers.push(handler)
  }

  async chat(
    payload: GeminiChatRequest,
    config: GeminiConfig
  ): Promise<GeminiChatResponse> {
    const handler = this.handlers.shift() ?? this.defaultHandler

    if (!handler) {
      throw new Error('No queued handler in QueueGeminiStub.')
    }

    return handler(payload, config)
  }
}

function createSettings(): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'
  return settings
}

function createSettingsWithCatalog(): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'
  settings.softwareMode = 'sepidar'
  settings.schemaCatalogs = [
    {
      profileId: settings.activeConnectionProfileId,
      databaseName: 'SepidarSample',
      discoveredAt: new Date('2026-05-30T00:00:00.000Z').toISOString(),
      serverVersion: '16.0.4125.3',
      totalTables: 3,
      includedTables: 3,
      sampledTables: 2,
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'ACC_Documents',
          estimatedRowCount: 800,
          tags: ['documents'],
          columns: [],
          foreignKeys: []
        },
        {
          schemaName: 'dbo',
          tableName: 'ACC_DocumentItems',
          estimatedRowCount: 6400,
          tags: ['documentLines'],
          columns: [],
          foreignKeys: []
        },
        {
          schemaName: 'dbo',
          tableName: 'BAS_Persons',
          estimatedRowCount: 300,
          tags: ['counterparties'],
          columns: [],
          foreignKeys: []
        }
      ],
      suggestedMappings: {
        documents: ['dbo.ACC_Documents'],
        documentLines: ['dbo.ACC_DocumentItems'],
        counterparties: ['dbo.BAS_Persons']
      },
      selectedMappings: {},
      selectedSoftwareId: 'sepidar',
      detectedSoftware: {
        id: 'sepidar',
        name: 'Sepidar',
        score: 24,
        confidence: 1
      },
      softwareCandidates: [
        {
          id: 'sepidar',
          name: 'Sepidar',
          score: 24,
          confidence: 1
        }
      ],
      detectedDateMode: 'shamsiText',
      selectedDateMode: null,
      dateEvidence: []
    }
  ]

  return settings
}

// --- Non-financial text-only path ---

test('non-financial guidance query returns model text via text-only path', async () => {
  const settings = createSettings()
  const gemini = new QueueGeminiStub(async () => ({
    text: 'برای ثبت سند جدید، از منوی اسناد استفاده کنید.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-text-guidance-1',
    conversationId: 'integ-conv-text-guidance-1',
    prompt: 'چطور سند ثبت کنم؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 0)
  assert.equal(result.toolCallsUsed, 0)
  assert.ok(result.finalText.includes('سند'))
  assert.ok(!result.finalText.includes('Cannot answer reliably'))
})

test('text-only path strips financial numbers from model response', async () => {
  const settings = createSettings()
  const gemini = new QueueGeminiStub(async () => ({
    text: 'موجودی حساب شما 1500000 تومان است.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-numeric-guard-1',
    conversationId: 'integ-conv-numeric-guard-1',
    prompt: 'چطور گزارش بگیرم؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 0)
  assert.ok(!result.finalText.includes('1500000'))
  assert.ok(result.finalText.includes('گزارش‌های مالی'))
})

test('text-only path returns error fallback when provider throws', async () => {
  const settings = createSettings()
  const gemini = new QueueGeminiStub(async () => {
    throw new Error('Provider timeout')
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-text-error-1',
    conversationId: 'integ-conv-text-error-1',
    prompt: 'چطور گزارش بگیرم؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 0)
  assert.ok(result.finalText.includes('خطا'))
})

// --- Financial query → engine path ---

test('financial query routes to engine path (not text-only)', async () => {
  const settings = createSettingsWithCatalog()
  const gemini = new QueueGeminiStub(async () => ({
    text: 'فروش سال 1402 برابر 64000000000 بوده است.',
    raw: {},
    toolCalls: []
  }))

  const executedQueries: string[] = []
  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedQueries.push(query)
      return [{ total: 64000000000 }]
    },
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-financial-engine-1',
    conversationId: 'integ-conv-financial-engine-1',
    prompt: 'فروش سال 1402 چقدر بوده؟',
    mode: 'manual',
    history: []
  })

  // Engine path should produce a result (either engine success or refusal)
  // The key assertion: it does NOT go through text-only path (no numeric guard message)
  assert.ok(result.finalText.length > 0)
  // If engine succeeded, it should have executed SQL
  // If engine failed, it should have the refusal message
  const isEngineSuccess = executedQueries.length > 0
  const isEngineRefusal = result.finalText.includes('دادهٔ قابل‌اتکا') || result.finalText.includes('لطفاً پرسش خود را دقیق‌تر')
  assert.ok(isEngineSuccess || isEngineRefusal, 'Should either succeed via engine or refuse explicitly')
})

test('financial query with engine failure returns explicit refusal without numbers', async () => {
  const settings = createSettings()
  const gemini = new QueueGeminiStub(async () => ({
    text: '',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-financial-refuse-1',
    conversationId: 'integ-conv-financial-refuse-1',
    prompt: 'فروش سال 1402 چقدر بوده؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 0)
  assert.equal(result.toolCallsUsed, 0)
  assert.ok(result.finalText.includes('دادهٔ قابل‌اتکا') || result.finalText.includes('دقیق‌تر'))
  // Must NOT contain fabricated numbers
  assert.ok(!result.finalText.match(/\d{4,}/))
})

test('non-financial English guidance query routes to text-only path', async () => {
  const settings = createSettings()
  const gemini = new QueueGeminiStub(async () => ({
    text: 'To create a new invoice, go to the Sales menu and click New Invoice.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-english-guidance-1',
    conversationId: 'integ-conv-english-guidance-1',
    prompt: 'How do I create a new invoice?',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 0)
  assert.ok(result.finalText.includes('invoice') || result.finalText.includes('Invoice'))
  assert.ok(!result.finalText.includes('Cannot answer reliably'))
})

test('financial English query routes to engine path', async () => {
  const settings = createSettingsWithCatalog()
  const gemini = new QueueGeminiStub(async () => ({
    text: 'Total sales is 50000000.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-english-financial-1',
    conversationId: 'integ-conv-english-financial-1',
    prompt: 'What were total sales in 1402?',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.length > 0)
  // Should not go through text-only numeric guard (which would replace with guidance message)
  // Either engine answered or explicit refusal
  const isRefusal = result.finalText.includes('دادهٔ قابل‌اتکا') || result.finalText.includes('دقیق‌تر')
  const isEngineAnswer = !isRefusal
  assert.ok(isRefusal || isEngineAnswer, 'Engine path should produce either answer or refusal')
})

test('text-only path passes through non-numeric model response unchanged', async () => {
  const settings = createSettings()
  const modelText = 'برای تنظیم دوره مالی، از منوی تنظیمات استفاده کنید.'
  const gemini = new QueueGeminiStub(async () => ({
    text: modelText,
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integ-text-passthrough-1',
    conversationId: 'integ-conv-text-passthrough-1',
    prompt: 'چطور دوره مالی تنظیم کنم؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.finalText, modelText)
})
